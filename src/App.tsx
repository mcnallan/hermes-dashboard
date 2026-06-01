import { useState, useEffect } from 'react'
import { type Agent } from './data'
import { useHermes } from './useHermes'
import { Header } from './components/Header'
import { HeroSection, AttentionBanner } from './components/Stats'
import { AgentList } from './components/AgentList'
import { AgentDetail } from './components/AgentDetail'
import { SessionChatModal } from './components/SessionChatModal'
import { ToolBreakdown } from './components/ToolBreakdown'
import { ActivityFeed } from './components/ActivityFeed'
import { SessionTimeline } from './components/SessionTimeline'
import { Wiki } from './components/Wiki'
import './app.css'

type Theme = 'light' | 'dark'

export default function App() {
  const { agents, activityFeed, connected, respondToApproval, getSessionTranscript, sendSessionMessage } = useHermes()
  const [selected, setSelected] = useState<Agent | null>(null)
  const [chatAgentId, setChatAgentId] = useState<string | null>(null)
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

  if (view === 'wiki') {
    return (
      <div className="app">
        <Wiki onBack={() => setView('dashboard')} />
      </div>
    )
  }

  const selectedAgent = selected
    ? agents.find(a => a.sessionId === selected.sessionId) || null
    : null
  const chatAgent = chatAgentId
    ? agents.find(a => a.sessionId === chatAgentId) || selectedAgent
    : null

  return (
    <div className="app">
      <Header
        agents={agents}
        connected={connected}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        onWiki={() => setView('wiki')}
      />
      <HeroSection agents={agents} />
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

      {chatAgent && (
        <SessionChatModal
          agent={chatAgent}
          onClose={() => setChatAgentId(null)}
          onLoadTranscript={getSessionTranscript}
          onSendMessage={sendSessionMessage}
          onApprovalDecision={respondToApproval}
        />
      )}
    </div>
  )
}
