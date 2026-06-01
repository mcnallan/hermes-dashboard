import { useState, useEffect } from 'react'
import { type Agent, type ChatEntry } from './data'
import { useHermes } from './useHermes'
import { Header } from './components/Header'
import { AttentionBanner } from './components/Stats'
import { AgentList } from './components/AgentList'
import { AgentDetail } from './components/AgentDetail'
import { SessionChatModal } from './components/SessionChatModal'
import { ToolBreakdown } from './components/ToolBreakdown'
import { ActivityFeed } from './components/ActivityFeed'
import { SessionTimeline } from './components/SessionTimeline'
import { Wiki } from './components/Wiki'
import './app.css'

type Theme = 'light' | 'dark'
type ChatTranscriptState = {
  sessionId: string
  entries: ChatEntry[]
  error?: string
}

export default function App() {
  const { agents, activityFeed, connected, isMockData, respondToApproval, getSessionTranscript, sendSessionMessage } = useHermes()
  const [selected, setSelected] = useState<Agent | null>(null)
  const [chatAgentId, setChatAgentId] = useState<string | null>(null)
  const [chatTranscript, setChatTranscript] = useState<ChatTranscriptState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [view, setView] = useState<'dashboard' | 'wiki'>('dashboard')
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem('hermes-theme')
    return stored === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.body.dataset.theme = theme
    window.localStorage.setItem('hermes-theme', theme)
  }, [theme])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (chatAgentId) setChatAgentId(null)
        else setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatAgentId])

  const selectedAgent = selected
    ? agents.find(a => a.sessionId === selected.sessionId) || null
    : null
  const chatAgent = chatAgentId
    ? agents.find(a => a.sessionId === chatAgentId) || selectedAgent
    : null

  useEffect(() => {
    if (!chatAgent) {
      setChatTranscript(null)
      return
    }

    let cancelled = false
    const fallback = chatAgent.transcript || []

    if (isMockData) {
      setChatTranscript({ sessionId: chatAgent.sessionId, entries: fallback })
      return () => { cancelled = true }
    }

    setChatTranscript(null)
    getSessionTranscript(chatAgent.sessionId)
      .then(entries => {
        if (cancelled) return
        setChatTranscript({
          sessionId: chatAgent.sessionId,
          entries: entries.length > 0 ? entries : fallback,
        })
      })
      .catch(err => {
        if (cancelled) return
        setChatTranscript({
          sessionId: chatAgent.sessionId,
          entries: fallback,
          error: err instanceof Error ? err.message : 'transcript failed',
        })
      })

    return () => { cancelled = true }
  }, [chatAgent?.sessionId, getSessionTranscript, isMockData])

  if (view === 'wiki') {
    return (
      <div className="app">
        <Wiki onBack={() => setView('dashboard')} />
      </div>
    )
  }

  return (
    <div className="app">
      <Header
        agents={agents}
        connected={connected}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        onWiki={() => setView('wiki')}
      />
      <AttentionBanner agents={agents} />

      <div className="main">
        <AgentList agents={agents} selected={selectedAgent} onSelect={setSelected} />
        {selectedAgent ? (
          <AgentDetail
            agent={selectedAgent}
            onClose={() => setSelected(null)}
            onOpenChat={() => setChatAgentId(selectedAgent.sessionId)}
            onApprovalDecision={respondToApproval}
          />
        ) : (
          <div className="sidebar">
            <ToolBreakdown agents={agents} />
            <ActivityFeed events={activityFeed} />
          </div>
        )}
      </div>

      <SessionTimeline agents={agents} now={now} />

      {chatAgent && chatTranscript?.sessionId === chatAgent.sessionId && (
        <SessionChatModal
          key={chatAgent.sessionId}
          agent={chatAgent}
          initialTranscript={chatTranscript.entries}
          initialTranscriptError={chatTranscript.error}
          onClose={() => setChatAgentId(null)}
          onSendMessage={sendSessionMessage}
          onApprovalDecision={respondToApproval}
          isMockData={isMockData}
        />
      )}
    </div>
  )
}
