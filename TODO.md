Add some sort of plan mode integration via skill/plugin to Hermes. This would show up as a view plan button within the chat/session interface of the dashboard, which then renders the markdown with approve/deny/revise buttons.

Surface approval plug-in on sandbox host level that routes to host.openshell.internal, runs as docker container on host/over LAN. Acts as a broker to send custom approval notifications and forward approval requests back to target sandbox. Maybe a sandbox-cli daemon.

Host level dashboard will need Microsoft oauth and approved tenant/object ID management/requesting.