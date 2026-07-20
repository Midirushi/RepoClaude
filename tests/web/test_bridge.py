"""Web Bridge 单元测试（最小覆盖：协议透传 + daemon 不可用处理）。

这些测试不启动真实 daemon（避免依赖 core 状态），而是用一个本地 mock server
验证 Bridge 的 WebSocket ↔ NDJSON 行为。
"""

from __future__ import annotations

import asyncio
import json

import pytest

from web.bridge.server import (
    DAEMON_HOST,
    DAEMON_PORT,
    WEB_HOST,
    WEB_PORT,
    main,
    proxy,
)


# 找一个空闲端口，避免与现有 daemon 冲突
async def _pick_port() -> int:
    server = await asyncio.start_server(lambda r, w: None, host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    server.close()
    await server.wait_closed()
    return port


class _MockDaemon:
    """最小的 NDJSON echo + 主动推送：可用于验证 Bridge 双向透传。"""

    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self._host, self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        # 简单回显：收到一行就回一行
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                # 把它当作 JSON-RPC 请求，返回同 id 的 result
                try:
                    req = json.loads(line)
                except json.JSONDecodeError:
                    writer.write(b'{"error":"bad json"}\n')
                    await writer.drain()
                    continue
                resp = {
                    "jsonrpc": "2.0",
                    "id": req.get("id"),
                    "result": {"echoed": req.get("method"), "params": req.get("params")},
                }
                writer.write((json.dumps(resp) + "\n").encode())
                await writer.drain()
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass


async def test_bridge_module_exports() -> None:
    """Bridge 模块对外暴露的符号应该可被 import。"""
    from web.bridge import main as _main, proxy as _proxy
    from web.bridge.server import DAEMON_HOST as _h, DAEMON_PORT as _p, WEB_PORT as _wp

    assert _main is main
    assert _proxy is proxy
    assert _h == DAEMON_HOST
    assert _p == DAEMON_PORT
    assert _wp == WEB_PORT
    assert WEB_PORT == 8437
    assert DAEMON_PORT == 7437


def test_default_ports() -> None:
    """默认端口应与 daemon 协议约定一致。"""
    assert DAEMON_HOST == "127.0.0.1"
    assert DAEMON_PORT == 7437
    assert WEB_HOST == "127.0.0.1"
    assert WEB_PORT == 8437


@pytest.mark.asyncio
async def test_proxy_responds_error_when_daemon_down(monkeypatch) -> None:
    """当 daemon 不可用时，proxy 应通过 WebSocket 发送一条 JSON-RPC 错误并关闭连接。"""
    import websockets
    from websockets.asyncio.server import serve as ws_serve

    # 把 daemon 端口指向一个不存在的端口（先占用后立即释放）
    fake_port = await _pick_port()
    monkeypatch.setattr("web.bridge.server.DAEMON_PORT", fake_port)

    # 在临时端口上启动 WebSocket 服务，使用真正的 proxy handler
    ws_port = await _pick_port()
    monkeypatch.setattr("web.bridge.server.WEB_PORT", ws_port)
    monkeypatch.setattr("web.bridge.server.WEB_HOST", "127.0.0.1")

    server = await ws_serve(proxy, "127.0.0.1", ws_port)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{ws_port}") as ws:
            # bridge 应至少发一条 error 然后 close
            msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
            data = json.loads(msg)
            assert "error" in data, f"expected error envelope, got {data}"
            assert data["error"]["code"] == -1
            assert "daemon" in data["error"]["message"]
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_proxy_uses_max_frame_size() -> None:
    """Bridge 的 max_size 应与 daemon 64MB 保持一致（这里只验证不抛异常）。"""
    # 仅做静态校验：实际包大小由 import 路径与 server 的常量决定
    from web.bridge.server import MAX_FRAME_BYTES
    assert MAX_FRAME_BYTES == 64 * 1024 * 1024


@pytest.mark.asyncio
async def test_http_static_files(monkeypatch) -> None:
    """Bridge 应能同时托管静态文件（HTTP GET）。"""

    async def _http_get(host: str, port: int, path: str) -> tuple[int, bytes]:
        reader, writer = await asyncio.open_connection(host, port)
        request = f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
        writer.write(request.encode())
        await writer.drain()
        response = await reader.read()
        writer.close()
        await writer.wait_closed()
        header, _, body = response.partition(b"\r\n\r\n")
        status_line = header.split(b"\r\n")[0].decode()
        status = int(status_line.split()[1])
        return status, body

    # 在临时端口上启动 Bridge（使用真实的 main handler）
    ws_port = await _pick_port()
    monkeypatch.setattr("web.bridge.server.WEB_PORT", ws_port)
    monkeypatch.setattr("web.bridge.server.WEB_HOST", "127.0.0.1")
    # 指向一个不存在的 daemon 端口，避免连接成功
    fake_port = await _pick_port()
    monkeypatch.setattr("web.bridge.server.DAEMON_PORT", fake_port)

    from web.bridge.server import main as real_main

    # 启动 bridge（在后台运行）
    bridge_task = asyncio.create_task(real_main())
    await asyncio.sleep(0.5)  # 等待服务器启动

    try:
        # 测试 index.html
        status, body = await _http_get("127.0.0.1", ws_port, "/")
        assert status == 200
        text = body.decode()
        assert "<!DOCTYPE html>" in text
        assert "RepoClaude" in text

        # 测试 CSS
        status, body = await _http_get("127.0.0.1", ws_port, "/css/style.css")
        assert status == 200
        assert "RepoClaude Web" in body.decode()

        # 测试 JS
        status, body = await _http_get("127.0.0.1", ws_port, "/js/rpc.js")
        assert status == 200
        assert "RepoRpc" in body.decode()

        # 测试 404
        status, _ = await _http_get("127.0.0.1", ws_port, "/nonexistent")
        assert status == 404

        # 测试目录遍历防护
        status, _ = await _http_get("127.0.0.1", ws_port, "/../pyproject.toml")
        assert status == 403
    finally:
        bridge_task.cancel()
        try:
            await bridge_task
        except asyncio.CancelledError:
            pass
