"""
Hermes Dashboard + Wiki Plugin
================================

Sends agent session events to the Hermes Dashboard and auto-starts
the dashboard server on first session.

Install:
  cd hermes-dashboard && ./install.sh

Dashboard: http://localhost:5173
Wiki API:  http://localhost:3002/api/wiki
"""

import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from urllib import request
from urllib.error import URLError
from collections import defaultdict
from pathlib import Path

logger = logging.getLogger(__name__)

SOCKET_PATH = "/tmp/hermes-dashboard.sock"
APPROVAL_SOCKET_PATH = "/tmp/hermes-dashboard-approval.sock"
WEBHOOK_URL = os.environ.get("HERMES_DASHBOARD_WEBHOOK_URL", "http://127.0.0.1:3002/api/webhook")
AGENT_NAME = os.environ.get("HERMES_AGENT_NAME", "agent")
_TOOL_CALL_IDS = defaultdict(list)
_CURRENT_SESSION_ID = None
_TASK_SESSION_IDS = {}
_SERVER_PROCESS = None
_APPROVALS = {}
_APPROVALS_LOCK = threading.Lock()
_APPROVAL_SERVER_THREAD = None
_ORIGINAL_APPROVAL_CALLBACKS = {}
_THREAD_STATE = threading.local()
_USAGE_LOCK = threading.Lock()
_SESSION_USAGE = defaultdict(lambda: {
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "reasoning_tokens": 0,
    "prompt_tokens": 0,
    "total_tokens": 0,
    "api_call_count": 0,
    "estimated_cost_usd": 0.0,
})


def _cwd():
    try:
        return os.getcwd()
    except Exception:
        return ""


def _tty():
    try:
        return os.ttyname(0)
    except Exception:
        try:
            return os.ttyname(1)
        except Exception:
            return None


def _base_payload(event_name, session_id, status, **extra):
    payload = {
        "event": event_name,
        "session_id": session_id,
        "cwd": _cwd(),
        "status": status,
        "pid": os.getpid(),
        "tty": _tty(),
    }
    payload.update(extra)
    return payload


def _send(payload):
    data = json.dumps(payload).encode("utf-8")
    try:
        req = request.Request(
            WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        request.urlopen(req, timeout=1.0).close()
        return True
    except (URLError, TimeoutError, OSError):
        pass
    except Exception as exc:
        logger.debug("hermes-dashboard: webhook send failed: %s", exc)

    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(1.0)
        sock.connect(SOCKET_PATH)
        sock.sendall(data + b"\n")
        sock.close()
        return True
    except (ConnectionRefusedError, FileNotFoundError, OSError):
        pass
    except Exception as exc:
        logger.debug("hermes-dashboard: send failed: %s", exc)
    return False


def _ensure_server():
    """Start the dashboard server if not already running."""
    global _SERVER_PROCESS
    if _SERVER_PROCESS and _SERVER_PROCESS.poll() is None:
        return

    # check if server is already running
    if os.path.exists(SOCKET_PATH):
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(0.5)
            s.connect(SOCKET_PATH)
            s.close()
            return  # server already running
        except (ConnectionRefusedError, OSError):
            pass  # stale socket

    # find the dashboard install
    dashboard_dir = os.environ.get("HERMES_DASHBOARD_DIR")
    if not dashboard_dir:
        # check common locations
        for candidate in [
            Path.home() / "hermes-dashboard",
            Path.home() / ".hermes" / "hermes-dashboard",
        ]:
            if (candidate / "server" / "index.ts").exists():
                dashboard_dir = str(candidate)
                break

    if not dashboard_dir:
        logger.debug("hermes-dashboard: server not found, skipping auto-start")
        return

    try:
        _SERVER_PROCESS = subprocess.Popen(
            ["npx", "tsx", "server/index.ts"],
            cwd=dashboard_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("hermes-dashboard: started server (pid %d)", _SERVER_PROCESS.pid)
    except Exception as exc:
        logger.debug("hermes-dashboard: failed to start server: %s", exc)


def _approval_timeout():
    try:
        return int(os.environ.get("HERMES_DASHBOARD_APPROVAL_TIMEOUT", "300"))
    except (TypeError, ValueError):
        return 300


def _approval_key(session_key, command, description):
    return f"{session_key or ''}\0{command or ''}\0{description or ''}"


def _approval_tool(command, surface):
    if surface == "codex":
        return "Codex"
    return "Bash" if command else "Approval"


def _set_active_session(session_id=""):
    global _CURRENT_SESSION_ID
    if session_id:
        _CURRENT_SESSION_ID = session_id
        _THREAD_STATE.session_id = session_id


def _active_session_id():
    return getattr(_THREAD_STATE, "session_id", None) or _CURRENT_SESSION_ID or ""


def _dashboard_session_id(session_key="", task_id="", kwargs=None):
    kwargs = kwargs or {}
    session_id = kwargs.get("session_id") or ""
    if session_id:
        return session_id
    if task_id and _TASK_SESSION_IDS.get(task_id):
        return _TASK_SESSION_IDS[task_id]
    active = _active_session_id()
    if active:
        return active
    return session_key or task_id or ""


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _usage_value(usage, name):
    if isinstance(usage, dict):
        return usage.get(name)
    return getattr(usage, name, None)


def _normal_usage(usage):
    if not usage:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "reasoning_tokens": 0,
            "prompt_tokens": 0,
            "total_tokens": 0,
        }

    input_tokens = _as_int(_usage_value(usage, "input_tokens"))
    if not input_tokens:
        input_tokens = _as_int(_usage_value(usage, "prompt_tokens"))

    output_tokens = _as_int(_usage_value(usage, "output_tokens"))
    if not output_tokens:
        output_tokens = _as_int(_usage_value(usage, "completion_tokens"))

    cache_read_tokens = _as_int(_usage_value(usage, "cache_read_tokens"))
    if not cache_read_tokens:
        cache_read_tokens = _as_int(_usage_value(usage, "cache_read_input_tokens"))

    cache_write_tokens = _as_int(_usage_value(usage, "cache_write_tokens"))
    if not cache_write_tokens:
        cache_write_tokens = _as_int(_usage_value(usage, "cache_creation_input_tokens"))

    reasoning_tokens = _as_int(_usage_value(usage, "reasoning_tokens"))
    prompt_tokens = _as_int(_usage_value(usage, "prompt_tokens"))
    if not prompt_tokens:
        prompt_tokens = input_tokens + cache_read_tokens + cache_write_tokens

    total_tokens = _as_int(_usage_value(usage, "total_tokens"))
    if not total_tokens:
        total_tokens = prompt_tokens + output_tokens

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "reasoning_tokens": reasoning_tokens,
        "prompt_tokens": prompt_tokens,
        "total_tokens": total_tokens,
    }


def _estimate_usage_cost(usage, model="", provider="", base_url=""):
    try:
        from agent.usage_pricing import CanonicalUsage, estimate_usage_cost
        canonical = CanonicalUsage(
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            cache_read_tokens=usage["cache_read_tokens"],
            cache_write_tokens=usage["cache_write_tokens"],
            reasoning_tokens=usage["reasoning_tokens"],
        )
        cost = estimate_usage_cost(
            model or "",
            canonical,
            provider=provider or "",
            base_url=base_url or "",
        )
        if cost.amount_usd is None:
            return None
        return float(cost.amount_usd)
    except Exception as exc:
        logger.debug("hermes-dashboard: usage cost estimate failed: %s", exc)
        return None


def _record_session_usage(session_id, usage, cost_usd=None):
    with _USAGE_LOCK:
        totals = _SESSION_USAGE[session_id]
        for key in (
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "reasoning_tokens",
            "prompt_tokens",
            "total_tokens",
        ):
            totals[key] += usage[key]
        totals["api_call_count"] += 1
        if cost_usd is not None:
            totals["estimated_cost_usd"] += cost_usd
        return dict(totals)


def _current_session_key():
    try:
        from tools.approval import get_current_session_key
        return get_current_session_key(default="")
    except Exception:
        return os.environ.get("HERMES_SESSION_KEY", "") or ""


def _store_approval(approval):
    key = _approval_key(
        approval.get("session_key"),
        approval.get("command"),
        approval.get("description"),
    )
    with _APPROVALS_LOCK:
        _APPROVALS[approval["approval_id"]] = approval
        _APPROVALS[key] = approval
    return approval


def _find_approval(session_key, command, description):
    key = _approval_key(session_key, command, description)
    command = (command or "").strip()
    description = (description or "").strip()
    with _APPROVALS_LOCK:
        approval = _APPROVALS.get(key)
        if approval:
            return approval
        last_id = getattr(_THREAD_STATE, "last_approval_id", None)
        if last_id:
            approval = _APPROVALS.get(last_id)
            if (
                isinstance(approval, dict)
                and not approval.get("resolved")
                and (approval.get("command") or "").strip() == command
            ):
                return approval
        for item in _APPROVALS.values():
            if not isinstance(item, dict):
                continue
            if item.get("resolved"):
                continue
            item_command = (item.get("command") or "").strip()
            item_description = (item.get("description") or "").strip()
            if item.get("session_key") == session_key and item_command == command:
                return item
            if item_command == command and (not description or item_description == description):
                return item
    return None


def _resolve_approval(approval, choice):
    approval["choice"] = choice
    approval["resolved"] = True
    event = approval.get("event")
    if event is not None:
        event.set()


def _cleanup_approval(approval):
    key = _approval_key(
        approval.get("session_key"),
        approval.get("command"),
        approval.get("description"),
    )
    with _APPROVALS_LOCK:
        _APPROVALS.pop(approval.get("approval_id"), None)
        if _APPROVALS.get(key) is approval:
            _APPROVALS.pop(key, None)


def _normal_choice(choice):
    value = str(choice or "").strip().lower()
    if value in {"approve", "approved", "allow", "allow-once", "once"}:
        return "once"
    if value in {"deny", "denied", "decline", "reject"}:
        return "deny"
    if value in {"session", "always"}:
        return value
    return ""


def _handle_approval_control(payload):
    approval_id = str(payload.get("approval_id") or "")
    choice = _normal_choice(payload.get("choice") or payload.get("decision"))
    if not approval_id or choice not in {"once", "session", "always", "deny"}:
        return {"ok": False, "error": "invalid approval response"}

    with _APPROVALS_LOCK:
        approval = _APPROVALS.get(approval_id)
    if not approval:
        return {"ok": False, "error": "approval not found"}

    if approval.get("surface") == "gateway":
        try:
            from tools.approval import resolve_gateway_approval
            resolved = resolve_gateway_approval(approval.get("session_key", ""), choice)
        except Exception as exc:
            logger.debug("hermes-dashboard: gateway approval resolution failed: %s", exc)
            return {"ok": False, "error": str(exc)}
        if resolved <= 0:
            return {"ok": False, "error": "approval not pending"}

    _resolve_approval(approval, choice)
    _send(_base_payload(
        "ApprovalDecisionSubmitted",
        approval.get("session_id") or _active_session_id() or approval.get("session_key") or approval_id,
        "waiting_for_approval",
        approval_id=approval_id,
        choice=choice,
        command=approval.get("command", ""),
        description=approval.get("description", ""),
        surface=approval.get("surface", ""),
        agent=AGENT_NAME,
    ))
    return {"ok": True, "approval_id": approval_id, "choice": choice}


def _approval_control_server():
    try:
        if os.path.exists(APPROVAL_SOCKET_PATH):
            os.unlink(APPROVAL_SOCKET_PATH)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(APPROVAL_SOCKET_PATH)
        os.chmod(APPROVAL_SOCKET_PATH, 0o600)
        server.listen(16)
    except Exception as exc:
        logger.debug("hermes-dashboard: approval control socket failed: %s", exc)
        return

    while True:
        try:
            conn, _ = server.accept()
        except OSError:
            return
        with conn:
            try:
                chunks = []
                while True:
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                payload = json.loads(b"".join(chunks).decode("utf-8"))
                response = _handle_approval_control(payload if isinstance(payload, dict) else {})
            except Exception as exc:
                response = {"ok": False, "error": str(exc)}
            try:
                conn.sendall(json.dumps(response).encode("utf-8"))
            except OSError:
                pass


def _ensure_approval_control_server():
    global _APPROVAL_SERVER_THREAD
    if _APPROVAL_SERVER_THREAD and _APPROVAL_SERVER_THREAD.is_alive():
        return
    _APPROVAL_SERVER_THREAD = threading.Thread(
        target=_approval_control_server,
        name="hermes-dashboard-approval-control",
        daemon=True,
    )
    _APPROVAL_SERVER_THREAD.start()


def _fallback_approval(command, description, allow_permanent=True):
    original = _ORIGINAL_APPROVAL_CALLBACKS.get(threading.get_ident())
    if original is not None:
        return original(
            command,
            description,
            allow_permanent=allow_permanent,
        )
    try:
        from tools.approval import prompt_dangerous_approval
        return prompt_dangerous_approval(
            command,
            description,
            allow_permanent=allow_permanent,
            approval_callback=None,
        )
    except Exception as exc:
        logger.debug("hermes-dashboard: fallback approval failed: %s", exc)
        return "deny"


def _dashboard_approval_callback(command, description, *, allow_permanent=True):
    session_key = _current_session_key()
    approval = _find_approval(session_key, command, description)
    if not approval:
        approval = _create_approval_request(
            command=command,
            description=description,
            pattern_key="",
            pattern_keys=[],
            session_key=session_key,
            surface="cli",
        )

    if not approval.get("delivered"):
        return _fallback_approval(command, description, allow_permanent=allow_permanent)

    event = approval.get("event")
    if event is None:
        return _fallback_approval(command, description, allow_permanent=allow_permanent)
    if not event.wait(timeout=_approval_timeout()):
        approval["choice"] = "timeout"
        approval["resolved"] = True
        _send(_base_payload(
            "ApprovalResponse",
            approval.get("session_id") or _active_session_id() or approval.get("session_key") or approval["approval_id"],
            "processing",
            approval_id=approval["approval_id"],
            choice="timeout",
            command=command,
            description=description,
            surface=approval.get("surface", "cli"),
            agent=AGENT_NAME,
        ))
        _cleanup_approval(approval)
        return "deny"

    choice = _normal_choice(approval.get("choice"))
    return choice if choice in {"once", "session", "always"} else "deny"


def _install_approval_callback():
    try:
        from tools.terminal_tool import _get_approval_callback, set_approval_callback
        current = _get_approval_callback()
        if current is _dashboard_approval_callback:
            return
        _ORIGINAL_APPROVAL_CALLBACKS[threading.get_ident()] = current
        set_approval_callback(_dashboard_approval_callback)
    except Exception as exc:
        logger.debug("hermes-dashboard: approval callback install failed: %s", exc)


def _restore_approval_callback():
    try:
        from tools.terminal_tool import set_approval_callback
        original = _ORIGINAL_APPROVAL_CALLBACKS.pop(threading.get_ident(), None)
        set_approval_callback(original)
    except Exception as exc:
        logger.debug("hermes-dashboard: approval callback restore failed: %s", exc)


def _create_approval_request(command="", description="", pattern_key="", pattern_keys=None, session_key="", surface="", **kwargs):
    approval_id = uuid.uuid4().hex
    session_id = _dashboard_session_id(session_key=session_key, kwargs=kwargs) or approval_id
    approval = {
        "approval_id": approval_id,
        "session_id": session_id,
        "session_key": session_key or session_id,
        "command": command or "",
        "description": description or "",
        "pattern_key": pattern_key or "",
        "pattern_keys": list(pattern_keys or []),
        "surface": surface or "cli",
        "event": threading.Event(),
        "created_at": time.time(),
        "resolved": False,
        "delivered": False,
    }
    _store_approval(approval)
    delivered = _send(_base_payload(
        "ApprovalRequest",
        session_id,
        "waiting_for_approval",
        approval_id=approval_id,
        session_key=approval["session_key"],
        command=approval["command"],
        description=approval["description"],
        pattern_key=approval["pattern_key"],
        pattern_keys=approval["pattern_keys"],
        surface=approval["surface"],
        approval_tool=_approval_tool(approval["command"], approval["surface"]),
        agent=AGENT_NAME,
    ))
    approval["delivered"] = delivered
    if not delivered:
        _cleanup_approval(approval)
    return approval


def _on_session_start(session_id="", platform="", **kwargs):
    _set_active_session(session_id)
    _ensure_server()
    _ensure_approval_control_server()
    _install_approval_callback()
    _send(_base_payload(
        "SessionStart", session_id, "waiting_for_input",
        agent=AGENT_NAME, platform=platform or "cli",
    ))


def _on_pre_tool_call(tool_name="", args=None, task_id="", **kwargs):
    session_id = _dashboard_session_id(task_id=task_id, kwargs=kwargs)
    _set_active_session(session_id)
    if task_id and session_id:
        _TASK_SESSION_IDS[task_id] = session_id
    tool_use_id = uuid.uuid4().hex
    cache_key = f"{task_id}:{tool_name}"
    _TOOL_CALL_IDS[cache_key].append(tool_use_id)
    _send(_base_payload(
        "PreToolUse", session_id, "running_tool",
        tool=tool_name, tool_input=args or {}, tool_use_id=tool_use_id, agent=AGENT_NAME,
    ))


def _on_post_tool_call(tool_name="", args=None, result="", task_id="", **kwargs):
    session_id = _dashboard_session_id(task_id=task_id, kwargs=kwargs)
    _set_active_session(session_id)
    if task_id and session_id:
        _TASK_SESSION_IDS[task_id] = session_id
    result_str = str(result)[:100] if result else ""
    cache_key = f"{task_id}:{tool_name}"
    tool_use_id = _TOOL_CALL_IDS[cache_key].pop(0) if _TOOL_CALL_IDS.get(cache_key) else None
    if cache_key in _TOOL_CALL_IDS and not _TOOL_CALL_IDS[cache_key]:
        _TOOL_CALL_IDS.pop(cache_key, None)
    _send(_base_payload(
        "PostToolUse", session_id, "processing",
        tool=tool_name, tool_input=args or {}, tool_use_id=tool_use_id,
        agent=AGENT_NAME, message=result_str,
    ))


def _on_pre_llm_call(session_id="", user_message="", platform="", **kwargs):
    _set_active_session(session_id)
    _send(_base_payload(
        "UserPromptSubmit", session_id, "processing",
        agent=AGENT_NAME, platform=platform or "cli",
        message=user_message or "",
    ))


def _on_post_llm_call(session_id="", assistant_response="", **kwargs):
    _set_active_session(session_id)
    _send(_base_payload(
        "Notification", session_id, "processing",
        notification_type="assistant_response", agent=AGENT_NAME, message=assistant_response or "",
    ))


def _on_post_api_request(session_id="", task_id="", model="", provider="", base_url="", api_mode="", usage=None, **kwargs):
    session_id = _dashboard_session_id(task_id=task_id, kwargs={"session_id": session_id})
    if not session_id:
        return
    if task_id:
        _TASK_SESSION_IDS[task_id] = session_id
    _set_active_session(session_id)

    usage_summary = _normal_usage(usage)
    if usage_summary["total_tokens"] <= 0:
        return

    cost_usd = _as_float(_usage_value(usage, "cost_usd"), default=0.0)
    if cost_usd <= 0:
        estimated = _estimate_usage_cost(
            usage_summary,
            model=model,
            provider=provider,
            base_url=base_url,
        )
        cost_usd = estimated if estimated is not None else None

    session_usage = _record_session_usage(session_id, usage_summary, cost_usd)
    _send(_base_payload(
        "LlmUsage",
        session_id,
        "processing",
        task_id=task_id or "",
        agent=AGENT_NAME,
        model=model or "",
        provider=provider or "",
        base_url=base_url or "",
        api_mode=api_mode or "",
        api_call_count=_as_int(kwargs.get("api_call_count"), session_usage["api_call_count"]),
        api_duration=_as_float(kwargs.get("api_duration"), 0.0),
        usage=usage_summary,
        session_usage=session_usage,
        estimated_cost_usd=cost_usd,
    ))


def _on_session_end(session_id="", completed=False, interrupted=False, **kwargs):
    _set_active_session(session_id)
    _restore_approval_callback()
    _send(_base_payload(
        "Notification", session_id, "waiting_for_input",
        notification_type="turn_complete", message="ready",
        agent=AGENT_NAME, completed=completed, interrupted=interrupted,
    ))


def _on_pre_approval_request(command="", description="", pattern_key="", pattern_keys=None, session_key="", surface="", **kwargs):
    _ensure_server()
    _ensure_approval_control_server()
    approval = _create_approval_request(
        command=command,
        description=description,
        pattern_key=pattern_key,
        pattern_keys=pattern_keys,
        session_key=session_key,
        surface=surface,
        **kwargs,
    )
    _THREAD_STATE.last_approval_id = approval.get("approval_id")


def _on_post_approval_response(command="", description="", pattern_key="", pattern_keys=None, session_key="", surface="", choice="", **kwargs):
    fallback_session_id = _dashboard_session_id(session_key=session_key, kwargs=kwargs)
    approval = _find_approval(session_key or fallback_session_id, command, description)
    approval_id = approval.get("approval_id") if approval else uuid.uuid4().hex
    session_id = approval.get("session_id") if approval else fallback_session_id
    if approval:
        approval["choice"] = choice or "deny"
        approval["resolved"] = True
        _cleanup_approval(approval)
    _send(_base_payload(
        "ApprovalResponse",
        session_id or approval_id,
        "processing",
        approval_id=approval_id,
        session_key=session_key or session_id,
        command=command or "",
        description=description or "",
        pattern_key=pattern_key or "",
        pattern_keys=list(pattern_keys or []),
        surface=surface or "cli",
        choice=choice or "deny",
        approval_tool=_approval_tool(command, surface),
        agent=AGENT_NAME,
    ))


def register(ctx):
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("pre_approval_request", _on_pre_approval_request)
    ctx.register_hook("post_approval_response", _on_post_approval_response)
    logger.info("hermes-dashboard plugin registered")
