# 运维手册（RUNBOOK）

## 日常操作

### 启动守护进程

```bash
uv run repo-core
```

默认监听 `127.0.0.1:7437`，按 `Ctrl+C` 优雅退出。

### 启动 Web 客户端

```bash
# 终端 1：启动 daemon（必须先启动）
uv run repo-core

# 终端 2：启动 Web Bridge（WebSocket ↔ daemon TCP + HTTP 静态文件）
uv run repo web
# 或直接启动：python -m web.bridge.server
```

浏览器打开 http://127.0.0.1:8437 即可。

**端口约定：**

| 端口 | 用途 |
|------|------|
| 7437 | RepoClaude daemon（TCP + NDJSON） |
| 8437 | Web Bridge（WebSocket + HTTP 静态文件） |

**环境变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPO_BRIDGE_DAEMON_HOST` | `127.0.0.1` | daemon 主机 |
| `REPO_BRIDGE_WEB_HOST` | `127.0.0.1` | bridge 监听主机 |
| `REPO_BRIDGE_WEB_PORT` | `8437` | bridge 监听端口 |
| `REPO_BRIDGE_LOG_LEVEL` | `INFO` | bridge 日志级别 |

**停止 Web Bridge：**

```bash
kill $(pgrep -f "web.bridge.server")
```

### 验证连通

```bash
uv run repo ping
# → pong server=0.0.1 uptime=12ms latency=2ms
```

### 停止守护进程

```bash
kill $(pgrep -f repo-core)
```

---

## 配置

优先级（低 → 高）：**内建默认值 → `~/.repo/config.toml` → `.env` → 系统环境变量**。

### `~/.repo/config.toml`

```toml
[core]
host = "127.0.0.1"
port = 7437

[logging]
level  = "INFO"
file   = "~/.repo/logs/core.log"
format = "text"    # "text" | "json"
```

### `.env`

从 `.env.example` 复制后修改，存放本机配置与密钥（不提交 git）：

```bash
cp .env.example .env
```

### 系统环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPO_CONFIG` | `~/.repo/config.toml` | 覆盖配置文件路径 |
| `REPO_HOST` | `127.0.0.1` | TCP 监听地址 |
| `REPO_PORT` | `7437` | TCP 监听端口 |
| `REPO_LOG_LEVEL` | `INFO` | 日志级别（DEBUG / INFO / WARNING / ERROR） |
| `REPO_LOG_FILE` | `~/.repo/logs/core.log` | 日志文件路径（留空则仅输出 stderr） |
| `REPO_LOG_FORMAT` | `text` | 日志格式（`text` 或 `json`） |

---

## 开发

```bash
uv run ruff check src tests scripts   # lint
uv run mypy src                       # 类型检查
uv run pytest tests/ -v               # 全量测试
uv run pytest tests/unit/ -v         # 仅单元测试（无需启动 daemon）

make docs                             # 重新生成 WIRE_PROTOCOL.md
make verify-s0                        # 完整验证（lint + 类型 + 测试 + 协议同源检查）
```

---

## 日志

```bash
tail -f ~/.repo/logs/core.log
```

---

## 常见错误

| 报错 | 原因 | 处理 |
|------|------|------|
| `core already running at 127.0.0.1:7437` | 已有守护进程在运行 | `kill $(pgrep -f repo-core)` |
| `core not running` | 未启动守护进程 | `uv run repo-core` |
| `Address already in use` | 端口被其他进程占用 | `REPO_PORT=8000 uv run repo-core` |
| `Config error: REPO_PORT must be an integer` | `.env` 或环境变量中端口值非整数 | 检查 `REPO_PORT` 的值 |
| `daemon not running at 127.0.0.1:7437` | Web Bridge 无法连接 daemon | 确认 daemon 已启动，端口一致 |
| WebSocket 连接失败 | 浏览器用 `file://` 协议打开 HTML | 必须用 HTTP 服务（`python -m http.server`） |
