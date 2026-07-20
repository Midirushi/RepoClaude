# RepoClaude Web 前端（阶段一 MVP）

> 把 RepoClaude 的"客户端"从 TUI 拓展到浏览器。
> **不动 daemon、不动 core 逻辑**，只是在 WebSocket ↔ daemon TCP 之间加一层薄壳（bridge）。

## 目录

```
web/
├── bridge/                # WebSocket ↔ JSON-RPC 协议桥（Python，~120 行）
│   ├── __init__.py
│   ├── server.py
│   └── README.md
├── static/                # 前端静态资源（纯 HTML/CSS/JS，无构建工具）
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js         # 主入口
│       ├── rpc.js         # JSON-RPC over WebSocket 客户端
│       ├── chat.js        # 对话视图
│       ├── session.js     # 会话管理
│       ├── permission.js  # 权限审批弹窗
│       └── theme.js       # 浅/深主题
├── pyproject.toml         # 独立依赖：仅 websockets
└── README.md
```

## 阶段一能力（MVP）

- [x] Web Bridge：浏览器 WebSocket ↔ daemon TCP+NDJSON 协议转译
- [x] 前端可加载、显示三栏布局
- [x] 顶栏状态点（connected / error / connecting）
- [x] 浅色 / 深色双主题切换（localStorage 持久化）
- [x] 新建会话、关闭会话
- [x] localStorage 记忆 active session
- [x] 加载历史消息（字符串 + Anthropic block 格式）
- [x] 发送消息、看流式 token
- [x] 工具调用块可视化（started/finished/failed，可展开详情）
- [x] 权限审批弹窗（4 种决策 + Esc/Enter 快捷键）
- [x] 子 agent 块、上下文压缩提示
- [x] Toast 状态提示
- [x] 响应式（< 768px 侧栏抽屉式）

阶段二/三留作后续：Markdown 渲染、代码高亮、Trace、移动端深度适配等。

## 运行

### 1. 启动 daemon

```bash
uv run repo-core
```

### 2. 启动 Web Bridge

**方式一：通过 `repo web` 子命令**（推荐，已在 CLI 注册）：

```bash
uv run repo web
```

**方式二：直接跑脚本**：

```bash
uv run python -m web.bridge.server
# 或：
.venv/bin/python -m web.bridge.server
```

启动后日志形如：

```
Web Bridge starting on ws://127.0.0.1:8437
Forwarding to daemon at 127.0.0.1:7437
```

### 3. 打开前端

由于阶段一是纯静态文件，**不能直接 `file://` 打开 `index.html`**——浏览器会拒绝 WebSocket
连接到 `ws://`。需要起一个本地 HTTP server：

```bash
# 任选一种
uv run python -m http.server 8438 --directory web/static
# 或
.venv/bin/python -m http.server 8438 --directory web/static
```

然后在浏览器打开 <http://127.0.0.1:8438>。

> 阶段二会改为 Bridge 同时托管静态文件（一条命令起前端+后端），省去这步。

## 端口约定

| 端口 | 用途 |
|------|------|
| 7437 | RepoClaude daemon（TCP + NDJSON） |
| 8437 | Web Bridge（WebSocket） |
| 8438 | （推荐）本地 HTTP 服务前端静态资源 |

## 与 TUI / CLI 共存

端口 7437 支持多客户端并发，daemon 已具备该能力（见 [WIRE_PROTOCOL.md](../WIRE_PROTOCOL.md)）。
因此：

- TUI 可以同时连接
- CLI 的 `repo chat` 可以同时跑
- 多个浏览器 Tab 也能同时打开

## 不影响主项目的保证

| 检查项 | 状态 |
|--------|------|
| `src/repo_claude/core/` 任何文件 | ❌ 不动 |
| `src/repo_claude/cli/commands/` 新增 `web.py` | ✅ 可选：见下 |
| `pyproject.toml` 主项目依赖 | ❌ 不动（Web 端独立 `pyproject.toml`） |
| 现有 `tests/` 单元测试 | ❌ 不动 |
| 端口 7437 daemon 协议 | ❌ 不动 |

### CLI 子命令（可选）

如需在主 CLI 加 `repo web` 入口，参考 `src/repo_claude/cli/commands/web.py`。
也可以直接 `python -m web.bridge.server` 启动，**完全不需要碰主项目**。

## 调试小贴士

打开浏览器 DevTools：

```js
// 列出当前已知对象
Object.keys(window.repo)
// 主动 ping
window.repo.rpc.call("core.ping", { client: "dev" }).then(console.log)
// 列出现有 session
window.repo.session.sids
// 监听事件
const off = window.repo.rpc.onEvent(e => console.log(e.type, e))
```

## 已知限制

- 阶段一不展示：Markdown、代码高亮、Trace 详情、模型选择、token 统计
- 会话列表只显示本浏览器创建/看到的；不列举 daemon 全部历史 session
  （daemon 暂未提供 `session.list` RPC）
- 没有内置的 HTTP 静态文件服务（阶段二合并到 Bridge）
