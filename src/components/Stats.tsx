import { type Agent, formatTokens } from '../data'

export function DashboardStats({ agents }: { agents: Agent[] }) {
  const totalTokens = agents.reduce((sum, a) => sum + a.tokenCount, 0)
  const totalTools = agents.reduce((sum, a) => {
    let c = a.recentTools.length + a.toolsInProgress.length
    for (const s of a.subagents) c += s.tools.length
    return sum + c
  }, 0)

  return (
    <div className="dashboard-stats" aria-label="Agents processing summary">
      <span className="dashboard-stats-label">AGENTS PROCESSING</span>
      <div className="dashboard-stats-values">
        <div className="dashboard-stat">
          <span className="dashboard-stat-value">{agents.length}</span>
          <span className="dashboard-stat-label">TOTAL</span>
        </div>
        <div className="dashboard-stat">
          <span className="dashboard-stat-value">{formatTokens(totalTokens)}</span>
          <span className="dashboard-stat-label">TOKENS</span>
        </div>
        <div className="dashboard-stat">
          <span className="dashboard-stat-value">{totalTools}</span>
          <span className="dashboard-stat-label">TOOL CALLS</span>
        </div>
      </div>
    </div>
  )
}

export function AttentionBanner({ agents }: { agents: Agent[] }) {
  const approvals = agents.filter(a => a.phase === 'waiting_for_approval')
  if (approvals.length === 0) return null

  return (
    <div className="attention-banner">
      <div className="attention-dot" />
      <span className="attention-text">{approvals.length} awaiting approval</span>
      <span className="attention-count">{approvals.length} AGENT{approvals.length > 1 ? 'S' : ''}</span>
    </div>
  )
}
