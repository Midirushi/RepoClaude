"""Web Bridge：把 daemon 的 TCP+NDJSON 协议转译为浏览器可用的 WebSocket。

设计原则：
- 不解析任何业务协议，只做"行级"透传
- 浏览器一个 WebSocket 连接 → 桥进程一个到 daemon 的 TCP 连接
- daemon 协议完全不变，TUI 与 Web 可同时连
"""

from __future__ import annotations

from .server import DAEMON_HOST, DAEMON_PORT, WEB_PORT, main, proxy

__all__ = ["DAEMON_HOST", "DAEMON_PORT", "WEB_PORT", "main", "proxy"]
