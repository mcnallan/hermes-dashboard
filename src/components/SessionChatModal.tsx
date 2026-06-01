import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Agent, type ChatEntry, formatDuration } from '../data'

interface Props {
  agent: Agent
  onClose: () => void
  onLoadTranscript: (sessionId: string) => Promise<ChatEntry[]>
  onSendMessage: (sessionId: string, message: string) => Promise<void>
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
}

function entryTime(entry: ChatEntry) {
  return entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function renderUnknown(value: unknown) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function normalizedContent(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function hasReasoning(entry: ChatEntry) {
  return Boolean(
    (entry.reasoning && entry.reasoning.trim()) ||
    entry.reasoningDetails,
  )
}

function sameTranscriptEntry(a: ChatEntry, b: ChatEntry) {
  if (a.id && b.id && a.id === b.id) return true
  if (a.kind !== b.kind || a.role !== b.role) return false
  if (a.toolCallId && b.toolCallId) return a.toolCallId === b.toolCallId
  if ((a.kind === 'tool_call' || a.kind === 'tool_result') && a.toolName && b.toolName) {
    return a.toolName === b.toolName && normalizedContent(a.content) === normalizedContent(b.content)
  }
  if (a.kind !== 'message') return false
  const withinSameTurn = Math.abs(a.timestamp.getTime() - b.timestamp.getTime()) < 5 * 60_000
  const aContent = normalizedContent(a.content)
  const bContent = normalizedContent(b.content)
  if (withinSameTurn && aContent === bContent) return true
  const closeStreamUpdate = Math.abs(a.timestamp.getTime() - b.timestamp.getTime()) < 10_000
  return a.role === 'assistant' && closeStreamUpdate && Boolean(aContent && bContent) && (
    aContent.startsWith(bContent) || bContent.startsWith(aContent)
  )
}

function mergeTranscriptPair(existing: ChatEntry, incoming: ChatEntry): ChatEntry {
  const incomingHasBetterContent = incoming.content.length > existing.content.length
  const preferIncoming = (!hasReasoning(existing) && hasReasoning(incoming)) || incomingHasBetterContent
  const base = preferIncoming ? incoming : existing
  const other = preferIncoming ? existing : incoming
  return {
    ...base,
    content: base.content.length >= other.content.length ? base.content : other.content,
    toolCallId: base.toolCallId || other.toolCallId,
    toolName: base.toolName || other.toolName,
    toolInput: base.toolInput ?? other.toolInput,
    toolStatus: base.toolStatus || other.toolStatus,
    reasoning: base.reasoning || other.reasoning,
    reasoningDetails: base.reasoningDetails ?? other.reasoningDetails,
    timestamp: existing.timestamp.getTime() <= incoming.timestamp.getTime() ? existing.timestamp : incoming.timestamp,
    source: base.source === 'db' || other.source === 'db' ? 'db' : 'live',
  }
}

function mergeTranscriptEntries(entries: ChatEntry[]) {
  const merged: ChatEntry[] = []
  for (const entry of entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    const existingIndex = merged.findIndex(candidate => sameTranscriptEntry(candidate, entry))
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeTranscriptPair(merged[existingIndex], entry)
    } else {
      merged.push(entry)
    }
  }
  return merged
}

function ReasoningFold({ entry }: { entry: ChatEntry }) {
  const reasoning = entry.reasoning || renderUnknown(entry.reasoningDetails)
  const [open, setOpen] = useState(false)
  if (!reasoning.trim()) return null
  return (
    <div className="chat-reasoning">
      <button className="chat-fold" onClick={() => setOpen(!open)}>
        {open ? 'HIDE' : 'SHOW'} REASONING
      </button>
      {open && <pre className="chat-reasoning-body">{reasoning}</pre>}
    </div>
  )
}

function ToolEntryView({
  entry,
  agent,
  showApprovalActions,
  onApprovalDecision,
}: {
  entry: ChatEntry
  agent: Agent
  showApprovalActions: boolean
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const body = entry.kind === 'tool_call'
    ? renderUnknown(entry.toolInput || entry.content)
    : entry.content
  const preview = body.replace(/\s+/g, ' ').slice(0, 180)
  const approvalDisabled = approvalBusy || !agent.approvalId || agent.approvalStatus === 'submitted'

  async function decide(decision: 'approve' | 'deny') {
    if (!agent.approvalId || approvalDisabled) return
    setApprovalBusy(true)
    try {
      await onApprovalDecision(agent.approvalId, decision)
    } finally {
      setApprovalBusy(false)
    }
  }

  return (
    <div className={`chat-tool ${entry.kind === 'tool_result' ? 'result' : 'call'}`}>
      <div className="chat-tool-head">
        <div className="chat-tool-title">
          <span className="tool-status-dot" />
          <span>{entry.kind === 'tool_call' ? 'TOOL CALL' : 'TOOL OUTPUT'}</span>
          {entry.toolName && <strong>{entry.toolName}</strong>}
        </div>
        <button className="chat-fold" onClick={() => setOpen(!open)}>
          {open ? 'COLLAPSE' : 'EXPAND'}
        </button>
      </div>
      <pre className={`chat-tool-body ${open ? 'open' : ''}`}>{open ? body : preview || 'no output'}</pre>
      {showApprovalActions && agent.approvalId && (
        <div className="chat-tool-approval">
          <div className="chat-tool-approval-label">
            <span className="attention-dot" />
            {agent.approvalTool || 'APPROVAL'} {agent.approvalInput || ''}
          </div>
          <div className="chat-tool-approval-desc">
            {agent.approvalDescription || 'This action requires approval before it can continue.'}
          </div>
          <div className="chat-tool-approval-actions">
            <button className="btn-approve" disabled={approvalDisabled} onClick={() => void decide('approve')}>
              {approvalBusy ? 'SENDING' : 'APPROVE'}
            </button>
            <button className="btn-deny" disabled={approvalDisabled} onClick={() => void decide('deny')}>
              DENY
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChatBubble({
  entry,
  agent,
  showApprovalActions,
  onApprovalDecision,
}: {
  entry: ChatEntry
  agent: Agent
  showApprovalActions: boolean
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
}) {
  if (entry.kind === 'tool_call' || entry.kind === 'tool_result') {
    return (
      <ToolEntryView
        entry={entry}
        agent={agent}
        showApprovalActions={showApprovalActions}
        onApprovalDecision={onApprovalDecision}
      />
    )
  }
  if (entry.kind === 'phase') {
    return (
      <div className="chat-phase">
        <span>{entry.content}</span>
        <time>{entryTime(entry)}</time>
      </div>
    )
  }

  return (
    <div className={`chat-bubble ${entry.role}`}>
      <div className="chat-bubble-meta">
        <span>{entry.role.toUpperCase()}</span>
        <time>{entryTime(entry)}</time>
      </div>
      <div className="chat-bubble-text">{entry.content || '...'}</div>
      <ReasoningFold entry={entry} />
    </div>
  )
}

function SessionActivityPhase({ phase }: { phase: Agent['phase'] }) {
  if (phase === 'waiting_for_input' || phase === 'ended') return null
  const label = phase === 'waiting_for_approval'
    ? 'WAITING FOR APPROVAL'
    : phase === 'compacting'
      ? 'COMPACTING CONTEXT'
      : 'AGENT WORKING'
  return (
    <div className="chat-phase active">
      <span>{label}</span>
      <span className="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

export function SessionChatModal({ agent, onClose, onLoadTranscript, onSendMessage, onApprovalDecision }: Props) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const initialScrollSessionRef = useRef<string | null>(null)
  const canSend = agent.phase !== 'ended'
  const lastToolCallId = [...entries].reverse().find(entry => entry.kind === 'tool_call')?.id

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    initialScrollSessionRef.current = null
    onLoadTranscript(agent.sessionId)
      .then(data => {
        if (cancelled) return
        if (data.length > 0) {
          setEntries(mergeTranscriptEntries(data))
          return
        }
        setEntries(mergeTranscriptEntries(agent.transcript || []))
      })
      .catch(err => {
        if (cancelled) return
        if (agent.transcript && agent.transcript.length > 0) {
          setEntries(mergeTranscriptEntries(agent.transcript))
          return
        }
        setError(err instanceof Error ? err.message : 'transcript failed')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agent.sessionId, agent.transcript, onLoadTranscript])

  useEffect(() => {
    const live = agent.transcript || []
    if (live.length === 0) return
    setEntries(prev => {
      return mergeTranscriptEntries([...prev, ...live])
    })
  }, [agent.transcript])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || loading || entries.length === 0) return
    if (initialScrollSessionRef.current === agent.sessionId) return
    el.scrollTop = el.scrollHeight
    initialScrollSessionRef.current = agent.sessionId
  }, [agent.sessionId, entries.length, loading])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance < 240) el.scrollTop = el.scrollHeight
  }, [entries])

  async function submit() {
    const message = draft.trim()
    if (!message || sending || !canSend) return
    setSending(true)
    setError('')
    try {
      await onSendMessage(agent.sessionId, message)
      setDraft('')
      const sent: ChatEntry = {
        id: `sent-${Date.now()}`,
        kind: 'message',
        role: 'user',
        timestamp: new Date(),
        content: message,
        source: 'live',
      }
      setEntries(prev => mergeTranscriptEntries([...prev, sent]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'message send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="chat-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Session chat"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="chat-modal">
        <div className="chat-modal-head">
          <div>
            <div className="chat-modal-kicker">SESSION CHAT</div>
            <div className="chat-modal-title">{agent.displayTitle}</div>
            <div className="chat-modal-meta">
              <span>{agent.phase.replaceAll('_', ' ')}</span>
              <span>{agent.turnCount} turns</span>
              <span>{formatDuration(Date.now() - agent.createdAt.getTime())}</span>
            </div>
          </div>
          <button className="detail-close" onClick={onClose}>ESC</button>
        </div>

        <div className="chat-stream" ref={scrollerRef}>
          {loading && <div className="chat-empty">LOADING TRANSCRIPT...</div>}
          {!loading && entries.length === 0 && <div className="chat-empty">NO TRANSCRIPT EVENTS YET</div>}
          {entries.map(entry => (
            <ChatBubble
              key={entry.id}
              entry={entry}
              agent={agent}
              showApprovalActions={entry.id === lastToolCallId && agent.phase === 'waiting_for_approval'}
              onApprovalDecision={onApprovalDecision}
            />
          ))}
          <SessionActivityPhase phase={agent.phase} />
        </div>

        <div className="chat-compose">
          {error && <div className="chat-error">{error}</div>}
          {!canSend && <div className="chat-error">This session has ended. Transcript is read-only.</div>}
          <textarea
            value={draft}
            disabled={!canSend || sending}
            placeholder={canSend ? 'send a message to this session...' : 'session is read-only'}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <button className="chat-send" disabled={!draft.trim() || sending || !canSend} onClick={() => void submit()}>
            {sending ? 'SENDING' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  )
}
