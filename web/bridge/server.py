"""Web Bridge：WebSocket ↔ TCP NDJSON 协议转译 + 静态文件托管。

- 启动 WebSocket 服务器（默认 ws://127.0.0.1:8437）
- 每个浏览器连接 → 维护一条到 RepoClaude daemon 的 TCP 连接
- 浏览器消息（WebSocket 文本帧）→ 追加 \n 转发到 daemon
- daemon 消息（NDJSON 行）→ 转发到浏览器
- 同时托管 web/static/ 下的静态文件（HTTP GET），浏览器可直接访问

daemon 协议完全不变，浏览器和 TUI 行为一致。
"""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
from pathlib import Path

from websockets.asyncio.server import ServerConnection, serve
from websockets.http11 import Headers, Request, Response

logger = logging.getLogger("web-bridge")

DAEMON_HOST = os.environ.get("REPO_BRIDGE_DAEMON_HOST", "127.0.0.1")
DAEMON_PORT = int(os.environ.get("REPO_PORT", "7437"))
WEB_HOST = os.environ.get("REPO_BRIDGE_WEB_HOST", "127.0.0.1")
WEB_PORT = int(os.environ.get("REPO_BRIDGE_WEB_PORT", "8437"))
MAX_FRAME_BYTES = 64 * 1024 * 1024  # 与 daemon _MAX_LINE_BYTES 保持一致

# 静态文件目录：web/bridge/server.py → web/static/
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def _bridge_error(message: str) -> str:
    """构造一条结构化 JSON-RPC 错误响应，发送给浏览器。"""
    return json.dumps(
        {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -1, "message": message},
        },
        ensure_ascii=False,
    )


async def _open_daemon() -> tuple[asyncio.StreamReader, asyncio.StreamWriter] | None:
    """打开到 daemon 的 TCP 连接；失败返回 None。"""
    try:
        return await asyncio.open_connection(DAEMON_HOST, DAEMON_PORT)
    except (ConnectionRefusedError, OSError) as e:
        logger.warning("failed to connect to daemon at %s:%d: %s", DAEMON_HOST, DAEMON_PORT, e)
        return None


async def proxy(ws: ServerConnection) -> None:
    """单条浏览器连接的处理：桥接到 daemon 的 TCP。"""
    peer = ws.remote_address
    logger.info("browser connected: %s", peer)

    conn = await _open_daemon()
    if conn is None:
        try:
            await ws.send(_bridge_error(f"daemon not running at {DAEMON_HOST}:{DAEMON_PORT}"))
        finally:
            await ws.close()
        return

    reader, writer = conn

    async def ws_to_daemon() -> None:
        async for msg in ws:
            # websockets 库默认按 utf-8 解析文本帧
            if isinstance(msg, bytes):
                msg = msg.decode("utf-8", errors="replace")
            writer.write(msg.encode("utf-8") + b"\n")
            await writer.drain()

    async def daemon_to_ws() -> None:
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                await ws.send(line.decode("utf-8", errors="replace").rstrip("\n"))
        except (ConnectionResetError, BrokenPipeError, OSError) as e:
            logger.debug("daemon stream closed: %s", e)
        except asyncio.IncompleteReadError:
            pass

    try:
        await asyncio.gather(ws_to_daemon(), daemon_to_ws(), return_exceptions=True)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        logger.info("browser disconnected: %s", peer)


async def _http_handler(
    _connection: ServerConnection, request: Request
) -> Response | None:
    """处理非 WebSocket 的 HTTP GET 请求：托管静态文件。
    
    对于 WebSocket 升级请求，返回 None 让 websockets 库继续处理握手。
    """
    upgrade = request.headers.get("Upgrade", "").lower()
    connection = request.headers.get("Connection", "").lower()
    if upgrade == "websocket" or "upgrade" in connection:
        return None

    path = request.path

    # 安全路径：限制在 _STATIC_DIR 内
    safe_path = path.lstrip("/")
    if not safe_path:
        safe_path = "index.html"
    # 防止目录遍历
    if ".." in safe_path:
        return Response(403, "Forbidden", Headers(), b"Forbidden")

    file_path = _STATIC_DIR / safe_path
    try:
        file_path = file_path.resolve()
        if not str(file_path).startswith(str(_STATIC_DIR.resolve())):
            return Response(403, "Forbidden", Headers(), b"Forbidden")
    except OSError:
        return Response(404, "Not Found", Headers(), b"Not Found")

    if not file_path.exists() or file_path.is_dir():
        return Response(404, "Not Found", Headers(), b"Not Found")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    headers = Headers()
    headers["Content-Type"] = mime_type or "application/octet-stream"
    body = file_path.read_bytes()
    return Response(200, "OK", headers, body)


async def main() -> None:
    """启动 Web Bridge（WebSocket + HTTP 静态文件）。"""
    logging.basicConfig(
        level=os.environ.get("REPO_BRIDGE_LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    logger.info("Web Bridge starting on ws://%s:%d", WEB_HOST, WEB_PORT)
    logger.info("HTTP static files at http://%s:%d", WEB_HOST, WEB_PORT)
    logger.info("Forwarding to daemon at %s:%d", DAEMON_HOST, DAEMON_PORT)
    async with serve(
        proxy,
        WEB_HOST,
        WEB_PORT,
        max_size=MAX_FRAME_BYTES,
        process_request=_http_handler,
    ):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
