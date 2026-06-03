# Hermes Dashboard

Real-time monitoring dashboard and auto-generated wiki for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

Plug it into any Hermes installation. It reads your skills, plugins, config, memory, and soul -- and displays everything as a searchable wiki. The live dashboard shows agent sessions, tool calls, and activity as they happen.

## Install

```bash
git clone https://github.com/Kori-x/hermes-dashboard.git
cd hermes-dashboard
./install.sh
```

This installs the Hermes plugin, npm dependencies, and builds the dashboard.

## Usage

Start the dashboard:

```bash
npm run dev
```

Open **http://localhost:5173**.

The plugin auto-registers with Hermes on next session start. Agent events stream to the dashboard in real-time.

### Reverse proxy access

If you want to expose the dashboard behind nginx, proxy the dashboard path to the local Vite/bridge server and keep websocket upgrade headers enabled. This example serves the dashboard at `/dev/marvin/`:

```nginx
server {
    listen 443 ssl;
    server_name subdomain.site.com;

    access_log /var/log/nginx/access.log;
    error_log  /var/log/nginx/error.log;

    ssl_certificate     /etc/nginx/ssl/site.com/fullchain.crt;
    ssl_certificate_key /etc/nginx/ssl/site.com/private.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location = /dashboard/name {
        return 301 /dashboard/name/;
    }

    location ^~ /dashboard/name/ {
        proxy_pass http://192.168.1.123:5173/;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_read_timeout 120s;
        proxy_buffering off;
    }
}
```

If you change the public path, make sure the trailing-slash redirect and `proxy_pass` target stay aligned.

## What you get

### Dashboard (live)
- Agent session monitoring with phase tracking (processing, idle, awaiting input, needs approval)
- Activity feed of tool calls, messages, and approvals across all sessions
- Per-session detail: context window visualization, tool execution history, subagent tracking
- Session timeline and tool usage breakdown

### Control
- Approve or deny pending agent actions directly from the dashboard
- Send follow-up chat messages to live sessions
- View live transcript entries streamed from the running agent

### Wiki (auto-generated)
- **Skills** -- all your installed skills parsed from `~/.hermes/skills/`, searchable by name/category
- **Plugins** -- installed plugins with manifest data from `~/.hermes/plugins/`
- **Tools** -- complete built-in tool reference (56 tools across 10 categories)
- **CLI** -- command reference with flags
- **Config** -- your `config.yaml` rendered live
- **Memory** -- agent memory (MEMORY.md) and user profile (USER.md)
- **Soul** -- agent persona (SOUL.md)
- **Architecture** -- core loop, provider resolution, memory system, safety, plugin hooks, gateway
- **Changelog** -- version history

When the server is running, the wiki reads live from your `~/.hermes/`. When offline, it falls back to built-in reference data.

## How it works

```
Hermes Agent
  |
  v
hermes_dashboard plugin (hooks into session lifecycle)
  |
  v
Unix socket (/tmp/hermes-dashboard.sock)
  |
  v
Bridge server (Node.js)
  ├── HTTP :5173 ------> React dashboard + control API + Wiki API
  └── WebSocket /ws --> React dashboard live updates
  |
  v
Browser at localhost:5173
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dashboard + server (dev mode) |
| `npm run dev:ui` | Start only Vite |
| `npm run dev:server` | Start only the bridge server |
| `npm run build` | Production build |
| `./install.sh` | Install plugin + dependencies |

## Configuration

| Env var | Default | Description |
|---|---|---|
| `HERMES_HOME` | `~/.hermes` | Hermes installation directory |
| `HERMES_DASHBOARD_DIR` | auto-detected | Path to this repo (for plugin auto-start) |
| `HERMES_AGENT_NAME` | `agent` | Agent name shown in dashboard |
| `HERMES_DASHBOARD_PORT` | `5173` | Dashboard HTTP/WebSocket port |
| `HERMES_DASHBOARD_WEBHOOK_URL` | unset | Optional HTTP event webhook endpoint; Unix socket is used by default |

## Stack

- **Frontend**: React 19, TypeScript, Vite, marked (markdown)
- **Server**: Node.js, ws (WebSocket), static dashboard serving, Unix socket event ingestion
- **Plugin**: Python (Hermes hook system)
- **Styling**: Custom CSS, light/dark themes, monospace typography

## License

MIT
