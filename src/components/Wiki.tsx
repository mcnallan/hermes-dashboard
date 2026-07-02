import { useState, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  skills as mockSkills, plugins as mockPlugins,
  tools as defaultTools, mockMemory, mockSoul,
  type WikiPlugin, type WikiSkill, type WikiTool,
} from '../wikiData'
import { appUrl } from '../appUrls'

const API = appUrl('api/wiki')

type Page =
  | 'skills' | 'plugins' | 'tools'
  | 'memory' | 'soul'
  | { skill: string }
type FilterMode = 'enabled' | 'disabled'

function Md({ content }: { content: string }) {
  const raw = marked.parse(content, { async: false }) as string
  const html = DOMPurify.sanitize(raw)
  return <div className="wiki-md" dangerouslySetInnerHTML={{ __html: html }} />
}

type WikiStatefulItem = {
  enabled?: boolean
  state?: string
}

type WikiToolsetState = {
  platform: string
  enabled: string[]
}

const TOOL_NAME_TOOLSETS: Record<string, string> = {
  delegate_task: 'delegation',
  mixture_of_agents: 'moa',
  execute_code: 'code_execution',
  vision_analyze: 'vision',
  image_generate: 'image_gen',
  text_to_speech: 'tts',
}

const TOOL_CATEGORY_TOOLSETS: Record<string, string> = {
  'File Operations': 'file',
  Terminal: 'terminal',
  Web: 'web',
  Browser: 'browser',
  'Memory & Planning': 'memory',
  'Smart Home': 'homeassistant',
  Messaging: 'messaging',
  Scheduling: 'cronjob',
}

function toolToolset(tool: WikiTool) {
  if (TOOL_NAME_TOOLSETS[tool.name]) return TOOL_NAME_TOOLSETS[tool.name]
  if (tool.name === 'session_search') return 'session_search'
  if (tool.name === 'todo') return 'todo'
  return TOOL_CATEGORY_TOOLSETS[tool.category] || ''
}

function isEnabledItem(item: WikiStatefulItem) {
  if (typeof item.enabled === 'boolean') return item.enabled
  if (typeof item.state === 'string') return item.state === 'enabled'
  return true
}

function itemStateLabel(item: WikiStatefulItem) {
  if (typeof item.state === 'string' && item.state.trim()) {
    return item.state.replace(/_/g, ' ').toUpperCase()
  }
  return isEnabledItem(item) ? 'ENABLED' : 'DISABLED'
}

function FilterToggle({
  mode,
  noun,
  onToggle,
}: {
  mode: FilterMode
  noun: string
  onToggle: () => void
}) {
  const nextMode = mode === 'enabled' ? 'disabled' : 'enabled'
  const label = mode.toUpperCase()
  return (
    <button
      className="theme-toggle wiki-filter-toggle"
      type="button"
      onClick={onToggle}
      aria-pressed={mode === 'enabled'}
      aria-label={`Currently showing ${mode} ${noun}. Click to show ${nextMode} ${noun}.`}
      title={`Currently showing ${mode} ${noun}. Click to show ${nextMode} ${noun}.`}
    >
      {label}
    </button>
  )
}

function StateBadge({ item }: { item: WikiStatefulItem }) {
  const enabled = isEnabledItem(item)
  return (
    <span className={`wiki-state-badge ${enabled ? 'enabled' : 'disabled'}`}>
      {itemStateLabel(item)}
    </span>
  )
}

function SkillCard({ skill, onClick }: { skill: WikiSkill; onClick: () => void }) {
  const name = String(skill.name || '')
  const category = String(skill.category || '')
  const description = String(skill.description || '')
  const platforms = String(skill.platforms || '').replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
  const tags = String(skill.tags || skill.metadata || '').replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4)
  const enabled = isEnabledItem(skill)

  return (
    <div className={`wiki-skill-card ${enabled ? '' : 'disabled'}`} onClick={onClick}>
      <div className="wiki-skill-header">
        <div className="wiki-skill-header-main">
          <span className="wiki-skill-name">{name}</span>
          {category && <span className="wiki-skill-category">{category}</span>}
        </div>
        <StateBadge item={skill} />
      </div>
      {description && <div className="wiki-skill-desc">{description}</div>}
      <div className="wiki-skill-tags">
        {platforms.map(p => <span key={p} className="wiki-tag platform">{p}</span>)}
        {tags.map(t => <span key={t} className="wiki-tag">{t}</span>)}
      </div>
    </div>
  )
}

function ToolRef({ tool }: { tool: WikiTool }) {
  const enabled = isEnabledItem(tool)
  return (
    <div className={`wiki-tool-card ${enabled ? '' : 'disabled'}`}>
      <div className="wiki-tool-header">
        <div className="wiki-tool-header-main">
          <span className="wiki-tool-name">{tool.name}</span>
          <span className="wiki-tool-cat">{tool.category}</span>
        </div>
        <StateBadge item={tool} />
      </div>
      <div className="wiki-tool-desc">{tool.description}</div>
      <div className="wiki-tool-params">
        {tool.params.map(p => (
          <div key={p.name} className="wiki-param">
            <span className="wiki-param-name">{p.name}</span>
            <span className="wiki-param-type">{p.type}</span>
            {p.required && <span className="wiki-param-req">required</span>}
            <span className="wiki-param-desc">{p.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function useLiveData() {
  const [live, setLive] = useState(false)
  const [skills, setSkills] = useState<Record<string, unknown>[]>([])
  const [plugins, setPlugins] = useState<Record<string, unknown>[]>([])
  const [toolsets, setToolsets] = useState<WikiToolsetState | null>(null)
  const [memory, setMemory] = useState({ memory: '', user: '' })
  const [soul, setSoul] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/skills`).then(r => r.json()).then(d => {
      if (cancelled) return
      setLive(true)
      setSkills(d)
      fetch(`${API}/plugins`).then(r => r.json()).then(d => { if (!cancelled) setPlugins(d) }).catch(() => {})
      fetch(`${API}/toolsets`).then(r => r.json()).then(d => { if (!cancelled) setToolsets(d) }).catch(() => {})
      fetch(`${API}/memory`).then(r => r.json()).then(d => { if (!cancelled) setMemory(d) }).catch(() => {})
      fetch(`${API}/soul`).then(r => r.json()).then(d => { if (!cancelled) setSoul(d.content) }).catch(() => {})
    }).catch(() => { if (!cancelled) setLive(false) })
    return () => { cancelled = true }
  }, [])

  return { live, skills, plugins, toolsets, memory, soul }
}

export function Wiki({ onBack }: { onBack: () => void }) {
  const [page, setPage] = useState<Page>('skills')
  const [search, setSearch] = useState('')
  const data = useLiveData()

  // resolve live vs mock
  const isLive = data.live
  const skills = (isLive ? data.skills : mockSkills).map(s => ({ ...s, enabled: typeof s.enabled === 'boolean' ? s.enabled : true })) as WikiSkill[]
  const pluginList = (isLive ? data.plugins : mockPlugins).map(p => ({ ...p })) as WikiPlugin[]
  const enabledToolsets = new Set(data.toolsets?.enabled || [])
  const tools = defaultTools.map(tool => {
    const toolset = toolToolset(tool)
    if (isLive && data.toolsets && toolset) {
      const enabled = enabledToolsets.has(toolset)
      return { ...tool, enabled, state: enabled ? 'enabled' : 'disabled' }
    }
    const enabled = isEnabledItem(tool)
    return { ...tool, enabled, state: enabled ? 'enabled' : 'disabled' }
  }) as WikiTool[]
  const memoryContent = isLive && data.memory.memory ? data.memory : mockMemory
  const soulContent = isLive && data.soul ? data.soul : mockSoul
  const [skillFilter, setSkillFilter] = useState<FilterMode>('enabled')
  const [toolFilter, setToolFilter] = useState<FilterMode>('enabled')
  const [pluginFilter, setPluginFilter] = useState<FilterMode>('enabled')

  const activePage = typeof page === 'object' ? 'skill-detail' : page

  const enabledSkills = skills.filter(s => isEnabledItem(s))
  const visibleSkills = (skillFilter === 'enabled' ? enabledSkills : skills.filter(s => !isEnabledItem(s)))
  const filteredSkills = search
    ? visibleSkills.filter(s =>
        String(s.name || '').toLowerCase().includes(search.toLowerCase()) ||
        String(s.category || '').toLowerCase().includes(search.toLowerCase()) ||
        String(s.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : visibleSkills

  const categories = [...new Set(skills.map(s => String(s.category || '')).filter(Boolean))]
  const visibleTools = (toolFilter === 'enabled'
    ? tools.filter(t => isEnabledItem(t))
    : tools.filter(t => !isEnabledItem(t)))
  const visibleToolCategories = [...new Set(visibleTools.map(t => t.category))]
  const visiblePlugins = (pluginFilter === 'enabled'
    ? pluginList.filter(p => isEnabledItem(p))
    : pluginList.filter(p => !isEnabledItem(p)))

  return (
    <div className="wiki">
      <div className="wiki-sidebar">
        <button className="wiki-back" onClick={onBack}>DASHBOARD</button>

        <div className="wiki-nav-label">
          WIKI {isLive ? <span style={{ color: 'var(--success)', fontSize: 9 }}>LIVE</span> : <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>STATIC</span>}
        </div>
        <div className="wiki-nav-label">REFERENCE</div>
        <button className={`wiki-nav-item ${activePage === 'skills' || activePage === 'skill-detail' ? 'active' : ''}`} onClick={() => setPage('skills')}>
          Skills <span className="wiki-nav-count">{skills.length}</span>
        </button>
        <button className={`wiki-nav-item ${activePage === 'tools' ? 'active' : ''}`} onClick={() => setPage('tools')}>
          Tools <span className="wiki-nav-count">{tools.length}</span>
        </button>
        <button className={`wiki-nav-item ${activePage === 'plugins' ? 'active' : ''}`} onClick={() => setPage('plugins')}>
          Plugins <span className="wiki-nav-count">{pluginList.length}</span>
        </button>

        <div className="wiki-nav-label">AGENT STATE</div>
        <button className={`wiki-nav-item ${activePage === 'memory' ? 'active' : ''}`} onClick={() => setPage('memory')}>Memory</button>
        <button className={`wiki-nav-item ${activePage === 'soul' ? 'active' : ''}`} onClick={() => setPage('soul')}>Soul</button>

        {(activePage === 'skills' || activePage === 'skill-detail') && categories.length > 0 && (
          <>
            <div className="wiki-nav-label" style={{ marginTop: 16 }}>CATEGORIES</div>
            <button className={`wiki-nav-sub ${search === '' ? 'active' : ''}`} onClick={() => setSearch('')}>All</button>
            {categories.map(c => (
              <button key={c} className={`wiki-nav-sub ${search === c ? 'active' : ''}`} onClick={() => setSearch(c)}>{c}</button>
            ))}
          </>
        )}
      </div>

      <div className="wiki-content">
        {page === 'skills' && (
          <div>
              <div className="wiki-page-header">
                <h1>Skills</h1>
                <div className="wiki-page-header-actions">
                  <input className="wiki-search" placeholder="Search skills..." value={search} onChange={e => setSearch(e.target.value)} />
                <FilterToggle mode={skillFilter} noun="skills" onToggle={() => setSkillFilter(current => current === 'enabled' ? 'disabled' : 'enabled')} />
                </div>
              </div>
            {search && <div className="wiki-search-info">{filteredSkills.length} of {visibleSkills.length} skills</div>}
            {filteredSkills.length === 0 ? (
              <div className="wiki-empty-state">
                {search
                  ? `No ${skillFilter} skills match the current search.`
                  : `No ${skillFilter} skills available.`
                }
              </div>
            ) : (
              <div className="wiki-skill-grid">
                {filteredSkills.map((s, i) => (
                  <SkillCard key={`${s.category}/${s.name}-${i}`} skill={s} onClick={() => setPage({ skill: String(s.name) })} />
                ))}
              </div>
            )}
          </div>
        )}

        {typeof page === 'object' && 'skill' in page && (() => {
          const s = skills.find(sk => String(sk.name) === page.skill)
          if (!s) return null
          const sName = String(s.name || '')
          const sCat = s.category ? String(s.category) : ''
          const sVer = s.version ? String(s.version) : ''
          const sDesc = s.description ? String(s.description) : ''
          const sPlat = s.platforms ? String(s.platforms) : ''
          const sAuth = s.author ? String(s.author) : ''
          const sLic = s.license ? String(s.license) : ''
          const sBody = s.body ? String(s.body) : ''
          return (
            <div>
              <button className="wiki-breadcrumb" onClick={() => setPage('skills')}>Skills /</button>
              <div className="wiki-detail">
                <div className="wiki-detail-header">
                  <h2>{sName}</h2>
                  {sCat && <span className="wiki-skill-category">{sCat}</span>}
                  {sVer && <span className="wiki-version">v{sVer}</span>}
                </div>
                {sDesc && <p className="wiki-detail-desc">{sDesc}</p>}
                <div className="wiki-meta-grid">
                  {sPlat && <div className="wiki-meta-item"><span className="wiki-meta-label">PLATFORMS</span><span>{sPlat}</span></div>}
                  {sAuth && <div className="wiki-meta-item"><span className="wiki-meta-label">AUTHOR</span><span>{sAuth}</span></div>}
                  {sLic && <div className="wiki-meta-item"><span className="wiki-meta-label">LICENSE</span><span>{sLic}</span></div>}
                </div>
                {sBody && <Md content={sBody} />}
              </div>
            </div>
          )
        })()}

        {page === 'tools' && (
          <div>
            <div className="wiki-page-header">
              <h1>Tool Reference</h1>
              <div className="wiki-page-header-actions">
                <FilterToggle mode={toolFilter} noun="tools" onToggle={() => setToolFilter(current => current === 'enabled' ? 'disabled' : 'enabled')} />
              </div>
            </div>
            {visibleTools.length === 0 ? (
              <div className="wiki-empty-state">No {toolFilter} tools available.</div>
            ) : (
              visibleToolCategories.map(cat => (
                <div key={cat}>
                  <h2>{cat}</h2>
                  <div className="wiki-tool-list">
                    {visibleTools.filter(t => t.category === cat).map(t => <ToolRef key={t.name} tool={t} />)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {page === 'plugins' && (
          <div>
            <div className="wiki-page-header">
              <h1>Plugins</h1>
              <div className="wiki-page-header-actions">
                <FilterToggle mode={pluginFilter} noun="plugins" onToggle={() => setPluginFilter(current => current === 'enabled' ? 'disabled' : 'enabled')} />
              </div>
            </div>
            {visiblePlugins.length === 0 ? (
              <div className="wiki-empty-state">No {pluginFilter} plugins available.</div>
            ) : (
              <div className="wiki-plugin-list">
                {visiblePlugins.map((p, i) => {
                  const name = String(p.name || '')
                  const desc = p.description ? String(p.description) : ''
                  const ver = p.version ? String(p.version) : ''
                  const pt = p.provides_tools ? String(p.provides_tools) : ''
                  const t = p.tools ? String(p.tools) : ''
                  return (
                    <div key={`${name}-${i}`} className={`wiki-plugin-card ${isEnabledItem(p) ? '' : 'disabled'}`}>
                      <div className="wiki-plugin-header">
                        <div className="wiki-plugin-name">{name}</div>
                        <StateBadge item={p} />
                      </div>
                      {desc && <div className="wiki-plugin-desc">{desc}</div>}
                      <div className="wiki-plugin-meta">
                        {ver && <span>v{ver}</span>}
                        {pt && <span>tools: {pt}</span>}
                        {t && <span>tools: {t}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {page === 'memory' && <div><h1>Memory</h1><h2>Agent Memory</h2><Md content={memoryContent.memory} /><h2 style={{ marginTop: 32 }}>User Profile</h2><Md content={memoryContent.user} /></div>}
        {page === 'soul' && <div><h1>Soul</h1><Md content={soulContent} /></div>}
      </div>
    </div>
  )
}
