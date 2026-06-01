export type Phase =
  | 'idle'
  | 'processing'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'compacting'
  | 'ended'

export type ToolStatus = 'running' | 'success' | 'error' | 'interrupted' | 'waiting_for_approval'

export interface ToolCall {
  id: string
  name: string
  input: string
  status: ToolStatus
  timestamp: Date
  durationMs?: number
}

export interface Subagent {
  id: string
  description: string
  tools: ToolCall[]
  startTime: Date
}

export interface Agent {
  sessionId: string
  displayTitle: string
  cwd: string
  phase: Phase
  lastActivity: Date
  createdAt: Date
  pid: number
  tty: string
  tmuxTarget: string
  lastMessage: string
  lastMessageRole: 'user' | 'assistant' | 'tool'
  lastToolName?: string
  toolsInProgress: ToolCall[]
  recentTools: ToolCall[]
  transcript?: ChatEntry[]
  subagents: Subagent[]
  approvalId?: string
  approvalTool?: string
  approvalInput?: string
  approvalDescription?: string
  approvalStatus?: 'pending' | 'submitted' | 'approved' | 'denied' | 'timeout' | 'error'
  approvalError?: string
  tokenCount: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  contextTokenCount?: number
  apiCallCount?: number
  model?: string
  provider?: string
  maxTokens: number
  turnCount: number
  filesModified: number
  linesChanged: number
  costUsd: number
}

export interface ActivityEvent {
  id: string
  sessionId: string
  agentTitle: string
  type: 'tool' | 'message' | 'approval' | 'phase'
  content: string
  timestamp: Date
  color?: string
}

export type ChatEntryKind = 'message' | 'tool_call' | 'tool_result' | 'phase'
export type ChatEntryRole = 'user' | 'assistant' | 'tool' | 'system'

export interface ChatEntry {
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

const now = new Date()
const ago = (min: number) => new Date(now.getTime() - min * 60_000)

export const agents: Agent[] = [
  {
    sessionId: 'sess_8a1f3d',
    displayTitle: 'migrate payments to stripe v4',
    cwd: '/home/user/projects/services/payments',
    phase: 'processing',
    lastActivity: ago(0.2),
    createdAt: ago(52),
    pid: 44120,
    tty: 'ttys002',
    tmuxTarget: 'work:0.0',
    lastMessage: 'Updating the webhook handler to use the new StripeEvent type. The v4 SDK changed the event structure significantly...',
    lastMessageRole: 'assistant',
    lastToolName: 'Edit',
    toolsInProgress: [
      { id: 't1a', name: 'Edit', input: 'src/webhooks/stripe.ts', status: 'running', timestamp: ago(0.1) },
    ],
    recentTools: [
      { id: 't1b', name: 'Read', input: 'package.json', status: 'success', timestamp: ago(12), durationMs: 40 },
      { id: 't1c', name: 'Bash', input: 'npm info stripe versions --json | jq ".[-5:]"', status: 'success', timestamp: ago(10), durationMs: 2100 },
      { id: 't1d', name: 'Bash', input: 'npm install stripe@4.1.0', status: 'success', timestamp: ago(8), durationMs: 6400 },
      { id: 't1e', name: 'Grep', input: 'Stripe\\.|stripe\\.', status: 'success', timestamp: ago(6), durationMs: 340 },
      { id: 't1f', name: 'Read', input: 'src/webhooks/stripe.ts', status: 'success', timestamp: ago(4), durationMs: 90 },
      { id: 't1g', name: 'Edit', input: 'src/lib/stripe-client.ts', status: 'success', timestamp: ago(2), durationMs: 210 },
      { id: 't1h', name: 'Edit', input: 'src/services/checkout.ts', status: 'success', timestamp: ago(1), durationMs: 180 },
    ],
    subagents: [
      {
        id: 'agent_p1',
        description: 'find all stripe API surface usage',
        startTime: ago(7),
        tools: [
          { id: 'sp1', name: 'Grep', input: 'stripe\\.(customers|subscriptions|invoices|paymentIntents)', status: 'success', timestamp: ago(6.8), durationMs: 520 },
          { id: 'sp2', name: 'Glob', input: 'src/**/*stripe*', status: 'success', timestamp: ago(6.5), durationMs: 25 },
          { id: 'sp3', name: 'Read', input: 'src/services/subscription.ts', status: 'success', timestamp: ago(6.2), durationMs: 110 },
        ],
      },
    ],
    tokenCount: 412_800,
    maxTokens: 1_000_000,
    turnCount: 24,
    filesModified: 6,
    linesChanged: 341,
    costUsd: 4.13,
    transcript: [
      {
        id: 'sess_8a1f3d-m1',
        kind: 'message',
        role: 'user',
        timestamp: ago(51),
        content: 'migrate payments to stripe v4',
        source: 'db',
      },
      {
        id: 'sess_8a1f3d-m2',
        kind: 'message',
        role: 'assistant',
        timestamp: ago(50.5),
        content: 'I found the Stripe webhook surface and I’m updating the event parsing to the v4 SDK shape.',
        reasoning: 'Plan:\n1. inspect all Stripe call sites\n2. update webhook event types\n3. run a quick pass for any stale helpers',
        source: 'db',
      },
      {
        id: 'sess_8a1f3d-t1',
        kind: 'tool_call',
        role: 'assistant',
        timestamp: ago(50),
        content: '{\n  "path": "src/webhooks/stripe.ts"\n}',
        toolCallId: 't1a',
        toolName: 'Read',
        toolInput: { path: 'src/webhooks/stripe.ts' },
        toolStatus: 'success',
        source: 'db',
      },
      {
        id: 'sess_8a1f3d-t2',
        kind: 'tool_result',
        role: 'tool',
        timestamp: ago(49.8),
        content: 'Updated webhook handler and related helpers to use the new StripeEvent typing.',
        toolCallId: 't1b',
        toolName: 'Edit',
        toolInput: { path: 'src/webhooks/stripe.ts' },
        toolStatus: 'success',
        source: 'db',
      },
    ],
  },
  {
    sessionId: 'sess_c2b7e4',
    displayTitle: 'debug OOM in image pipeline',
    cwd: '/home/user/projects/services/media',
    phase: 'waiting_for_approval',
    lastActivity: ago(0.5),
    createdAt: ago(28),
    pid: 44580,
    tty: 'ttys004',
    tmuxTarget: 'work:0.1',
    lastMessage: 'Found the leak. The sharp instance pool never releases buffers after resize. I need to run the repro script to confirm the fix.',
    lastMessageRole: 'assistant',
    approvalId: 'approval_mock_oom_001',
    approvalTool: 'Bash',
    approvalInput: 'node --max-old-space-size=256 scripts/repro-oom.js --verify-fix',
    approvalDescription: 'Run the repro script with a constrained heap to verify the OOM fix.',
    approvalStatus: 'pending',
    toolsInProgress: [],
    recentTools: [
      { id: 't2a', name: 'Bash', input: 'kubectl logs media-worker-7f8b9 --tail=200', status: 'success', timestamp: ago(10), durationMs: 3200 },
      { id: 't2b', name: 'Read', input: 'src/pipeline/resize.ts', status: 'success', timestamp: ago(8), durationMs: 130 },
      { id: 't2c', name: 'Read', input: 'src/pipeline/pool.ts', status: 'success', timestamp: ago(6), durationMs: 95 },
      { id: 't2d', name: 'Grep', input: 'sharp\\(|destroy\\(|dispose', status: 'success', timestamp: ago(5), durationMs: 280 },
      { id: 't2e', name: 'Edit', input: 'src/pipeline/pool.ts', status: 'success', timestamp: ago(2), durationMs: 190 },
      { id: 't2f', name: 'Write', input: 'scripts/repro-oom.js', status: 'success', timestamp: ago(1), durationMs: 150 },
    ],
    subagents: [],
    tokenCount: 203_100,
    maxTokens: 1_000_000,
    turnCount: 11,
    filesModified: 2,
    linesChanged: 38,
    costUsd: 2.03,
    transcript: [
      {
        id: 'sess_c2b7e4-m1',
        kind: 'message',
        role: 'user',
        timestamp: ago(27.7),
        content: 'debug the OOM in the image pipeline and verify the fix',
        source: 'db',
      },
      {
        id: 'sess_c2b7e4-m2',
        kind: 'message',
        role: 'assistant',
        timestamp: ago(27.2),
        content: 'I’ll reproduce the failure first, then inspect the pool lifecycle around sharp buffers.',
        reasoning: 'A constrained heap repro gives a stable signal before changing the release path.',
        source: 'db',
      },
      {
        id: 'sess_c2b7e4-t0',
        kind: 'tool_call',
        role: 'assistant',
        timestamp: ago(26.9),
        content: '{\n  "command": "node --max-old-space-size=256 scripts/repro-oom.js --iterations=400"\n}',
        toolCallId: 'mock-terminal-oom-001',
        toolName: 'terminal',
        toolInput: { command: 'node --max-old-space-size=256 scripts/repro-oom.js --iterations=400' },
        toolStatus: 'success',
        source: 'db',
      },
      {
        id: 'sess_c2b7e4-t0-result',
        kind: 'tool_result',
        role: 'tool',
        timestamp: ago(26.6),
        content: [
          'starting repro: 400 resize iterations, heap limit 256 MB',
          'iteration 050 rss=181MB heapUsed=62MB external=87MB pool.active=8 pool.idle=0',
          'iteration 100 rss=226MB heapUsed=74MB external=129MB pool.active=8 pool.idle=0',
          'iteration 150 rss=271MB heapUsed=81MB external=174MB pool.active=8 pool.idle=0',
          'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
          'stack: ImagePipeline.resize -> SharpPool.acquire -> SharpInstance.clone -> Buffer.from',
          'note: pool.release() returns instances to the idle queue but never calls destroy() after failed resize jobs',
        ].join('\n'),
        toolCallId: 'mock-terminal-oom-001',
        toolName: 'terminal',
        toolStatus: 'success',
        source: 'db',
      },
      {
        id: 'sess_c2b7e4-m3',
        kind: 'message',
        role: 'assistant',
        timestamp: ago(26.1),
        content: 'The repro confirms leaked external buffers after failed resize jobs. I updated the pool release path and need approval to run the constrained verification command.',
        reasoning: 'The follow-up command exercises the same failure mode after the pool cleanup change, so it should be treated as the acceptance check.',
        source: 'db',
      },
      {
        id: 'approval_mock_oom_001',
        kind: 'tool_call',
        role: 'assistant',
        timestamp: ago(25.8),
        content: '{\n  "command": "node --max-old-space-size=256 scripts/repro-oom.js --verify-fix"\n}',
        toolCallId: 'approval_mock_oom_001',
        toolName: 'terminal',
        toolInput: { command: 'node --max-old-space-size=256 scripts/repro-oom.js --verify-fix' },
        toolStatus: 'waiting_for_approval',
        source: 'db',
      },
    ],
  },
  {
    sessionId: 'sess_f5d9a2',
    displayTitle: 'add end-to-end encryption to chat',
    cwd: '/home/user/projects/apps/web',
    phase: 'processing',
    lastActivity: ago(0.3),
    createdAt: ago(90),
    pid: 43200,
    tty: 'ttys006',
    tmuxTarget: 'work:1.0',
    lastMessage: 'Implementing the key exchange protocol. Each conversation will have a derived key from the participants\' X25519 key pairs...',
    lastMessageRole: 'assistant',
    lastToolName: 'Write',
    toolsInProgress: [
      { id: 't3a', name: 'Write', input: 'src/lib/crypto/key-exchange.ts', status: 'running', timestamp: ago(0.2) },
      { id: 't3b', name: 'Write', input: 'src/lib/crypto/message-encrypt.ts', status: 'running', timestamp: ago(0.1) },
    ],
    recentTools: [
      { id: 't3c', name: 'Read', input: 'src/lib/chat/conversation.ts', status: 'success', timestamp: ago(20), durationMs: 140 },
      { id: 't3d', name: 'Bash', input: 'npm install @noble/curves @noble/ciphers', status: 'success', timestamp: ago(15), durationMs: 4800 },
      { id: 't3e', name: 'Write', input: 'src/lib/crypto/types.ts', status: 'success', timestamp: ago(8), durationMs: 120 },
      { id: 't3f', name: 'Write', input: 'src/lib/crypto/identity.ts', status: 'success', timestamp: ago(5), durationMs: 260 },
      { id: 't3g', name: 'Write', input: 'src/lib/crypto/__tests__/identity.test.ts', status: 'success', timestamp: ago(3), durationMs: 310 },
      { id: 't3h', name: 'Bash', input: 'npx vitest run src/lib/crypto', status: 'success', timestamp: ago(1.5), durationMs: 5200 },
    ],
    subagents: [
      {
        id: 'agent_e1',
        description: 'audit existing message storage schema',
        startTime: ago(22),
        tools: [
          { id: 'se1', name: 'Grep', input: 'message.*schema|MessageTable|messages.*table', status: 'success', timestamp: ago(21.5), durationMs: 380 },
          { id: 'se2', name: 'Read', input: 'src/db/schema/messages.ts', status: 'success', timestamp: ago(21), durationMs: 100 },
          { id: 'se3', name: 'Read', input: 'src/db/migrations/0042_add_messages.sql', status: 'success', timestamp: ago(20.5), durationMs: 70 },
        ],
      },
      {
        id: 'agent_e2',
        description: 'research signal protocol implementation',
        startTime: ago(25),
        tools: [
          { id: 'se4', name: 'WebSearch', input: 'X25519 key exchange typescript noble curves', status: 'success', timestamp: ago(24.5), durationMs: 1800 },
          { id: 'se5', name: 'WebFetch', input: 'https://github.com/nickcmaynard/...', status: 'success', timestamp: ago(23), durationMs: 2400 },
        ],
      },
    ],
    tokenCount: 687_400,
    maxTokens: 1_000_000,
    turnCount: 36,
    filesModified: 8,
    linesChanged: 892,
    costUsd: 6.87,
    transcript: [
      {
        id: 'sess_f5d9a2-m1',
        kind: 'message',
        role: 'user',
        timestamp: ago(89.7),
        content: 'add end-to-end encryption to chat',
        source: 'db',
      },
      {
        id: 'sess_f5d9a2-m2',
        kind: 'message',
        role: 'assistant',
        timestamp: ago(89.2),
        content: 'I’m implementing the key exchange and message encryption flow first, then I’ll wire the transport updates.',
        reasoning: 'Need to establish a per-conversation shared secret before message serialization and encryption can be made deterministic.',
        source: 'db',
      },
      {
        id: 'sess_f5d9a2-t1',
        kind: 'tool_call',
        role: 'assistant',
        timestamp: ago(88.8),
        content: '{\n  "file_path": "src/lib/crypto/key-exchange.ts"\n}',
        toolCallId: 't3a',
        toolName: 'Write',
        toolInput: { file_path: 'src/lib/crypto/key-exchange.ts' },
        toolStatus: 'success',
        source: 'db',
      },
      {
        id: 'sess_f5d9a2-t2',
        kind: 'tool_result',
        role: 'tool',
        timestamp: ago(88.6),
        content: 'Created shared-secret derivation and encrypted payload helpers.',
        toolCallId: 't3b',
        toolName: 'Write',
        toolInput: { file_path: 'src/lib/crypto/message-encrypt.ts' },
        toolStatus: 'success',
        source: 'db',
      },
    ],
  },
  {
    sessionId: 'sess_a7e1b3',
    displayTitle: 'set up k8s autoscaler for workers',
    cwd: '/home/user/projects/infra',
    phase: 'idle',
    lastActivity: ago(18),
    createdAt: ago(75),
    pid: 43600,
    tty: 'ttys008',
    tmuxTarget: 'work:1.1',
    lastMessage: 'Done. KEDA is configured with the SQS queue length trigger. Workers will scale 1-20 based on queue depth. Applied to staging, run `kubectl get scaledobjects -n workers` to verify.',
    lastMessageRole: 'assistant',
    toolsInProgress: [],
    recentTools: [
      { id: 't4a', name: 'Read', input: 'helm/workers/values.yaml', status: 'success', timestamp: ago(35), durationMs: 65 },
      { id: 't4b', name: 'Write', input: 'helm/workers/templates/scaledobject.yaml', status: 'success', timestamp: ago(30), durationMs: 200 },
      { id: 't4c', name: 'Edit', input: 'helm/workers/values.yaml', status: 'success', timestamp: ago(25), durationMs: 140 },
      { id: 't4d', name: 'Bash', input: 'helm upgrade workers ./helm/workers -n workers --dry-run', status: 'success', timestamp: ago(22), durationMs: 8900 },
      { id: 't4e', name: 'Bash', input: 'helm upgrade workers ./helm/workers -n workers', status: 'success', timestamp: ago(20), durationMs: 12400 },
      { id: 't4f', name: 'Bash', input: 'kubectl get scaledobjects -n workers', status: 'success', timestamp: ago(19), durationMs: 1100 },
    ],
    subagents: [],
    tokenCount: 356_700,
    maxTokens: 1_000_000,
    turnCount: 20,
    filesModified: 3,
    linesChanged: 94,
    costUsd: 3.57,
  },
  {
    sessionId: 'sess_b4c8d1',
    displayTitle: 'write openapi spec from route handlers',
    cwd: '/home/user/projects/services/api',
    phase: 'processing',
    lastActivity: ago(0.4),
    createdAt: ago(19),
    pid: 45100,
    tty: 'ttys010',
    tmuxTarget: 'work:2.0',
    lastMessage: 'Generating the OpenAPI 3.1 spec by parsing the Hono route definitions and Zod schemas...',
    lastMessageRole: 'assistant',
    lastToolName: 'Write',
    toolsInProgress: [
      { id: 't5a', name: 'Write', input: 'scripts/generate-openapi.ts', status: 'running', timestamp: ago(0.3) },
    ],
    recentTools: [
      { id: 't5b', name: 'Glob', input: 'src/routes/**/*.ts', status: 'success', timestamp: ago(8), durationMs: 30 },
      { id: 't5c', name: 'Read', input: 'src/routes/users.ts', status: 'success', timestamp: ago(7), durationMs: 120 },
      { id: 't5d', name: 'Read', input: 'src/routes/teams.ts', status: 'success', timestamp: ago(6), durationMs: 105 },
      { id: 't5e', name: 'Read', input: 'src/schemas/user.ts', status: 'success', timestamp: ago(5), durationMs: 80 },
      { id: 't5f', name: 'Grep', input: 'z\\.object|z\\.string|z\\.number', status: 'success', timestamp: ago(3), durationMs: 410 },
    ],
    subagents: [
      {
        id: 'agent_o1',
        description: 'catalog all route handlers',
        startTime: ago(9),
        tools: [
          { id: 'so1', name: 'Grep', input: 'app\\.(get|post|put|patch|delete)\\(', status: 'success', timestamp: ago(8.8), durationMs: 350 },
          { id: 'so2', name: 'Glob', input: 'src/schemas/**/*.ts', status: 'success', timestamp: ago(8.5), durationMs: 20 },
          { id: 'so3', name: 'Read', input: 'src/routes/index.ts', status: 'success', timestamp: ago(8.2), durationMs: 90 },
        ],
      },
    ],
    tokenCount: 145_200,
    maxTokens: 1_000_000,
    turnCount: 8,
    filesModified: 1,
    linesChanged: 420,
    costUsd: 1.45,
  },
  {
    sessionId: 'sess_e3f2a9',
    displayTitle: 'fix timezone bug in scheduling',
    cwd: '/home/user/projects/services/scheduler',
    phase: 'processing',
    lastActivity: ago(0.2),
    createdAt: ago(14),
    pid: 45400,
    tty: 'ttys012',
    tmuxTarget: 'work:2.1',
    lastMessage: 'fix timezone bug in scheduling',
    lastMessageRole: 'user',
    toolsInProgress: [],
    recentTools: [],
    subagents: [],
    tokenCount: 78_600,
    maxTokens: 1_000_000,
    turnCount: 1,
    filesModified: 0,
    linesChanged: 0,
    costUsd: 0.79,
    transcript: [
      {
        id: 'sess_e3f2a9-m1',
        kind: 'message',
        role: 'user',
        timestamp: ago(0.2),
        content: 'fix timezone bug in scheduling',
        source: 'db',
      },
    ],
  },
]

export const activityFeed = [
  { id: 'e1', sessionId: 'sess_8a1f3d', agentTitle: 'stripe migration', type: 'tool', content: 'Edit src/webhooks/stripe.ts', timestamp: ago(0.1), color: 'var(--text-display)' },
  { id: 'e2', sessionId: 'sess_f5d9a2', agentTitle: 'e2e encryption', type: 'tool', content: 'Write key-exchange.ts', timestamp: ago(0.2), color: 'var(--text-display)' },
  { id: 'e3', sessionId: 'sess_b4c8d1', agentTitle: 'openapi spec', type: 'tool', content: 'Write generate-openapi.ts', timestamp: ago(0.3), color: 'var(--text-display)' },
  { id: 'e4', sessionId: 'sess_c2b7e4', agentTitle: 'OOM debug', type: 'approval', content: 'Bash: node repro-oom.js', timestamp: ago(0.5), color: 'var(--accent)' },
  { id: 'e5', sessionId: 'sess_8a1f3d', agentTitle: 'stripe migration', type: 'tool', content: 'Edit src/services/checkout.ts', timestamp: ago(1), color: 'var(--success)' },
  { id: 'e6', sessionId: 'sess_f5d9a2', agentTitle: 'e2e encryption', type: 'tool', content: 'Bash: vitest run crypto', timestamp: ago(1.5), color: 'var(--success)' },
  { id: 'e7', sessionId: 'sess_c2b7e4', agentTitle: 'OOM debug', type: 'tool', content: 'Edit src/pipeline/pool.ts', timestamp: ago(2), color: 'var(--success)' },
  { id: 'e8', sessionId: 'sess_8a1f3d', agentTitle: 'stripe migration', type: 'tool', content: 'Edit src/lib/stripe-client.ts', timestamp: ago(2.5), color: 'var(--success)' },
  { id: 'e9', sessionId: 'sess_f5d9a2', agentTitle: 'e2e encryption', type: 'tool', content: 'Write identity.ts', timestamp: ago(5), color: 'var(--success)' },
  { id: 'e10', sessionId: 'sess_e3f2a9', agentTitle: 'timezone bug', type: 'phase', content: 'Agent working', timestamp: ago(0.2), color: 'var(--interactive)' },
  { id: 'e11', sessionId: 'sess_a7e1b3', agentTitle: 'k8s autoscaler', type: 'phase', content: 'Session idle', timestamp: ago(18), color: 'var(--text-disabled)' },
  { id: 'e12', sessionId: 'sess_f5d9a2', agentTitle: 'e2e encryption', type: 'tool', content: 'Write crypto/types.ts', timestamp: ago(8), color: 'var(--success)' },
] satisfies ActivityEvent[]
activityFeed.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'idle': return 'IDLE'
    case 'processing': return 'PROCESSING'
    case 'waiting_for_input': return 'AWAITING INPUT'
    case 'waiting_for_approval': return 'NEEDS APPROVAL'
    case 'compacting': return 'COMPACTING'
    case 'ended': return 'ENDED'
  }
}

export function phaseColor(phase: Phase): string {
  switch (phase) {
    case 'processing': return 'var(--text-display)'
    case 'waiting_for_approval': return 'var(--accent)'
    case 'waiting_for_input': return 'var(--warning)'
    case 'idle': return 'var(--text-disabled)'
    case 'compacting': return 'var(--interactive)'
    case 'ended': return 'var(--text-disabled)'
  }
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function toolStatusColor(status: ToolStatus): string {
  switch (status) {
    case 'running': return 'var(--text-display)'
    case 'success': return 'var(--success)'
    case 'error': return 'var(--accent)'
    case 'interrupted': return 'var(--warning)'
    case 'waiting_for_approval': return 'var(--accent)'
  }
}

export function sessionDuration(agent: Agent): string {
  const ms = Date.now() - agent.createdAt.getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function getToolBreakdown(agentsList: Agent[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const agent of agentsList) {
    const all = [...agent.recentTools, ...agent.toolsInProgress]
    for (const sub of agent.subagents) all.push(...sub.tools)
    for (const t of all) {
      counts[t.name] = (counts[t.name] || 0) + 1
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}
