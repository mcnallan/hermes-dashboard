import { useState, useEffect, useRef, useCallback } from 'react'
import { type Agent, type ActivityEvent, type ChatEntry, agents as mockAgents, activityFeed as mockFeed } from './data'

const HOST = window.location.hostname === 'localhost'
  ? '127.0.0.1'
  : (window.location.hostname || '127.0.0.1')
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${HOST}:3001`
const API_URL = `http://${HOST}:3002`
const RECONNECT_MS = 2000
const USE_MOCK_DATA = import.meta.env.VITE_HERMES_USE_MOCK_DATA !== 'false'

interface ServerState {
  type: 'state'
  agents: Agent[]
  activityFeed: ActivityEvent[]
}

type WireChatEntry = Omit<ChatEntry, 'timestamp'> & { timestamp: string }

function hydrateDates(raw: ServerState): { agents: Agent[]; activityFeed: ActivityEvent[] } {
  const agents = raw.agents.map(a => ({
    ...a,
    lastActivity: new Date(a.lastActivity),
    createdAt: new Date(a.createdAt),
    transcript: (a.transcript as unknown as WireChatEntry[] | undefined)?.map(e => ({ ...e, timestamp: new Date(e.timestamp) })),
    toolsInProgress: a.toolsInProgress.map(t => ({ ...t, timestamp: new Date(t.timestamp) })),
    recentTools: a.recentTools.map(t => ({ ...t, timestamp: new Date(t.timestamp) })),
    subagents: a.subagents.map(s => ({
      ...s,
      startTime: new Date(s.startTime),
      tools: s.tools.map(t => ({ ...t, timestamp: new Date(t.timestamp) })),
    })),
  }))
  const activityFeed = raw.activityFeed.map(e => ({ ...e, timestamp: new Date(e.timestamp) }))
  return { agents, activityFeed }
}

function hydrateTranscript(entries: WireChatEntry[]): ChatEntry[] {
  return entries.map(e => ({ ...e, timestamp: new Date(e.timestamp) }))
}

export function useHermes() {
  const [agents, setAgents] = useState<Agent[]>(USE_MOCK_DATA ? mockAgents : [])
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>(USE_MOCK_DATA ? mockFeed : [])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onmessage = (evt) => {
        try {
          const raw = JSON.parse(evt.data) as ServerState
          if (raw.type !== 'state') return
          const { agents: a, activityFeed: f } = hydrateDates(raw)
          setAgents(a.length > 0 ? a : USE_MOCK_DATA ? mockAgents : [])
          setActivityFeed(f.length > 0 ? f : USE_MOCK_DATA ? mockFeed : [])
        } catch { /* ignore bad messages */ }
      }

      ws.onclose = () => {
        setConnected(false)
        timerRef.current = setTimeout(connect, RECONNECT_MS)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [])

  const respondToApproval = useCallback(async function respondToApproval(approvalId: string, decision: 'approve' | 'deny') {
    const res = await fetch(`${API_URL}/api/approvals/${encodeURIComponent(approvalId)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    if (!res.ok) {
      let message = `approval response failed (${res.status})`
      try {
        const data = await res.json() as { error?: string }
        if (data.error) message = data.error
      } catch { /* ignore */ }
      throw new Error(message)
    }
  }, [])

  const getSessionTranscript = useCallback(async function getSessionTranscript(sessionId: string): Promise<ChatEntry[]> {
    const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/transcript`)
    if (!res.ok) throw new Error(`transcript request failed (${res.status})`)
    const data = await res.json() as { entries?: WireChatEntry[] }
    return hydrateTranscript(data.entries || [])
  }, [])

  const sendSessionMessage = useCallback(async function sendSessionMessage(sessionId: string, message: string) {
    const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) {
      let detail = `message send failed (${res.status})`
      try {
        const data = await res.json() as { error?: string }
        if (data.error) detail = data.error
      } catch { /* ignore */ }
      throw new Error(detail)
    }
  }, [])

  return { agents, activityFeed, connected, respondToApproval, getSessionTranscript, sendSessionMessage }
}
