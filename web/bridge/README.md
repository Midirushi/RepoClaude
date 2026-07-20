# Web Bridge

RepoClaude daemon（TCP + JSON-RPC 2.0 over NDJSON，端口 7437）和浏览器 WebSocket 之间的薄壳转译。

## 设计

- **入口**：`bridge.server.main`
- **职责**：只做"行级"协议转译，不解析任何业务字段
- **隔离性**：daemon 协议完全不变；TUI / CLI 不受影响

## 启动

### 方式一：直接运行

```bash
# 先启动 daemon
uv run repo-core

# 新终端：启动 bridge
uv run python -m web.bridge.server
# 或：
.venv/bin/python -m web.bridge.server
```

### 方式二：通过 `repo web` 子命令（推荐）

```bash
uv run repo web
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPO_BRIDGE_DAEMON_HOST` | `127.0.0.1` | daemon 主机 |
| `REPO_PORT` | `7437` | daemon 端口（与 daemon 自身的 `REPO_PORT` 保持一致） |
| `REPO_BRIDGE_WEB_HOST` | `127.0.0.1` | bridge 监听主机 |
| `REPO_BRIDGE_WEB_PORT` | `8437` | bridge 监听端口 |
| `REPO_BRIDGE_LOG_LEVEL` | `INFO` | 日志级别 |

## 浏览器侧

打开 `web/static/index.html`（阶段一为本地静态页），前端 `js/rpc.js` 会连接 `ws://127.0.0.1:8437`。
