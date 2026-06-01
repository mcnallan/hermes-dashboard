import { createConnection, createServer as createNetServer, type Socket } from 'net'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { unlinkSync, existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SOCKET_PATH = '/tmp/hermes-dashboard.sock'
const APPROVAL_SOCKET_PATH = '/tmp/hermes-dashboard-approval.sock'
const WS_PORT = 3001
const HTTP_PORT = 3002
const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const MAX_WEBHOOK_BYTES = 1_000_000
const MAX_APPROVAL_BYTES = 20_000

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
  command: string
  description: string
  surface: string
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
  turnCount: number
  filesModified: Set<string>
  firstUserMessage?: string
  pendingApproval?: PendingApproval
  usage: UsageState
  model?: string
  provider?: string
}

const sessions = new Map<string, Session>()
const activity: ActivityEntry[] = []
const approvalSessions = new Map<string, string>()
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
      turnCount: 0,
      filesModified: new Set(),
      usage: emptyUsage(),
    }
    sessions.set(sessionId, s)
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

function sessionForApproval(approvalId: string): Session | null {
  if (!approvalId) return null
  for (const session of sessions.values()) {
    if (session.pendingApproval?.id === approvalId) return session
  }
  const sessionId = approvalSessions.get(approvalId)
  if (sessionId) return sessions.get(sessionId) || null
  return null
}

function processEvent(payload: Record<string, unknown>) {
  let sessionId = payload.session_id as string
  if (!sessionId) return
  const event = payload.event as string
  if (event === 'ApprovalDecisionSubmitted' || event === 'ApprovalResponse') {
    sessionId = sessionForApproval(String(payload.approval_id || ''))?.sessionId || sessionId
  } else if (event === 'ApprovalRequest') {
    sessionId = relatedRealSession(sessionId, payload)?.sessionId || sessionId
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
      pushActivity(s, 'tool', `${tool} ${input}`, 'var(--text-display)')
      break
    }
    case 'PostToolUse': {
      s.phase = 'processing'
      const toolUseId = payload.tool_use_id as string
      const inProg = toolUseId ? s.toolsInProgress.get(toolUseId) : null
      if (inProg) {
        inProg.status = 'success'; inProg.durationMs = Date.now() - inProg.timestamp.getTime()
        s.recentTools.push(inProg); s.toolsInProgress.delete(toolUseId)
        if (s.recentTools.length > 30) s.recentTools = s.recentTools.slice(-30)
      }
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
      if (!s.firstUserMessage && msg) s.firstUserMessage = msg
      dropRelatedPlaceholders(s, payload)
      break
    }
    case 'Notification': {
      const notifType = payload.notification_type as string
      if (notifType === 'assistant_response') { s.lastMessage = (payload.message as string) || ''; s.lastMessageRole = 'assistant' }
      if (notifType === 'turn_complete') { s.phase = 'waiting_for_input'; pushActivity(s, 'phase', 'Waiting for input', 'var(--warning)') }
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
      s.pendingApproval = {
        id: approvalId,
        command,
        description,
        surface: String(payload.surface || ''),
        status: 'pending',
      }
      s.lastMessageRole = 'tool'
      s.lastToolName = String(payload.approval_tool || 'Approval')
      pushActivity(s, 'approval', approvalContent(payload), 'var(--accent)')
      break
    }
    case 'ApprovalDecisionSubmitted': {
      const approvalId = String(payload.approval_id || '')
      if (approvalId && s.pendingApproval?.id === approvalId) {
        const choice = String(payload.choice || '').toLowerCase()
        s.pendingApproval.status = 'submitted'
        s.pendingApproval.submittedChoice = choice === 'deny' ? 'deny' : 'once'
      }
      pushActivity(s, 'approval', `approval submitted: ${String(payload.choice || '')}`, 'var(--warning)')
      break
    }
    case 'ApprovalResponse': {
      const approvalId = String(payload.approval_id || '')
      const status = approvalChoiceToStatus(payload.choice)
      if (approvalId && s.pendingApproval?.id === approvalId) {
        s.pendingApproval.status = status
        if (status === 'approved' || status === 'denied' || status === 'timeout') {
          s.pendingApproval = undefined
        }
      }
      if (s.phase === 'waiting_for_approval') s.phase = 'processing'
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

  const events = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).events)
      ? (parsed as Record<string, unknown>).events
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
    if (session.pendingApproval?.id === approvalId) {
      return { session, approval: session.pendingApproval }
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
  found.session.pendingApproval = undefined
  if (found.session.phase === 'waiting_for_approval') found.session.phase = 'processing'
  pushActivity(found.session, 'approval', `approval ${finalStatus}: ${found.approval.command || found.approval.description || 'approval'}`, finalStatus === 'approved' ? 'var(--success)' : 'var(--accent)')
  broadcast()
  sendJson(res, 200, { ok: true, approval_id: found.approval.id, choice })
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
  const agents = Array.from(sessions.values()).map(s => ({
    sessionId: s.sessionId, displayTitle: displayTitle(s), cwd: s.cwd, phase: s.phase,
    lastActivity: s.lastActivity.toISOString(), createdAt: s.createdAt.toISOString(),
    pid: s.pid, tty: s.tty || '', tmuxTarget: '', lastMessage: s.lastMessage,
    lastMessageRole: s.lastMessageRole, lastToolName: s.lastToolName,
    toolsInProgress: Array.from(s.toolsInProgress.values()).map(t => ({ ...t, timestamp: t.timestamp.toISOString() })),
    recentTools: s.recentTools.map(t => ({ ...t, timestamp: t.timestamp.toISOString() })),
    approvalId: s.pendingApproval?.id,
    approvalTool: s.pendingApproval ? s.lastToolName || 'Approval' : undefined,
    approvalInput: s.pendingApproval?.command,
    approvalDescription: s.pendingApproval?.description,
    approvalStatus: s.pendingApproval?.status,
    approvalError: s.pendingApproval?.error,
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
  }))
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
  if (!m) return { meta: {} as Record<string, string>, body: content }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: m[2] }
}

function scanSkills() {
  const dir = join(HERMES_HOME, 'skills')
  if (!existsSync(dir)) return []
  const results: Record<string, unknown>[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (!statSync(p).isDirectory()) continue
    const skillMd = join(p, 'SKILL.md')
    if (existsSync(skillMd)) {
      const { meta, body } = parseFrontmatter(readSafe(skillMd))
      results.push({ name: meta.name || entry, category: '', ...meta, body })
      continue
    }
    // category dir
    for (const sub of readdirSync(p)) {
      const sp = join(p, sub)
      if (!statSync(sp).isDirectory()) continue
      const sm = join(sp, 'SKILL.md')
      if (existsSync(sm)) {
        const { meta, body } = parseFrontmatter(readSafe(sm))
        results.push({ name: meta.name || sub, category: entry, ...meta, body })
      }
    }
  }
  return results.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function scanPlugins() {
  const dir = join(HERMES_HOME, 'plugins')
  if (!existsSync(dir)) return []
  const results: Record<string, unknown>[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (!statSync(p).isDirectory() || entry.endsWith('.disabled')) continue
    const yaml = join(p, 'plugin.yaml')
    const manifest = existsSync(yaml) ? parseFrontmatter('---\n' + readSafe(yaml) + '\n---\n').meta : {}
    results.push({ name: entry, ...manifest })
  }
  return results
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
  verifyClient: ({ origin }) => !origin || ALLOWED_ORIGINS.includes(origin),
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
