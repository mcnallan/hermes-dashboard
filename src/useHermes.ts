import { useState, useEffect, useRef } from 'react'
import { type Agent, type ActivityEvent, agents as mockAgents, activityFeed as mockFeed } from './data'

const HOST = window.location.hostname === 'localhost'
  ? '127.0.0.1'
  : (window.location.hostname || '127.0.0.1')
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${HOST}:3001`
const API_URL = `http://${HOST}:3002`
const RECONNECT_MS = 2000

interface ServerState {
  type: 'state'
  agents: Agent[]
  activityFeed: ActivityEvent[]
}

function hydrateDates(raw: ServerState): { agents: Agent[]; activityFeed: ActivityEvent[] } {
  const agents = raw.agents.map(a => ({
    ...a,
    lastActivity: new Date(a.lastActivity),
    createdAt: new Date(a.createdAt),
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

export function useHermes() {
  const [agents, setAgents] = useState<Agent[]>(mockAgents)
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>(mockFeed)
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
          setAgents(a.length > 0 ? a : mockAgents)
          setActivityFeed(f.length > 0 ? f : mockFeed)
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

  async function respondToApproval(approvalId: string, decision: 'approve' | 'deny') {
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
  }

  return { agents, activityFeed, connected, respondToApproval }
}
