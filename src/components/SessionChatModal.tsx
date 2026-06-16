import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Agent, type ChatEntry, type PendingApproval, formatDuration, phaseLabel } from '../data'

interface Props {
  agent: Agent
  initialTranscript: ChatEntry[]
  initialTranscriptError?: string
  onClose: () => void
  onSendMessage: (sessionId: string, message: string) => Promise<void>
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
  isMockData: boolean
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

function similarNormalizedContent(a: string, b: string) {
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
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
  if ((a.kind === 'tool_call' || a.kind === 'tool_result') && a.toolName && b.toolName) {
    if (a.toolName !== b.toolName) return false
    if (a.toolCallId && b.toolCallId && a.toolCallId === b.toolCallId) return true
    const aContent = normalizedContent(a.content)
    const bContent = normalizedContent(b.content)
    const aInput = normalizedContent(renderUnknown(a.toolInput))
    const bInput = normalizedContent(renderUnknown(b.toolInput))
    return similarNormalizedContent(aContent, bContent) || similarNormalizedContent(aInput, bInput)
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
  for (const entry of [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    const existingIndex = merged.findIndex(candidate => sameTranscriptEntry(candidate, entry))
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeTranscriptPair(merged[existingIndex], entry)
    } else {
      merged.push(entry)
    }
  }
  return merged
}

function transcriptEntrySignature(entry: ChatEntry) {
  return [
    entry.id,
    entry.kind,
    entry.role,
    entry.timestamp.getTime(),
    normalizedContent(entry.content),
    entry.toolCallId || '',
    entry.toolName || '',
    renderUnknown(entry.toolInput),
    entry.toolStatus || '',
    entry.reasoning || '',
    renderUnknown(entry.reasoningDetails),
  ].join('\u001f')
}

function transcriptSignature(entries: ChatEntry[]) {
  return entries.map(transcriptEntrySignature).join('\u001e')
}

function sameTranscriptEntries(a: ChatEntry[], b: ChatEntry[]) {
  return a.length === b.length && transcriptSignature(a) === transcriptSignature(b)
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

function approvalsForAgent(agent: Agent): PendingApproval[] {
  if (agent.approvals && agent.approvals.length > 0) return agent.approvals
  if (!agent.approvalId) return []
  return [{
    id: agent.approvalId,
    command: agent.approvalInput || '',
    description: agent.approvalDescription || '',
    surface: '',
    tool: agent.approvalTool || 'Approval',
    createdAt: agent.createdAt,
    status: agent.approvalStatus || 'pending',
    error: agent.approvalError,
  }]
}

function PendingApprovalCard({
  approval,
  index,
  total,
  onApprovalDecision,
}: {
  approval: PendingApproval
  index: number
  total: number
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const submitted = approval.status === 'submitted'
  const disabled = busy || submitted || approval.status !== 'pending' || index > 0
  const description = index > 0
    ? 'Waiting for earlier approval in this session.'
    : approval.error || approval.description || 'This action requires approval before it can continue.'

  async function decide(decision: 'approve' | 'deny') {
    if (disabled) return
    setBusy(true)
    try {
      await onApprovalDecision(approval.id, decision)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat-tool-approval">
      <div className="chat-tool-approval-label">
        <span className="attention-dot" />
        {total > 1 ? `APPROVAL ${index + 1}/${total}` : 'APPROVAL'} {approval.tool || 'Approval'} {approval.command}
      </div>
      <div className="chat-tool-approval-desc">{description}</div>
      <div className="chat-tool-approval-actions">
        <button className="btn-approve" disabled={disabled} onClick={() => void decide('approve')}>
          {busy || submitted ? 'SENDING' : 'APPROVE'}
        </button>
        <button className="btn-deny" disabled={disabled} onClick={() => void decide('deny')}>
          DENY
        </button>
      </div>
    </div>
  )
}

function PendingApprovals({
  agent,
  onApprovalDecision,
}: {
  agent: Agent
  onApprovalDecision: (approvalId: string, decision: 'approve' | 'deny') => Promise<void>
}) {
  const approvals = approvalsForAgent(agent)
  if (agent.phase !== 'waiting_for_approval' || approvals.length === 0) return null
  return (
    <div className="chat-pending-approvals">
      {approvals.map((approval, index) => (
        <PendingApprovalCard
          key={approval.id}
          approval={approval}
          index={index}
          total={approvals.length}
          onApprovalDecision={onApprovalDecision}
        />
      ))}
    </div>
  )
}

export function SessionChatModal({
  agent,
  initialTranscript,
  initialTranscriptError,
  onClose,
  onSendMessage,
  onApprovalDecision,
  isMockData,
}: Props) {
  const [entries, setEntries] = useState<ChatEntry[]>(() => (
    mergeTranscriptEntries(initialTranscript)
  ))
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [streamingMock, setStreamingMock] = useState(false)
  const [error, setError] = useState(initialTranscriptError || '')
  const [modalHeight, setModalHeight] = useState<number | null>(null)
  const [measuredInitialHeight, setMeasuredInitialHeight] = useState(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const approvalsRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const initialScrollSessionRef = useRef<string | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const streamTimersRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([])
  const stickToBottomRef = useRef(true)
  const initialTranscriptRef = useRef(initialTranscript)
  const initialTranscriptSignature = transcriptSignature(initialTranscript)
  const canSend = agent.phase !== 'ended'

  useEffect(() => {
    initialTranscriptRef.current = initialTranscript
  }, [initialTranscript])

  useEffect(() => {
    setLoading(false)
    setError(initialTranscriptError || '')
    initialScrollSessionRef.current = null
    stickToBottomRef.current = true
    const nextEntries = mergeTranscriptEntries(initialTranscriptRef.current)
    setEntries(prev => sameTranscriptEntries(prev, nextEntries) ? prev : nextEntries)
  }, [agent.sessionId, initialTranscriptSignature, initialTranscriptError])

  useEffect(() => {
    const live = agent.transcript || []
    if (live.length === 0) return
    setEntries(prev => {
      const nextEntries = mergeTranscriptEntries([...prev, ...live])
      return sameTranscriptEntries(prev, nextEntries) ? prev : nextEntries
    })
  }, [agent.transcript])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || loading || entries.length === 0) return
    if (initialScrollSessionRef.current !== agent.sessionId || stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      initialScrollSessionRef.current = agent.sessionId
    }
  }, [agent.sessionId, entries.length, loading])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const updateStickiness = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distance < 240
    }
    updateStickiness()
    el.addEventListener('scroll', updateStickiness, { passive: true })
    return () => el.removeEventListener('scroll', updateStickiness)
  }, [agent.sessionId])

  const computeModalHeight = useCallback(() => {
    const modal = modalRef.current
    const header = headerRef.current
    const approvals = approvalsRef.current
    const transcript = transcriptRef.current
    const composer = composerRef.current
    if (!modal || !header || !transcript || !composer) return

    const maxHeight = window.innerHeight - 32
    const naturalHeight =
      header.offsetHeight +
      (approvals?.offsetHeight ?? 0) +
      transcript.scrollHeight +
      composer.offsetHeight
    const nextHeight = Math.round(Math.min(maxHeight, Math.max(560, naturalHeight * 1.1)))

    setModalHeight(prev => (prev === nextHeight ? prev : nextHeight))
    setMeasuredInitialHeight(true)
  }, [])

  const scheduleModalResize = useCallback((delayMs = 120) => {
    if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null
      computeModalHeight()
    }, delayMs)
  }, [computeModalHeight])

  useLayoutEffect(() => {
    if (!measuredInitialHeight) {
      computeModalHeight()
      return
    }
    scheduleModalResize(entries.length > 0 ? 180 : 0)
    return () => {
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
    }
  }, [
    agent.sessionId,
    agent.phase,
    entries.length,
    loading,
    sending,
    error,
    draft,
    measuredInitialHeight,
    computeModalHeight,
    scheduleModalResize,
  ])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return

    scheduleModalResize(0)

    const observer = new ResizeObserver(() => scheduleModalResize(180))
    observer.observe(transcript)
    if (headerRef.current) observer.observe(headerRef.current)
    if (approvalsRef.current) observer.observe(approvalsRef.current)
    if (composerRef.current) observer.observe(composerRef.current)

    window.addEventListener('resize', computeModalHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', computeModalHeight)
    }
  }, [agent.sessionId, computeModalHeight, scheduleModalResize])

  useEffect(() => {
    return () => {
      for (const timer of streamTimersRef.current) window.clearTimeout(timer)
      streamTimersRef.current = []
    }
  }, [])

  function startMockStream() {
    if (streamingMock) return
    setStreamingMock(true)
    const startedAt = Date.now()
    const event = (offsetMs: number, entry: Omit<ChatEntry, 'timestamp' | 'source'>) => {
      const timer = window.setTimeout(() => {
        setEntries(prev => mergeTranscriptEntries([
          ...prev,
          {
            ...entry,
            timestamp: new Date(startedAt + offsetMs),
            source: 'live',
          },
        ]))
      }, offsetMs)
      streamTimersRef.current.push(timer)
    }

    const mockEntries: Array<[number, Omit<ChatEntry, 'timestamp' | 'source'>]> = [
      [0, {
        id: `mock-stream-${startedAt}-thinking-1`,
        kind: 'message',
        role: 'assistant',
        content: 'I am checking the current worker shape before changing autoscaling.',
        reasoning: 'Need deployment limits, current replicas, and any existing HPA so the recommendation does not fight the cluster state.',
      }],
      [520, {
        id: `mock-stream-${startedAt}-tool-1`,
        kind: 'tool_call',
        role: 'assistant',
        content: '{ "command": "kubectl get deploy worker -n production -o yaml" }',
        toolCallId: `mock-tool-${startedAt}-1`,
        toolName: 'terminal',
        toolInput: { command: 'kubectl get deploy worker -n production -o yaml' },
        toolStatus: 'success',
      }],
      [1040, {
        id: `mock-stream-${startedAt}-result-1`,
        kind: 'tool_result',
        role: 'tool',
        content: 'replicas: 3\nresources:\n  requests:\n    cpu: 500m\n    memory: 768Mi\n  limits:\n    cpu: "2"\n    memory: 2Gi',
        toolCallId: `mock-tool-${startedAt}-1`,
        toolName: 'terminal',
        toolStatus: 'success',
      }],
      [1560, {
        id: `mock-stream-${startedAt}-thinking-2`,
        kind: 'message',
        role: 'assistant',
        content: 'The worker has sane CPU limits, so I can size the HPA around utilization instead of raw queue depth.',
        reasoning: 'CPU autoscaling is available immediately. Queue-based scaling can come later through KEDA, but this change should stay focused.',
      }],
      [2180, {
        id: `mock-stream-${startedAt}-tool-2`,
        kind: 'tool_call',
        role: 'assistant',
        content: '{ "command": "kubectl get hpa worker -n production -o yaml || true" }',
        toolCallId: `mock-tool-${startedAt}-2`,
        toolName: 'terminal',
        toolInput: { command: 'kubectl get hpa worker -n production -o yaml || true' },
        toolStatus: 'success',
      }],
      [2780, {
        id: `mock-stream-${startedAt}-result-2`,
        kind: 'tool_result',
        role: 'tool',
        content: 'Error from server (NotFound): horizontalpodautoscalers.autoscaling "worker" not found',
        toolCallId: `mock-tool-${startedAt}-2`,
        toolName: 'terminal',
        toolStatus: 'success',
      }],
      [3380, {
        id: `mock-stream-${startedAt}-thinking-3`,
        kind: 'message',
        role: 'assistant',
        content: 'No HPA exists yet. I am adding one with conservative min and max bounds.',
        reasoning: 'Min replicas should match the current steady state. Max replicas needs room for bursts without letting a bad deploy overwhelm downstream services.',
      }],
      [4020, {
        id: `mock-stream-${startedAt}-tool-3`,
        kind: 'tool_call',
        role: 'assistant',
        content: '{ "command": "cat <<EOF > k8s/worker-hpa.yaml\\napiVersion: autoscaling/v2\\nkind: HorizontalPodAutoscaler\\nmetadata:\\n  name: worker\\n  namespace: production\\nspec:\\n  minReplicas: 3\\n  maxReplicas: 12\\nEOF" }',
        toolCallId: `mock-tool-${startedAt}-3`,
        toolName: 'terminal',
        toolInput: { command: 'write k8s/worker-hpa.yaml' },
        toolStatus: 'success',
      }],
      [4680, {
        id: `mock-stream-${startedAt}-result-3`,
        kind: 'tool_result',
        role: 'tool',
        content: 'wrote k8s/worker-hpa.yaml with CPU target utilization at 70%',
        toolCallId: `mock-tool-${startedAt}-3`,
        toolName: 'terminal',
        toolStatus: 'success',
      }],
      [5320, {
        id: `mock-stream-${startedAt}-done`,
        kind: 'message',
        role: 'assistant',
        content: 'The mock autoscaler stream is complete. The modal should have resized smoothly as these transcript events arrived.',
        reasoning: 'This final message verifies the largest non-tool bubble path after the tool entries have expanded the transcript.',
      }],
    ]

    for (const [offsetMs, entry] of mockEntries) event(offsetMs, entry)
    const doneTimer = window.setTimeout(() => setStreamingMock(false), 5900)
    streamTimersRef.current.push(doneTimer)
  }

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
      <div
        className={`chat-modal${measuredInitialHeight ? ' measured' : ''}`}
        ref={modalRef}
        style={modalHeight ? { height: `${modalHeight}px` } : undefined}
      >
        <div className="chat-modal-head" ref={headerRef}>
          <div>
            <div className="chat-modal-kicker">SESSION CHAT</div>
            <div className="chat-modal-title">{agent.displayTitle}</div>
            <div className="chat-modal-meta">
              <span>{phaseLabel(agent.phase)}</span>
              <span>{agent.turnCount} turns</span>
              <span>{formatDuration(Date.now() - agent.createdAt.getTime())}</span>
            </div>
          </div>
          <div className="chat-modal-actions">
            {isMockData && (
              <button
                className="chat-test-stream"
                type="button"
                disabled={streamingMock}
                onClick={startMockStream}
              >
                {streamingMock ? 'STREAMING' : 'TEST STREAM'}
              </button>
            )}
            <button className="detail-close" onClick={onClose}>ESC</button>
          </div>
        </div>

        <div ref={approvalsRef}>
          <PendingApprovals agent={agent} onApprovalDecision={onApprovalDecision} />
        </div>

        <div className="chat-stream" ref={scrollerRef}>
          <div className="chat-stream-inner" ref={transcriptRef}>
            {loading && <div className="chat-empty">LOADING TRANSCRIPT...</div>}
            {!loading && entries.length === 0 && <div className="chat-empty">NO TRANSCRIPT EVENTS YET</div>}
            {entries.map(entry => (
              <ChatBubble
                key={entry.id}
                entry={entry}
                agent={agent}
                showApprovalActions={false}
                onApprovalDecision={onApprovalDecision}
              />
            ))}
            <SessionActivityPhase phase={agent.phase} />
          </div>
        </div>

        <div className="chat-compose" ref={composerRef}>
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
