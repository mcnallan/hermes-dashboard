export interface WikiSkill {
  name: string
  category: string
  description: string
  version: string
  platforms: string[]
  tags: string[]
  body: string
  enabled?: boolean
  metadata?: unknown
  author?: string
  license?: string
}

export interface WikiPlugin {
  name: string
  version: string
  description: string
  tools: string[]
  hooks: string[]
  enabled?: boolean
  state?: 'enabled' | 'disabled' | 'not_enabled'
  provides_tools?: unknown
}

export interface WikiTool {
  name: string
  description: string
  category: string
  params: { name: string; type: string; required: boolean; description: string }[]
  enabled?: boolean
  state?: string
}

export const skills: WikiSkill[] = [
  {
    name: 'imessage',
    category: 'apple',
    description: 'Send and receive iMessages/SMS via the imsg CLI on macOS',
    version: '1.0.0',
    platforms: ['macos'],
    tags: ['iMessage', 'SMS', 'messaging', 'Apple'],
    body: `## When to Use\n\nUse this skill when the user asks you to send or read iMessages, SMS, or text messages on macOS.\n\n## Prerequisites\n\n- macOS only\n- \`imsg\` CLI tool installed\n- Full Disk Access granted to terminal\n\n## Usage\n\n\`\`\`bash\nimsg send "+1234567890" "Hello from Hermes"\nimsg read --limit 10\nimsg conversations\n\`\`\`\n\n## Notes\n\n- Group messages require the conversation ID\n- Media attachments are supported via \`--attachment\` flag`,
  },
  {
    name: 'apple-notes',
    category: 'apple',
    description: 'Create, read, and search Apple Notes via AppleScript',
    version: '1.0.0',
    platforms: ['macos'],
    tags: ['Notes', 'Apple', 'AppleScript'],
    enabled: false,
    body: `## When to Use\n\nUse when the user wants to interact with Apple Notes -- creating, reading, searching, or organizing notes.\n\n## How It Works\n\nUses AppleScript to interface with Notes.app. All operations are non-destructive by default.\n\n## Commands\n\n- Create note: \`osascript -e 'tell application "Notes" to make new note...'\`\n- List notes: queries the Notes database\n- Search: full-text search across all folders`,
  },
  {
    name: 'browser-automation',
    category: 'research',
    description: 'Headless browser automation with Playwright for web scraping and interaction',
    version: '1.2.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['browser', 'Playwright', 'scraping', 'automation'],
    body: `## When to Use\n\nUse for tasks requiring real browser interaction: filling forms, navigating SPAs, scraping JavaScript-rendered content, taking screenshots of web pages.\n\n## Backends\n\n- **Browserbase** (cloud) -- no local install needed\n- **Local Chromium** -- headless via Playwright\n\n## Capabilities\n\n- Navigate, click, type, scroll via accessibility tree snapshots\n- Extract page content as markdown\n- Execute JavaScript in page context\n- Vision analysis of rendered pages\n- Screenshot capture`,
  },
  {
    name: 'web-search',
    category: 'research',
    description: 'Search the web using Exa, Firecrawl, Tavily, or parallel multi-engine search',
    version: '1.0.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['search', 'web', 'Exa', 'Tavily', 'Firecrawl'],
    body: `## When to Use\n\nUse when you need current information not in your training data.\n\n## Backends\n\n1. **Exa** -- neural search with content extraction\n2. **Firecrawl** -- web crawling and extraction\n3. **Tavily** -- AI-optimized search\n4. **Parallel** -- multi-engine aggregation\n\n## Usage\n\nThe orchestrator automatically selects this when it detects a query needing current information. Results are compressed via LLM summarization.`,
  },
  {
    name: 'git-workflow',
    category: 'software-development',
    description: 'Git operations: branching, committing, rebasing, PR workflows',
    version: '1.3.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['git', 'version control', 'branching', 'PR'],
    body: `## When to Use\n\nUse for any git-related task: creating branches, committing, rebasing, resolving merge conflicts, managing PRs.\n\n## Patterns\n\n### Feature Branch\n\`\`\`bash\ngit checkout -b feature/my-feature\ngit add -A && git commit -m "add feature"\ngit push -u origin feature/my-feature\ngh pr create --title "Add feature"\n\`\`\`\n\n### Rebase Workflow\n\`\`\`bash\ngit fetch origin\ngit rebase origin/main\ngit push --force-with-lease\n\`\`\``,
  },
  {
    name: 'docker-compose',
    category: 'devops',
    description: 'Manage Docker Compose services, volumes, networks, and builds',
    version: '1.0.0',
    platforms: ['macos', 'linux'],
    tags: ['Docker', 'containers', 'orchestration', 'devops'],
    body: `## When to Use\n\nUse when the user needs to manage Docker Compose services.\n\n## Common Operations\n\n\`\`\`bash\ndocker compose up -d\ndocker compose logs -f service_name\ndocker compose build --no-cache\ndocker compose down -v\n\`\`\``,
  },
  {
    name: 'kubernetes',
    category: 'devops',
    description: 'Kubernetes cluster management: pods, services, deployments, scaling',
    version: '1.1.0',
    platforms: ['macos', 'linux'],
    tags: ['Kubernetes', 'k8s', 'pods', 'deployments'],
    body: `## When to Use\n\nUse for Kubernetes operations: inspecting pods, scaling deployments, managing services.\n\n## Prerequisites\n\n- \`kubectl\` installed and configured\n- Valid kubeconfig\n\n## Common Patterns\n\n\`\`\`bash\nkubectl get pods -n namespace\nkubectl logs -f pod-name\nkubectl scale deployment/name --replicas=3\n\`\`\``,
  },
  {
    name: 'jupyter-notebooks',
    category: 'data-science',
    description: 'Create, edit, and execute Jupyter notebooks programmatically',
    version: '1.0.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['Jupyter', 'notebooks', 'Python', 'data analysis'],
    enabled: false,
    body: `## When to Use\n\nUse when the user wants to create data analysis notebooks, run experiments, or visualize data.\n\n## Capabilities\n\n- Create new notebooks from scratch\n- Add/edit/delete cells\n- Execute cells and capture output\n- Export to HTML/PDF\n- Manage kernels`,
  },
  {
    name: 'mcp-server',
    category: 'mcp',
    description: 'Run Hermes as an MCP server or connect to external MCP tools',
    version: '1.0.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['MCP', 'protocol', 'server', 'integration'],
    body: `## When to Use\n\nUse when you need to expose Hermes tools to other AI systems or consume tools from external MCP servers.\n\n## As Server\n\n\`\`\`bash\nhermes --mcp-server --port 8080\n\`\`\`\n\n## As Client\n\nConfigure in \`~/.hermes/config.yaml\`:\n\`\`\`yaml\nmcp_servers:\n  my-server:\n    command: "npx"\n    args: ["-y", "@my/mcp-server"]\n\`\`\`\n\nTools from MCP servers are auto-registered in the tool registry.`,
  },
  {
    name: 'home-assistant',
    category: 'smart-home',
    description: 'Control smart home devices via Home Assistant REST API',
    version: '1.0.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['Home Assistant', 'smart home', 'IoT', 'automation'],
    enabled: false,
    body: `## When to Use\n\nUse when the user wants to control smart home devices: lights, thermostats, locks, media players.\n\n## Tools\n\n- \`ha_list_entities\` -- browse devices by domain or area\n- \`ha_get_state\` -- check device status\n- \`ha_list_services\` -- available actions\n- \`ha_call_service\` -- execute actions (turn_on, set_temperature, etc.)\n\n## Setup\n\nRequires \`HA_URL\` and \`HA_TOKEN\` environment variables.`,
  },
  {
    name: 'mixture-of-agents',
    category: 'research',
    description: 'Multi-layer LLM collaboration using the Mixture-of-Agents architecture',
    version: '0.5.0',
    platforms: ['macos', 'linux', 'windows'],
    tags: ['MoA', 'multi-agent', 'collaboration', 'reasoning'],
    enabled: false,
    body: `## When to Use\n\nUse for complex reasoning tasks where multiple perspectives improve output quality.\n\n## How It Works\n\nBased on the Mixture-of-Agents paper (Junlin Wang et al.):\n\n1. Multiple LLMs generate initial responses\n2. Responses are aggregated and refined\n3. A final synthesis produces the output\n\n## Configuration\n\nUse the \`moa\` toolset to enable.`,
  },
  {
    name: 'rl-training',
    category: 'mlops',
    description: 'Reinforcement learning training via Tinker-Atropos environments',
    version: '0.3.0',
    platforms: ['macos', 'linux'],
    tags: ['RL', 'training', 'Tinker', 'Atropos', 'WandB'],
    enabled: false,
    body: `## When to Use\n\nUse when fine-tuning models with RL or running training experiments.\n\n## Tools\n\n- \`rl_list_environments\` -- discover available training environments\n- \`rl_select_environment\` -- choose environment\n- \`rl_edit_config\` -- modify hyperparameters\n- \`rl_start_training\` -- launch training run\n- \`rl_check_status\` -- monitor progress (WandB integration)\n- \`rl_get_results\` -- retrieve trained model outputs`,
  },
]

export const plugins: WikiPlugin[] = [
  { name: 'agent-monitor', version: '1.0.0', description: 'Real-time session event streaming to external monitoring dashboards and observability tools via Unix socket', tools: [], hooks: ['on_session_start', 'pre_tool_call', 'post_tool_call', 'pre_llm_call', 'post_llm_call', 'on_session_end'], enabled: true, state: 'enabled' },
  { name: 'desktop-control', version: '0.1.0', description: 'Autonomous desktop control via vision model and PyAutoGUI for GUI tasks that cannot be done through terminal', tools: ['desktop_use'], hooks: [], enabled: false, state: 'disabled' },
  { name: 'notification-relay', version: '0.4.0', description: 'Push notifications to Slack, Teams, or webhooks when agents need attention or complete tasks', tools: ['notify_send'], hooks: ['on_session_start', 'on_session_end'], enabled: true, state: 'enabled' },
  { name: 'sandbox-runner', version: '0.3.0', description: 'Execute untrusted code in isolated Docker containers with resource limits and network policies', tools: ['sandbox_exec', 'sandbox_status'], hooks: ['pre_tool_call'], enabled: false, state: 'not_enabled' },
  { name: 'audit-logger', version: '0.6.0', description: 'Comprehensive audit trail -- logs every tool call, LLM interaction, and approval decision to structured JSON', tools: [], hooks: ['on_session_start', 'pre_tool_call', 'post_tool_call', 'pre_llm_call', 'post_llm_call', 'on_session_end'], enabled: false, state: 'disabled' },
  { name: 'cost-tracker', version: '0.2.0', description: 'Token usage and cost tracking per session, per agent, and per project with budget alerts', tools: ['cost_report'], hooks: ['post_llm_call', 'on_session_end'], enabled: true, state: 'enabled' },
  { name: 'cron-scheduler', version: '0.5.0', description: 'Scheduled task execution -- run agent tasks on cron schedules with retry logic and failure alerts', tools: ['cron_create', 'cron_list', 'cron_delete'], hooks: ['on_session_start'], enabled: true, state: 'enabled' },
  { name: 'gateway-bridge', version: '1.0.0', description: 'Cross-platform messaging gateway -- connects Hermes to Telegram, Discord, Slack, Signal, Email, SMS, and 8+ other platforms', tools: ['send_message'], hooks: ['on_session_start', 'on_session_end'], enabled: false, state: 'not_enabled' },
]

export const tools: WikiTool[] = [
  // File Operations
  { name: 'read_file', description: 'Read file contents with optional line range', category: 'File Operations', params: [{ name: 'file_path', type: 'string', required: true, description: 'Path to the file' }, { name: 'offset', type: 'integer', required: false, description: 'Start line' }, { name: 'limit', type: 'integer', required: false, description: 'Number of lines' }] },
  { name: 'write_file', description: 'Create or overwrite a file with safety checks', category: 'File Operations', params: [{ name: 'file_path', type: 'string', required: true, description: 'File to write' }, { name: 'content', type: 'string', required: true, description: 'Content to write' }] },
  { name: 'patch', description: 'Apply fuzzy-matched patches to code files', category: 'File Operations', params: [{ name: 'file_path', type: 'string', required: true, description: 'File to patch' }, { name: 'old_string', type: 'string', required: true, description: 'Text to find' }, { name: 'new_string', type: 'string', required: true, description: 'Replacement text' }] },
  { name: 'search_files', description: 'Search file contents and names with regex', category: 'File Operations', params: [{ name: 'pattern', type: 'string', required: true, description: 'Regex pattern' }, { name: 'path', type: 'string', required: false, description: 'Directory to search' }] },
  // Terminal
  { name: 'terminal', description: 'Execute shell commands in local, Docker, Modal, SSH, or Daytona environments', category: 'Terminal', params: [{ name: 'command', type: 'string', required: true, description: 'Command to run' }, { name: 'timeout', type: 'integer', required: false, description: 'Timeout in seconds' }, { name: 'background', type: 'boolean', required: false, description: 'Run in background' }] },
  { name: 'process', description: 'Manage background processes with polling, output buffering, and crash recovery', category: 'Terminal', params: [{ name: 'action', type: 'string', required: true, description: 'start, stop, status, or output' }, { name: 'process_id', type: 'string', required: false, description: 'Target process ID' }] },
  // Web
  { name: 'web_search', description: 'Search the web via Exa, Firecrawl, Tavily, or parallel multi-engine', category: 'Web', params: [{ name: 'query', type: 'string', required: true, description: 'Search query' }, { name: 'backend', type: 'string', required: false, description: 'exa, firecrawl, tavily, parallel' }] },
  { name: 'web_extract', description: 'Extract and parse web page content to markdown with compression', category: 'Web', params: [{ name: 'url', type: 'string', required: true, description: 'URL to extract' }] },
  // Browser
  { name: 'browser_navigate', description: 'Navigate to a URL in headless browser', category: 'Browser', params: [{ name: 'url', type: 'string', required: true, description: 'URL to navigate to' }] },
  { name: 'browser_snapshot', description: 'Take accessibility tree snapshot of the current page', category: 'Browser', params: [] },
  { name: 'browser_click', description: 'Click an element on the page', category: 'Browser', params: [{ name: 'element', type: 'string', required: true, description: 'Element selector or aria ref' }] },
  { name: 'browser_type', description: 'Type text into a focused input', category: 'Browser', params: [{ name: 'text', type: 'string', required: true, description: 'Text to type' }] },
  { name: 'browser_vision', description: 'Analyze the rendered page with a vision model', category: 'Browser', params: [{ name: 'prompt', type: 'string', required: false, description: 'Analysis prompt' }], enabled: false },
  // AI & Reasoning
  { name: 'delegate_task', description: 'Spawn an isolated subagent with restricted toolsets and focused prompt', category: 'AI & Reasoning', params: [{ name: 'task', type: 'string', required: true, description: 'Task description' }, { name: 'toolsets', type: 'string', required: false, description: 'Comma-separated toolsets for subagent' }] },
  { name: 'mixture_of_agents', description: 'Multi-layer LLM collaboration for complex reasoning', category: 'AI & Reasoning', params: [{ name: 'prompt', type: 'string', required: true, description: 'The question or task' }] },
  { name: 'execute_code', description: 'Run Python scripts that call tools via RPC, collapsing multi-step pipelines', category: 'AI & Reasoning', params: [{ name: 'code', type: 'string', required: true, description: 'Python code to execute' }], enabled: false },
  // Vision & Media
  { name: 'vision_analyze', description: 'Analyze images from URLs or files with custom prompts', category: 'Vision & Media', params: [{ name: 'image_url', type: 'string', required: true, description: 'URL or path to image' }, { name: 'prompt', type: 'string', required: false, description: 'Analysis prompt' }] },
  { name: 'image_generate', description: 'Generate images using FAL.ai FLUX 2 Pro with upscaling', category: 'Vision & Media', params: [{ name: 'prompt', type: 'string', required: true, description: 'Image description' }, { name: 'upscale', type: 'boolean', required: false, description: 'Apply Clarity Upscaler' }], enabled: false },
  { name: 'text_to_speech', description: 'Convert text to speech via Edge TTS, ElevenLabs, OpenAI, or local NeuTTS', category: 'Vision & Media', params: [{ name: 'text', type: 'string', required: true, description: 'Text to speak' }, { name: 'backend', type: 'string', required: false, description: 'edge, elevenlabs, openai, neutts' }], enabled: false },
  // Memory & Planning
  { name: 'memory', description: 'Persistent file-backed memory injected into system prompt each session', category: 'Memory & Planning', params: [{ name: 'action', type: 'string', required: true, description: 'add, replace, remove, or read' }, { name: 'content', type: 'string', required: false, description: 'Content to write' }] },
  { name: 'session_search', description: 'FTS5 search over past session transcripts with LLM summarization', category: 'Memory & Planning', params: [{ name: 'query', type: 'string', required: true, description: 'Search query' }, { name: 'limit', type: 'integer', required: false, description: 'Max results' }] },
  { name: 'todo', description: 'In-memory task list for multi-step decomposition, persistent across compression', category: 'Memory & Planning', params: [{ name: 'action', type: 'string', required: true, description: 'add, complete, remove, or list' }, { name: 'task', type: 'string', required: false, description: 'Task description' }] },
  // Smart Home
  { name: 'ha_call_service', description: 'Execute Home Assistant service calls (turn_on, set_temperature, etc.)', category: 'Smart Home', params: [{ name: 'domain', type: 'string', required: true, description: 'Service domain (light, climate, etc.)' }, { name: 'service', type: 'string', required: true, description: 'Service name' }, { name: 'entity_id', type: 'string', required: true, description: 'Target entity' }], enabled: false },
  { name: 'ha_get_state', description: 'Get detailed state of a Home Assistant device', category: 'Smart Home', params: [{ name: 'entity_id', type: 'string', required: true, description: 'Entity to query' }], enabled: false },
  // Messaging
  { name: 'send_message', description: 'Send messages across Telegram, Discord, Slack, Signal, Email, SMS, and more', category: 'Messaging', params: [{ name: 'platform', type: 'string', required: true, description: 'Target platform' }, { name: 'recipient', type: 'string', required: true, description: 'Channel, user, or address' }, { name: 'message', type: 'string', required: true, description: 'Message content' }], enabled: false },
  // Scheduling
  { name: 'cronjob', description: 'Create and manage scheduled tasks with natural language schedules', category: 'Scheduling', params: [{ name: 'action', type: 'string', required: true, description: 'create, list, update, pause, resume, remove, trigger' }, { name: 'schedule', type: 'string', required: false, description: 'Cron expression or natural language' }, { name: 'task', type: 'string', required: false, description: 'Task to execute' }] },
]

export const mockMemory = {
  memory: `# Agent Memory

## Project Conventions
- This monorepo uses pnpm workspaces
- Tests run with vitest, not jest
- CSS modules preferred over styled-components
- API routes follow /api/v1/{resource} pattern

## Tool Quirks
- search_files with multiline needed for cross-line patterns
- patch tool fails silently if old_string not unique -- provide enough context
- terminal timeout defaults to 180s, use explicit timeout for long builds

## Learnings
- User prefers concise responses with no trailing summaries
- Always check git status before making commits
- Run lint before build to catch errors early
`,
  user: `# User Profile

## Role
Senior full-stack engineer working on a SaaS platform.

## Preferences
- Terse communication style
- Prefers explicit over implicit
- Values production-ready code over demos
- Likes monospace fonts and dark themes

## Tech Stack
- TypeScript, React, Node.js
- PostgreSQL, Redis
- Docker, Kubernetes
- Hono for API routes, Zod for validation
`,
}

export const mockSoul = `# Hermes Agent Persona

You are Hermes, a precise and capable AI assistant.

## Communication Style
- Direct and concise
- Technical accuracy over politeness
- Show reasoning when it adds value
- Admit uncertainty instead of guessing

## Principles
- Production code, not demos
- Simplest solution that works
- Delete dead code immediately
- DRY after the second occurrence
- Composition over inheritance
`
