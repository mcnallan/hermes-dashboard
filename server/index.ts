import { createConnection, createServer as createNetServer, type Socket } from 'net'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { unlinkSync, existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { load as yamlLoad } from 'js-yaml'

const SOCKET_PATH = '/tmp/hermes-dashboard.sock'
const APPROVAL_SOCKET_PATH = '/tmp/hermes-dashboard-approval.sock'
const DEFAULT_CHAT_SOCKET_PATH = '/tmp/hermes-dashboard-chat.sock'
const WS_PORT = 3001
const HTTP_PORT = 3002
const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const MAX_WEBHOOK_BYTES = 1_000_000
const MAX_APPROVAL_BYTES = 20_000
const MAX_CHAT_BYTES = 100_000
const execFileAsync = promisify(execFile)

// =========================================================================
// Dashboard state
// =========================================================================

interface ToolEntry {
  id: string
  name: string
  input: string
  status: string
  timestamp: Date
  durationMs?: number
  output?: string
}

type ChatEntryRole = 'user' | 'assistant' | 'tool' | 'system'
type ChatEntryKind = 'message' | 'tool_call' | 'tool_result' | 'phase'

interface ChatEntry {
  id: string
  kind: ChatEntryKind
  role: ChatEntryRole
  timestamp: Date
  content: string
  toolCallId?: string
  toolName?: string
  toolInput?: unknown
  toolStatus?: string
  reasoning?: string
  reasoningDetails?: unknown
  source: 'db' | 'live'
}

interface ActivityEntry {
  id: string
  sessionId: string
  agentTitle: string
  type: 'tool' | 'message' | 'approval' | 'phase'
  content: string
  timestamp: Date
  color: string
}

interface PendingApproval {
  id: string
  sessionKey?: string
  command: string
  description: string
  surface: string
  tool?: string
  createdAt: Date
  status: 'pending' | 'submitted' | 'approved' | 'denied' | 'timeout' | 'error'
  submittedChoice?: 'once' | 'deny'
  error?: string
}

interface UsageState {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  promptTokens: number
  totalTokens: number
  apiCallCount: number
  estimatedCostUsd: number
}

interface Session {
  sessionId: string
  source?: string
  agent: string
  cwd: string
  phase: string
  pid: number
  tty: string
  lastActivity: Date
  createdAt: Date
  lastMessage: string
  lastMessageRole: 'user' | 'assistant' | 'tool'
  lastToolName?: string
  toolsInProgress: Map<string, ToolEntry>
  recentTools: ToolEntry[]
  transcript: ChatEntry[]
  turnCount: number
  filesModified: Set<string>
  firstUserMessage?: string
  pendingApprovals: Map<string, PendingApproval>
  usage: UsageState
  model?: string
  provider?: string
  streamingMessageId?: string
  chatSocket?: string
}

const sessions = new Map<string, Session>()
const activity: ActivityEntry[] = []
const approvalSessions = new Map<string, string>()
const sessionKeys = new Map<string, string>()
let counter = 0

function emptyUsage(): UsageState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
    apiCallCount: 0,
    estimatedCostUsd: 0,
  }
}

function getOrCreateSession(sessionId: string, payload: Record<string, unknown>): Session {
  let s = sessions.get(sessionId)
  if (!s) {
    s = {
      sessionId,
      agent: (payload.agent as string) || 'agent',
      cwd: (payload.cwd as string) || '',
      phase: 'waiting_for_input',
      pid: (payload.pid as number) || 0,
      tty: (payload.tty as string) || '',
      lastActivity: new Date(),
      createdAt: new Date(),
      lastMessage: '',
      lastMessageRole: 'assistant',
      toolsInProgress: new Map(),
      recentTools: [],
      transcript: [],
      turnCount: 0,
      filesModified: new Set(),
      pendingApprovals: new Map(),
      usage: emptyUsage(),
    }
    sessions.set(sessionId, s)
  }
  if (typeof payload.chat_socket === 'string' && payload.chat_socket.trim()) {
    s.chatSocket = payload.chat_socket.trim()
  }
  if (typeof payload.session_key === 'string' && payload.session_key.trim()) {
    sessionKeys.set(payload.session_key.trim(), s.sessionId)
  }
  return s
}

function sameRuntime(a: Session, payload: Record<string, unknown>): boolean {
  const pid = numberValue(payload.pid)
  const tty = String(payload.tty || '')
  const cwd = String(payload.cwd || '')
  if (pid && a.pid && pid !== a.pid) return false
  if (tty && a.tty && tty !== a.tty) return false
  if (cwd && a.cwd && cwd !== a.cwd) return false
  return Boolean(pid || tty || cwd)
}

function isPlaceholderSession(s: Session): boolean {
  return !s.firstUserMessage && s.agent === 'agent' && !s.lastMessage
}

function relatedRealSession(incomingId: string, payload: Record<string, unknown>): Session | null {
  for (const session of sessions.values()) {
    if (session.sessionId === incomingId) continue
    if (!sameRuntime(session, payload)) continue
    if (session.firstUserMessage || session.lastMessageRole === 'user') return session
  }
  return null
}

function dropRelatedPlaceholders(target: Session, payload: Record<string, unknown>) {
  if (!target.firstUserMessage) return
  for (const session of sessions.values()) {
    if (session.sessionId === target.sessionId) continue
    if (!isPlaceholderSession(session)) continue
    if (!sameRuntime(session, payload)) continue
    sessions.delete(session.sessionId)
  }
}

function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function usageFromPayload(value: unknown): UsageState {
  const u = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const inputTokens = numberValue(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens)
  const outputTokens = numberValue(u.output_tokens ?? u.outputTokens ?? u.completion_tokens)
  const cacheReadTokens = numberValue(u.cache_read_tokens ?? u.cacheReadTokens ?? u.cache_read_input_tokens)
  const cacheWriteTokens = numberValue(u.cache_write_tokens ?? u.cacheWriteTokens ?? u.cache_creation_input_tokens)
  const reasoningTokens = numberValue(u.reasoning_tokens ?? u.reasoningTokens)
  const promptTokens = numberValue(u.prompt_tokens ?? u.promptTokens) || inputTokens + cacheReadTokens + cacheWriteTokens
  const totalTokens = numberValue(u.total_tokens ?? u.totalTokens) || promptTokens + outputTokens
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    promptTokens,
    totalTokens,
    apiCallCount: numberValue(u.api_call_count ?? u.apiCallCount),
    estimatedCostUsd: numberValue(u.estimated_cost_usd ?? u.estimatedCostUsd),
  }
}

function applyUsageEvent(s: Session, payload: Record<string, unknown>) {
  if (payload.model) s.model = String(payload.model)
  if (payload.provider) s.provider = String(payload.provider)

  const absolute = usageFromPayload(payload.session_usage)
  if (absolute.totalTokens > 0 || absolute.apiCallCount > 0) {
    s.usage = {
      ...absolute,
      apiCallCount: absolute.apiCallCount || numberValue(payload.api_call_count) || s.usage.apiCallCount,
      estimatedCostUsd: absolute.estimatedCostUsd || s.usage.estimatedCostUsd,
    }
    return
  }

  const delta = usageFromPayload(payload.usage)
  if (delta.totalTokens <= 0) return
  s.usage.inputTokens += delta.inputTokens
  s.usage.outputTokens += delta.outputTokens
  s.usage.cacheReadTokens += delta.cacheReadTokens
  s.usage.cacheWriteTokens += delta.cacheWriteTokens
  s.usage.reasoningTokens += delta.reasoningTokens
  s.usage.promptTokens += delta.promptTokens
  s.usage.totalTokens += delta.totalTokens
  s.usage.apiCallCount += 1
  s.usage.estimatedCostUsd += numberValue(payload.estimated_cost_usd ?? delta.estimatedCostUsd)
}

function toolInputSummary(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') return String(input || '')
  const o = input as Record<string, unknown>
  if (o.file_path) return String(o.file_path)
  if (o.command) return String(o.command).slice(0, 80)
  if (o.pattern) return String(o.pattern)
  if (o.query) return String(o.query)
  return JSON.stringify(o).slice(0, 80)
}

function approvalChoiceToStatus(choice: unknown): PendingApproval['status'] {
  const value = String(choice || '').toLowerCase()
  if (value === 'once' || value === 'session' || value === 'always' || value === 'approve' || value === 'approved') return 'approved'
  if (value === 'timeout') return 'timeout'
  if (value === 'error') return 'error'
  return 'denied'
}

function approvalContent(payload: Record<string, unknown>): string {
  const command = String(payload.command || '')
  const description = String(payload.description || '')
  if (command && description) return `${command} (${description})`
  return command || description || 'approval requested'
}

function pushTranscript(s: Session, entry: Omit<ChatEntry, 'id' | 'timestamp' | 'source'> & { id?: string, timestamp?: Date }) {
  s.transcript = mergeTranscriptEntries([...s.transcript, {
    ...entry,
    id: entry.id || `c${++counter}`,
    timestamp: entry.timestamp || new Date(),
    source: 'live',
  }])
  if (s.transcript.length > 300) s.transcript = s.transcript.slice(-300)
}

function normalizedContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function hasReasoning(entry: ChatEntry): boolean {
  return Boolean(
    (typeof entry.reasoning === 'string' && entry.reasoning.trim()) ||
    entry.reasoningDetails,
  )
}

function sameTranscriptEntry(a: ChatEntry, b: ChatEntry): boolean {
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

function mergeTranscriptEntries(entries: ChatEntry[]): ChatEntry[] {
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

function sessionForApproval(approvalId: string): Session | null {
  if (!approvalId) return null
  for (const session of sessions.values()) {
    if (session.pendingApprovals.has(approvalId)) return session
  }
  const sessionId = approvalSessions.get(approvalId)
  if (sessionId) return sessions.get(sessionId) || null
  return null
}

function activeApprovals(s: Session): PendingApproval[] {
  return Array.from(s.pendingApprovals.values())
    .filter(a => a.status === 'pending' || a.status === 'submitted' || a.status === 'error')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

function sessionIdForApprovalRequest(incomingId: string, payload: Record<string, unknown>): string {
  const key = typeof payload.session_key === 'string' ? payload.session_key.trim() : ''
  if (key) return sessionKeys.get(key) || incomingId
  return relatedRealSession(incomingId, payload)?.sessionId || incomingId
}

function processEvent(payload: Record<string, unknown>) {
  let sessionId = payload.session_id as string
  if (!sessionId) return
  const event = payload.event as string
  if (event === 'ApprovalDecisionSubmitted' || event === 'ApprovalResponse') {
    sessionId = sessionForApproval(String(payload.approval_id || ''))?.sessionId || sessionId
  } else if (event === 'ApprovalRequest') {
    sessionId = sessionIdForApprovalRequest(sessionId, payload)
  }
  const s = getOrCreateSession(sessionId, payload)
  s.lastActivity = new Date()
  if (payload.cwd) s.cwd = payload.cwd as string
  if (payload.pid) s.pid = payload.pid as number
  if (payload.tty) s.tty = payload.tty as string
  if (payload.agent) s.agent = payload.agent as string
  switch (event) {
    case 'SessionStart': { s.phase = 'waiting_for_input'; pushActivity(s, 'phase', 'Session started', 'var(--success)'); break }
    case 'PreToolUse': {
      s.phase = 'processing'
      const tool = payload.tool as string
      const id = (payload.tool_use_id as string) || `t${++counter}`
      const input = toolInputSummary(tool, payload.tool_input)
      s.toolsInProgress.set(id, { id, name: tool, input, status: 'running', timestamp: new Date() })
      s.lastToolName = tool; s.lastMessageRole = 'tool'
      pushTranscript(s, {
        id: `tool-call-${id}`,
        kind: 'tool_call',
        role: 'assistant',
        content: input,
        toolCallId: id,
        toolName: tool,
        toolInput: payload.tool_input,
        toolStatus: 'running',
      })
      pushActivity(s, 'tool', `${tool} ${input}`, 'var(--text-display)')
      break
    }
    case 'PostToolUse': {
      s.phase = 'processing'
      const toolUseId = payload.tool_use_id as string
      const inProg = toolUseId ? s.toolsInProgress.get(toolUseId) : null
      if (inProg) {
        inProg.status = 'success'; inProg.durationMs = Date.now() - inProg.timestamp.getTime()
        inProg.output = String(payload.message || '')
        s.recentTools.push(inProg); s.toolsInProgress.delete(toolUseId)
        if (s.recentTools.length > 30) s.recentTools = s.recentTools.slice(-30)
      }
      pushTranscript(s, {
        id: `tool-result-${toolUseId || ++counter}`,
        kind: 'tool_result',
        role: 'tool',
        content: String(payload.message || ''),
        toolCallId: toolUseId,
        toolName: String(payload.tool || ''),
        toolInput: payload.tool_input,
        toolStatus: 'success',
      })
      const tool = payload.tool as string
      if (tool === 'Edit' || tool === 'Write') {
        const path = (payload.tool_input as Record<string, unknown>)?.file_path
        if (path) s.filesModified.add(String(path))
      }
      break
    }
    case 'UserPromptSubmit': {
      s.phase = 'processing'; const msg = (payload.message as string) || ''
      s.lastMessage = msg; s.lastMessageRole = 'user'; s.turnCount++
      s.streamingMessageId = undefined
      pushTranscript(s, { kind: 'message', role: 'user', content: msg })
      if (!s.firstUserMessage && msg) s.firstUserMessage = msg
      dropRelatedPlaceholders(s, payload)
      break
    }
    case 'Notification': {
      const notifType = payload.notification_type as string
      if (notifType === 'assistant_delta') {
        const delta = (payload.message as string) || ''
        if (!delta) break
        s.lastMessage = (s.lastMessageRole === 'assistant' ? s.lastMessage : '') + delta
        s.lastMessageRole = 'assistant'
      }
      if (notifType === 'assistant_response') {
        const msg = (payload.message as string) || ''
        s.lastMessage = msg; s.lastMessageRole = 'assistant'
        s.streamingMessageId = undefined
        pushTranscript(s, {
          kind: 'message',
          role: 'assistant',
          content: msg,
          reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : undefined,
          reasoningDetails: payload.reasoning_details,
        })
      }
      if (notifType === 'turn_complete') {
        s.phase = 'waiting_for_input'
        s.streamingMessageId = undefined
        pushTranscript(s, { kind: 'phase', role: 'system', content: 'Agent finished' })
        pushActivity(s, 'phase', 'Agent finished', 'var(--success)')
      }
      const status = payload.status as string
      if (status === 'waiting_for_input' || status === 'waiting_for_approval') s.phase = status
      break
    }
    case 'ApprovalRequest': {
      const approvalId = String(payload.approval_id || '')
      const command = String(payload.command || '')
      const description = String(payload.description || '')
      if (!approvalId) break
      approvalSessions.set(approvalId, s.sessionId)
      dropRelatedPlaceholders(s, payload)
      s.phase = 'waiting_for_approval'
      s.pendingApprovals.set(approvalId, {
        id: approvalId,
        sessionKey: typeof payload.session_key === 'string' ? payload.session_key : undefined,
        command,
        description,
        surface: String(payload.surface || ''),
        tool: String(payload.approval_tool || 'Approval'),
        createdAt: new Date(),
        status: 'pending',
      })
      s.lastMessageRole = 'tool'
      s.lastToolName = String(payload.approval_tool || 'Approval')
      pushActivity(s, 'approval', approvalContent(payload), 'var(--accent)')
      break
    }
    case 'ApprovalDecisionSubmitted': {
      const approvalId = String(payload.approval_id || '')
      const approval = approvalId ? s.pendingApprovals.get(approvalId) : undefined
      if (approval) {
        const choice = String(payload.choice || '').toLowerCase()
        approval.status = 'submitted'
        approval.submittedChoice = choice === 'deny' ? 'deny' : 'once'
      }
      pushActivity(s, 'approval', `approval submitted: ${String(payload.choice || '')}`, 'var(--warning)')
      break
    }
    case 'ApprovalResponse': {
      const approvalId = String(payload.approval_id || '')
      const status = approvalChoiceToStatus(payload.choice)
      const approval = approvalId ? s.pendingApprovals.get(approvalId) : undefined
      if (approval) {
        approval.status = status
        if (status === 'approved' || status === 'denied' || status === 'timeout') {
          s.pendingApprovals.delete(approvalId)
          approvalSessions.delete(approvalId)
        }
      }
      if (s.phase === 'waiting_for_approval' && activeApprovals(s).length === 0) s.phase = 'processing'
      pushActivity(s, 'approval', `approval ${status}: ${approvalContent(payload)}`, status === 'approved' ? 'var(--success)' : 'var(--accent)')
      break
    }
    case 'LlmUsage': {
      applyUsageEvent(s, payload)
      break
    }
    case 'SessionEnd': { s.phase = 'ended'; pushActivity(s, 'phase', 'Session ended', 'var(--text-disabled)'); break }
  }
  broadcast()
}

function processWebhookBody(body: string) {
  const trimmed = body.trim()
  if (!trimmed) return 0

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    parsed = trimmed.split('\n').map(line => JSON.parse(line) as unknown)
  }

  const events: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).events)
      ? (parsed as Record<string, unknown>).events as unknown[]
      : [parsed]

  let count = 0
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    processEvent(event as Record<string, unknown>)
    count++
  }
  return count
}

function readJsonBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_WEBHOOK_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode
  res.end(JSON.stringify(data))
}

function findApproval(approvalId: string): { session: Session, approval: PendingApproval } | null {
  for (const session of sessions.values()) {
    const approval = session.pendingApprovals.get(approvalId)
    if (approval) {
      return { session, approval }
    }
  }
  return null
}

function sendApprovalControl(approvalId: string, choice: 'once' | 'deny'): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const client = createConnection(APPROVAL_SOCKET_PATH)
    let response = ''
    let requestSent = false

    const timeout = setTimeout(() => {
      client.destroy()
      reject(new Error('approval control timed out'))
    }, 5000)

    client.setEncoding('utf8')
    client.on('connect', () => {
      requestSent = true
      client.end(JSON.stringify({ approval_id: approvalId, choice }))
    })
    client.on('data', chunk => {
      response += chunk
      if (response.length > MAX_APPROVAL_BYTES) {
        client.destroy()
        reject(new Error('approval control response too large'))
      }
    })
    client.on('end', () => {
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(response || '{}') as Record<string, unknown>)
      } catch {
        reject(new Error('invalid approval control response'))
      }
    })
    client.on('error', err => {
      clearTimeout(timeout)
      if (!requestSent && 'code' in err && err.code === 'ENOENT') {
        reject(new Error('approval control socket not available'))
        return
      }
      reject(err)
    })
  })
}

async function approvalHandler(req: IncomingMessage, res: ServerResponse, url: string) {
  const match = url.match(/^\/api\/approvals\/([^/]+)\/respond$/)
  if (!match || req.method !== 'POST') return false

  const found = findApproval(decodeURIComponent(match[1]))
  if (!found) {
    sendJson(res, 404, { ok: false, error: 'approval not found' })
    return true
  }
  if (found.approval.status !== 'pending') {
    sendJson(res, 409, { ok: false, error: 'approval is not pending' })
    return true
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(await readJsonBody(req)) as Record<string, unknown>
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid json' })
    return true
  }

  const raw = String(body.decision || body.choice || '').toLowerCase()
  const choice = raw === 'approve' || raw === 'once' || raw === 'allow' ? 'once'
    : raw === 'deny' || raw === 'denied' ? 'deny'
      : ''
  if (!choice) {
    sendJson(res, 400, { ok: false, error: 'invalid decision' })
    return true
  }

  found.approval.status = 'submitted'
  found.approval.submittedChoice = choice
  broadcast()

  try {
    const control = await sendApprovalControl(found.approval.id, choice)
    if (control.ok !== true) {
      found.approval.status = 'error'
      found.approval.error = String(control.error || 'approval response failed')
      broadcast()
      sendJson(res, 502, { ok: false, error: found.approval.error })
      return true
    }
  } catch (err) {
    found.approval.status = 'error'
    found.approval.error = err instanceof Error ? err.message : 'approval response failed'
    broadcast()
    sendJson(res, 502, { ok: false, error: found.approval.error })
    return true
  }

  const finalStatus = choice === 'deny' ? 'denied' : 'approved'
  found.approval.status = finalStatus
  found.session.pendingApprovals.delete(found.approval.id)
  approvalSessions.delete(found.approval.id)
  if (found.session.phase === 'waiting_for_approval' && activeApprovals(found.session).length === 0) found.session.phase = 'processing'
  pushActivity(found.session, 'approval', `approval ${finalStatus}: ${found.approval.command || found.approval.description || 'approval'}`, finalStatus === 'approved' ? 'var(--success)' : 'var(--accent)')
  broadcast()
  sendJson(res, 200, { ok: true, approval_id: found.approval.id, choice })
  return true
}

function timestampFromDb(value: unknown): string {
  const n = numberValue(value)
  if (n > 1_000_000_000_000) return new Date(n).toISOString()
  if (n > 0) return new Date(n * 1000).toISOString()
  return new Date().toISOString()
}

function textValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const values: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function hermesEnv(): Record<string, string> {
  return { ...parseEnvFile(join(HERMES_HOME, '.env')), ...process.env } as Record<string, string>
}

function normalizeApiBaseUrl(value: string) {
  let base = value.trim().replace(/\/+$/, '')
  if (base.endsWith('/v1')) base = base.slice(0, -3)
  return base
}

function apiServerConfig(): { baseUrl: string, apiKey: string } {
  const env = hermesEnv()
  if (env.HERMES_API_SERVER_URL) {
    return {
      baseUrl: normalizeApiBaseUrl(env.HERMES_API_SERVER_URL),
      apiKey: env.HERMES_API_SERVER_KEY || env.API_SERVER_KEY || '',
    }
  }
  const rawHost = env.API_SERVER_HOST || '127.0.0.1'
  const host = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost
  const port = env.API_SERVER_PORT || '8642'
  return {
    baseUrl: `http://${host}:${port}`,
    apiKey: env.API_SERVER_KEY || '',
  }
}

async function readSessionDbSource(sessionId: string): Promise<string | null> {
  const code = `
import json, os, sys
from pathlib import Path
for p in [os.environ.get("HERMES_AGENT_PATH"), str(Path.home() / "Projects" / "hermes-agent")]:
    if p and p not in sys.path:
        sys.path.insert(0, p)
from hermes_state import SessionDB
db = SessionDB()
try:
    sid = db.resolve_session_id(sys.argv[1])
    session = db.get_session(sid) if sid else None
    if not session:
        print(json.dumps({"ok": False, "error": "session not found"}))
    else:
        print(json.dumps({"ok": True, "session_id": sid, "source": session.get("source")}))
finally:
    db.close()
`
  try {
    const { stdout } = await execFileAsync('python3', ['-c', code, sessionId], {
      maxBuffer: 200_000,
      env: process.env,
    })
    const parsed = JSON.parse(stdout || '{}') as { ok?: boolean, source?: string }
    return parsed.ok && parsed.source ? parsed.source : null
  } catch {
    return null
  }
}

async function drainApiSessionChatStream(res: Response) {
  try {
    if (!res.body) return
    const reader = res.body.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } catch (err) {
    console.warn('api session chat stream drain failed', err)
  }
}

async function sendApiSessionChat(sessionId: string, message: string): Promise<void> {
  const { baseUrl, apiKey } = apiServerConfig()
  if (!baseUrl) throw new Error('API server URL is not configured')
  if (!apiKey) throw new Error('API server key is not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let detail = `API session chat failed (${res.status})`
      try {
        const body = await res.json() as { error?: { message?: string }, message?: string }
        detail = body.error?.message || body.message || detail
      } catch {
        try {
          const text = await res.text()
          if (text.trim()) detail = text.trim().slice(0, 500)
        } catch { /* ignore */ }
      }
      throw new Error(detail)
    }
    void drainApiSessionChatStream(res)
  } finally {
    clearTimeout(timer)
  }
}

function normalizeDbMessage(row: Record<string, unknown>): ChatEntry[] {
  const id = String(row.id || `db-${++counter}`)
  const role = String(row.role || 'system') as ChatEntryRole
  const timestamp = new Date(timestampFromDb(row.timestamp))
  const entries: ChatEntry[] = []
  const reasoning = typeof row.reasoning === 'string' && row.reasoning ? row.reasoning
    : typeof row.reasoning_content === 'string' && row.reasoning_content ? row.reasoning_content
      : undefined
  const reasoningDetails = row.reasoning_details
  if (role === 'assistant' && Array.isArray(row.tool_calls) && row.tool_calls.length > 0) {
    const visible = textValue(row.content)
    if (visible.trim()) {
      entries.push({ id: `db-msg-${id}`, kind: 'message', role, timestamp, content: visible, reasoning, reasoningDetails, source: 'db' })
    }
    for (const call of row.tool_calls) {
      const c = call && typeof call === 'object' ? call as Record<string, unknown> : {}
      const fn = c.function && typeof c.function === 'object' ? c.function as Record<string, unknown> : {}
      const rawArgs = fn.arguments ?? c.arguments ?? ''
      let parsedArgs: unknown = rawArgs
      if (typeof rawArgs === 'string') {
        try { parsedArgs = JSON.parse(rawArgs) } catch { /* keep raw */ }
      }
      entries.push({
        id: `db-tool-call-${id}-${String(c.id || fn.name || entries.length)}`,
        kind: 'tool_call',
        role: 'assistant',
        timestamp,
        content: textValue(parsedArgs),
        toolCallId: String(c.id || ''),
        toolName: String(fn.name || c.name || ''),
        toolInput: parsedArgs,
        toolStatus: 'success',
        reasoning,
        reasoningDetails,
        source: 'db',
      })
    }
    return entries
  }
  entries.push({
    id: `db-msg-${id}`,
    kind: role === 'tool' ? 'tool_result' : 'message',
    role: role === 'user' || role === 'assistant' || role === 'tool' ? role : 'system',
    timestamp,
    content: textValue(row.content),
    toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined,
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    reasoning,
    reasoningDetails,
    source: 'db',
  })
  return entries
}

async function readSessionDbTranscript(sessionId: string): Promise<ChatEntry[]> {
  const code = `
import json, os, sys
from pathlib import Path
for p in [os.environ.get("HERMES_AGENT_PATH"), str(Path.home() / "Projects" / "hermes-agent")]:
    if p and p not in sys.path:
        sys.path.insert(0, p)
from hermes_state import SessionDB
db = SessionDB()
try:
    sid = db.resolve_session_id(sys.argv[1])
    if not sid:
        print(json.dumps({"ok": False, "error": "session not found"}))
    else:
        print(json.dumps({"ok": True, "session_id": sid, "messages": db.get_messages(sid)}))
finally:
    db.close()
`
  try {
    const { stdout } = await execFileAsync('python3', ['-c', code, sessionId], {
      maxBuffer: 5_000_000,
      env: process.env,
    })
    const parsed = JSON.parse(stdout || '{}') as { ok?: boolean, messages?: Record<string, unknown>[], error?: string }
    if (!parsed.ok) return []
    return (parsed.messages || []).flatMap(normalizeDbMessage)
  } catch {
    return []
  }
}

function serializeTranscript(entries: ChatEntry[]) {
  return entries.map(e => ({ ...e, timestamp: e.timestamp.toISOString() }))
}

async function transcriptHandler(req: IncomingMessage, res: ServerResponse, url: string) {
  const match = url.match(/^\/api\/sessions\/([^/]+)\/transcript$/)
  if (!match || req.method !== 'GET') return false

  const sessionId = decodeURIComponent(match[1])
  const dbEntries = await readSessionDbTranscript(sessionId)
  const liveEntries = sessions.get(sessionId)?.transcript || []
  const newestDb = dbEntries.reduce((max, e) => Math.max(max, e.timestamp.getTime()), 0)
  const merged = mergeTranscriptEntries([
    ...dbEntries,
    ...liveEntries.filter(e => e.timestamp.getTime() >= newestDb),
  ])
  sendJson(res, 200, { ok: true, session_id: sessionId, entries: serializeTranscript(merged) })
  return true
}

function sendChatControl(socketPath: string, sessionId: string, message: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath)
    let response = ''
    const timeout = setTimeout(() => {
      client.destroy()
      reject(new Error('chat control timed out'))
    }, 5000)

    client.setEncoding('utf8')
    client.on('connect', () => {
      client.end(JSON.stringify({ session_id: sessionId, message }))
    })
    client.on('data', chunk => {
      response += chunk
      if (response.length > MAX_APPROVAL_BYTES) {
        client.destroy()
        reject(new Error('chat control response too large'))
      }
    })
    client.on('end', () => {
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(response || '{}') as Record<string, unknown>)
      } catch {
        reject(new Error('invalid chat control response'))
      }
    })
    client.on('error', err => {
      clearTimeout(timeout)
      if ('code' in err && err.code === 'ENOENT') {
        reject(new Error(`chat control socket not available: ${socketPath}`))
        return
      }
      reject(err)
    })
  })
}

async function chatMessageHandler(req: IncomingMessage, res: ServerResponse, url: string) {
  const match = url.match(/^\/api\/sessions\/([^/]+)\/messages$/)
  if (!match || req.method !== 'POST') return false

  let body: Record<string, unknown>
  try {
    body = JSON.parse(await readJsonBody(req)) as Record<string, unknown>
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid json' })
    return true
  }
  const sessionId = decodeURIComponent(match[1])
  const message = String(body.message || '').trim()
  if (!message) {
    sendJson(res, 400, { ok: false, error: 'message is required' })
    return true
  }
  if (message.length > MAX_CHAT_BYTES) {
    sendJson(res, 413, { ok: false, error: 'message too large' })
    return true
  }

  try {
    const session = sessions.get(sessionId)
    const source = session?.source || await readSessionDbSource(sessionId)
    if (session && source) session.source = source

    if (source === 'api_server') {
      if (session?.phase === 'processing' || session?.phase === 'waiting_for_approval') {
        sendJson(res, 409, { ok: false, error: 'session is busy' })
        return true
      }
      await sendApiSessionChat(sessionId, message)
    } else {
      const control = await sendChatControl(session?.chatSocket || DEFAULT_CHAT_SOCKET_PATH, sessionId, message)
      if (control.ok !== true) {
        sendJson(res, 409, { ok: false, error: String(control.error || 'message rejected') })
        return true
      }
    }
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : 'message send failed' })
    return true
  }

  const session = sessions.get(sessionId)
  if (session) {
    session.phase = 'processing'
    session.lastMessage = message
    session.lastMessageRole = 'user'
    session.turnCount++
    pushTranscript(session, { kind: 'message', role: 'user', content: message })
    broadcast()
  }
  sendJson(res, 200, { ok: true })
  return true
}

function pushActivity(s: Session, type: ActivityEntry['type'], content: string, color: string) {
  activity.unshift({ id: `e${++counter}`, sessionId: s.sessionId, agentTitle: s.firstUserMessage?.slice(0, 40) || s.agent, type, content, timestamp: new Date(), color })
  if (activity.length > 100) activity.length = 100
}

function displayTitle(s: Session): string {
  return s.firstUserMessage ? s.firstUserMessage.slice(0, 60).toLowerCase() : s.agent
}

function serializeState(): string {
  const agents = Array.from(sessions.values()).map(s => {
    const approvals = activeApprovals(s)
    const firstApproval = approvals[0]
    return {
      sessionId: s.sessionId, displayTitle: displayTitle(s), cwd: s.cwd, phase: s.phase,
      lastActivity: s.lastActivity.toISOString(), createdAt: s.createdAt.toISOString(),
      pid: s.pid, tty: s.tty || '', tmuxTarget: '', lastMessage: s.lastMessage,
      lastMessageRole: s.lastMessageRole, lastToolName: s.lastToolName,
      toolsInProgress: Array.from(s.toolsInProgress.values()).map(t => ({ ...t, timestamp: t.timestamp.toISOString() })),
      recentTools: s.recentTools.map(t => ({ ...t, timestamp: t.timestamp.toISOString() })),
      transcript: serializeTranscript(s.transcript),
      approvals: approvals.map(a => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        tool: a.tool || s.lastToolName || 'Approval',
      })),
      approvalId: firstApproval?.id,
      approvalTool: firstApproval ? firstApproval.tool || s.lastToolName || 'Approval' : undefined,
      approvalInput: firstApproval?.command,
      approvalDescription: firstApproval?.description,
      approvalStatus: firstApproval?.status,
      approvalError: firstApproval?.error,
      subagents: [],
      tokenCount: s.usage.totalTokens,
      inputTokens: s.usage.inputTokens,
      outputTokens: s.usage.outputTokens,
      cacheReadTokens: s.usage.cacheReadTokens,
      cacheWriteTokens: s.usage.cacheWriteTokens,
      reasoningTokens: s.usage.reasoningTokens,
      contextTokenCount: s.usage.promptTokens,
      apiCallCount: s.usage.apiCallCount,
      model: s.model,
      provider: s.provider,
      maxTokens: 1_000_000,
      turnCount: s.turnCount,
      filesModified: s.filesModified.size, linesChanged: 0, costUsd: s.usage.estimatedCostUsd,
    }
  })
  return JSON.stringify({ type: 'state', agents, activityFeed: activity.slice(0, 50).map(e => ({ ...e, timestamp: e.timestamp.toISOString() })) })
}

// =========================================================================
// Wiki API -- reads from HERMES_HOME dynamically
// =========================================================================

function readSafe(path: string): string {
  try {
    // resolve symlinks and verify the real path is within HERMES_HOME
    const real = realpathSync(path)
    const hermesReal = realpathSync(HERMES_HOME)
    if (!real.startsWith(hermesReal)) return ''
    return readFileSync(real, 'utf-8')
  } catch { return '' }
}

function parseFrontmatter(content: string) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { meta: {} as Record<string, unknown>, body: content }
  const meta = parseYaml(m[1])
  return { meta, body: m[2] }
}

function parseYaml(content: string): Record<string, unknown> {
  try {
    const parsed = yamlLoad(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toStringList(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  }
  return [String(value).trim()].filter(Boolean)
}

function wikiConfig() {
  const raw = readSafe(join(HERMES_HOME, 'config.yaml'))
  return parseYaml(raw)
}

function skillDisabledNames(config: Record<string, unknown>): Set<string> {
  const skillsCfg = config.skills && typeof config.skills === 'object' && !Array.isArray(config.skills)
    ? config.skills as Record<string, unknown>
    : {}
  const platform = (process.env.HERMES_PLATFORM || process.env.HERMES_SESSION_PLATFORM || 'cli').trim()
  const platformDisabled = skillsCfg.platform_disabled && typeof skillsCfg.platform_disabled === 'object' && !Array.isArray(skillsCfg.platform_disabled)
    ? (skillsCfg.platform_disabled as Record<string, unknown>)[platform]
    : undefined
  const disabled = platformDisabled ?? skillsCfg.disabled
  return new Set(toStringList(disabled))
}

function skillPlatformNames(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(v => String(v).toLowerCase().trim()).filter(Boolean)
  return String(value)
    .replace(/[[\]]/g, '')
    .split(',')
    .map(v => v.toLowerCase().trim())
    .filter(Boolean)
}

function skillMatchesPlatform(meta: Record<string, unknown>): boolean {
  const platforms = skillPlatformNames(meta.platforms)
  if (platforms.length === 0) return true
  const platformMap: Record<string, string> = {
    macos: 'darwin',
    linux: 'linux',
    windows: 'win32',
  }
  return platforms.some(platform => process.platform.startsWith(platformMap[platform] || platform))
}

function skillState(meta: Record<string, unknown>, disabledNames: Set<string>, name: string): 'enabled' | 'disabled' | 'unsupported' {
  if (disabledNames.has(name)) return 'disabled'
  if (!skillMatchesPlatform(meta)) return 'unsupported'
  return 'enabled'
}

function pluginStateSets(config: Record<string, unknown>) {
  const pluginsCfg = config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
    ? config.plugins as Record<string, unknown>
    : {}
  return {
    enabled: new Set(toStringList(pluginsCfg.enabled)),
    disabled: new Set(toStringList(pluginsCfg.disabled)),
  }
}

function scanSkills() {
  const dir = join(HERMES_HOME, 'skills')
  if (!existsSync(dir)) return []
  const config = wikiConfig()
  const disabledNames = skillDisabledNames(config)
  const results: Record<string, unknown>[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (!statSync(p).isDirectory()) continue
    const skillMd = join(p, 'SKILL.md')
    if (existsSync(skillMd)) {
      const { meta, body } = parseFrontmatter(readSafe(skillMd))
      const name = String(meta.name || entry)
      const state = skillState(meta, disabledNames, name)
      results.push({ name, category: '', ...meta, body, enabled: state === 'enabled', state })
      continue
    }
    // category dir
    for (const sub of readdirSync(p)) {
      const sp = join(p, sub)
      if (!statSync(sp).isDirectory()) continue
      const sm = join(sp, 'SKILL.md')
      if (existsSync(sm)) {
        const { meta, body } = parseFrontmatter(readSafe(sm))
        const name = String(meta.name || sub)
        const state = skillState(meta, disabledNames, name)
        results.push({ name, category: entry, ...meta, body, enabled: state === 'enabled', state })
      }
    }
  }
  return results.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function scanPlugins() {
  const dir = join(HERMES_HOME, 'plugins')
  if (!existsSync(dir)) return []
  const config = wikiConfig()
  const { enabled, disabled } = pluginStateSets(config)
  const results = new Map<string, Record<string, unknown>>()
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (!statSync(p).isDirectory()) continue
    const dirName = entry.endsWith('.disabled') ? entry.replace(/\.disabled$/, '') : entry
    const yaml = join(p, 'plugin.yaml')
    const yml = join(p, 'plugin.yml')
    const manifest = existsSync(yaml)
      ? parseYaml(readSafe(yaml))
      : existsSync(yml)
        ? parseYaml(readSafe(yml))
        : {}
    const manifestName = typeof manifest.name === 'string' && manifest.name.trim()
      ? manifest.name.trim()
      : ''
    const name = manifestName || dirName
    const stateKeys = new Set([dirName, name].filter(Boolean))
    const explicitDisabled = entry.endsWith('.disabled') || [...stateKeys].some(key => disabled.has(key))
    const explicitEnabled = [...stateKeys].some(key => enabled.has(key))
    const state: 'enabled' | 'disabled' | 'not_enabled' = explicitDisabled ? 'disabled' : explicitEnabled ? 'enabled' : 'not_enabled'
    const record = { ...manifest, name, enabled: state === 'enabled', state }
    const current = results.get(name)
    if (!current || current.state === 'not_enabled' || state === 'disabled') {
      results.set(name, record)
    }
  }
  return [...results.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function wikiHandler(url: string): unknown {
  if (url === '/api/wiki') {
    const skills = scanSkills()
    const plugins = scanPlugins()
    const categories = [...new Set(skills.map(s => String(s.category)).filter(Boolean))]
    return {
      skillCount: skills.length,
      pluginCount: plugins.length,
      categories,
      hasConfig: existsSync(join(HERMES_HOME, 'config.yaml')),
      hasMemory: existsSync(join(HERMES_HOME, 'memories', 'MEMORY.md')),
      hasSoul: existsSync(join(HERMES_HOME, 'SOUL.md')),
    }
  }
  if (url === '/api/wiki/skills') return scanSkills()
  if (url.startsWith('/api/wiki/skills/')) {
    const name = decodeURIComponent(url.slice('/api/wiki/skills/'.length))
    return scanSkills().find(s => s.name === name) || null
  }
  if (url === '/api/wiki/plugins') return scanPlugins()
  if (url === '/api/wiki/config') {
    let cfg = readSafe(join(HERMES_HOME, 'config.yaml')) || '# No config found'
    // redact anything that looks like a secret
    cfg = cfg.replace(/(key|token|secret|password|credential|auth)([^:\n]*:\s*).+/gi, '$1$2[REDACTED]')
    return { content: cfg }
  }
  if (url === '/api/wiki/memory') return {
    memory: readSafe(join(HERMES_HOME, 'memories', 'MEMORY.md')) || '# No agent memory yet',
    user: readSafe(join(HERMES_HOME, 'memories', 'USER.md')) || '# No user profile yet',
  }
  if (url === '/api/wiki/soul') return { content: readSafe(join(HERMES_HOME, 'SOUL.md')) || '# No soul file found' }
  return null
}

// =========================================================================
// HTTP server
// =========================================================================

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.end(); return }
  if (req.method !== 'GET' && origin && !ALLOWED_ORIGINS.includes(origin)) {
    sendJson(res, 403, { error: 'origin not allowed' })
    return
  }

  if (await approvalHandler(req, res, req.url || '/')) return
  if (await chatMessageHandler(req, res, req.url || '/')) return
  if (await transcriptHandler(req, res, req.url || '/')) return

  if (req.method === 'POST' && (req.url === '/api/webhook' || req.url === '/api/events')) {
    try {
      const count = processWebhookBody(await readJsonBody(req))
      res.end(JSON.stringify({ ok: true, events: count }))
    } catch (err) {
      res.statusCode = err instanceof Error && err.message === 'payload too large' ? 413 : 400
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'invalid payload' }))
    }
    return
  }

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }

  const data = wikiHandler(req.url || '/')
  if (data === null) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return }
  res.end(JSON.stringify(data))
})

httpServer.listen(HTTP_PORT, () => console.log(`wiki API on http://localhost:${HTTP_PORT}`))

// =========================================================================
// WebSocket + Unix socket servers
// =========================================================================

const wss = new WebSocketServer({
  port: WS_PORT,
  verifyClient: ({ origin }: { origin?: string }) => !origin || ALLOWED_ORIGINS.includes(origin),
})
function broadcast() {
  const data = serializeState()
  for (const client of wss.clients) { if (client.readyState === WebSocket.OPEN) client.send(data) }
}
wss.on('connection', (ws) => { console.log('dashboard client connected'); ws.send(serializeState()) })

if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH)
const server = createNetServer((conn: Socket) => {
  let buffer = ''
  conn.on('data', (chunk) => { buffer += chunk.toString() })
  conn.on('end', () => {
    for (const line of buffer.split('\n').filter(Boolean)) {
      try { processEvent(JSON.parse(line)) } catch { /* skip */ }
    }
  })
})
server.listen(SOCKET_PATH, () => { console.log(`listening on ${SOCKET_PATH}`); console.log(`websocket on ws://localhost:${WS_PORT}`) })

process.on('SIGINT', () => { if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH); process.exit(0) })
process.on('SIGTERM', () => { if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH); process.exit(0) })
