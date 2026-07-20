# RepoClaude Web 端设计方案

> 项目地址：https://github.com/Midirushi/RepoClaude
> 文档版本：v0.1（初稿）
> 适用版本：RepoClaude 0.0.1+

---

## 一、设计原则

**核心理念：Web 是新的客户端，不动 daemon、不动 core 逻辑。**

当前项目已实现完整的客户端-服务端架构：

- **Daemon（服务端）**：TCP Socket + JSON-RPC 2.0 over NDJSON（端口 7437）
- **TUI 客户端**：用 `socket_client.py` 通过 `SocketClient` 连接到 daemon
- **Web 客户端**：只需在浏览器里实现一套**等价的 JSON-RPC 2.0 over NDJSON 客户端**

**核心约束：**
- 不修改 `src/repo_claude/core/` 下任何已完成的文件
- 不动 daemon 协议
- 不引入新后端进程
- 不破坏现有测试
- TUI 可继续使用（端口 7437 支持多客户端并发）

---

## 二、整体架构

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Browser   │  WS     │  Web Bridge      │  TCP    │   Daemon     │
│  (前端 SPA) │ <─────> │  (Python 薄壳)   │ <─────> │  (core/app)  │
│  :8437      │         │  (协议转译)      │         │  :7437       │
└─────────────┘         └──────────────────┘         └──────────────┘
```

**三层结构：**

1. **前端 SPA**（静态文件，HTML/CSS/JS）
2. **Web Bridge**（轻量 Python 进程，负责 WebSocket ↔ JSON-RPC 协议转换）
3. **RepoClaude Daemon**（原有，不变）

**为什么需要 Web Bridge？**

- 浏览器不能直接发 TCP Socket + NDJSON（WebSocket 才是浏览器原生支持的双向流）
- Bridge 进程是**单向薄壳**，不包含任何业务逻辑，只做协议转译
- 一个 Bridge 支持多个浏览器 Tab（多客户端并发正是 daemon 的设计目标）

---

## 三、目录结构

新增文件（**全部在 `web/` 目录下，不污染主项目**）：

```
RepoClaude/
├── src/repo_claude/          # 主项目代码（不动）
├── docs/                     # 主项目文档（新增本设计文档）
├── web/                      # 新增：Web 端
│   ├── bridge/               # WebSocket ↔ JSON-RPC 协议桥
│   │   ├── __init__.py
│   │   ├── server.py         # websockets 实现的薄壳
│   │   └── README.md
│   ├── static/               # 前端静态资源
│   │   ├── index.html
│   │   ├── css/
│   │   │   └── style.css
│   │   ├── js/
│   │   │   ├── app.js        # 主入口
│   │   │   ├── rpc.js        # JSON-RPC 客户端
│   │   │   ├── chat.js       # 聊天视图
│   │   │   ├── permission.js # 权限审批弹窗
│   │   │   ├── session.js    # 会话管理
│   │   │   └── theme.js      # 主题切换
│   └── README.md
└── tests/                    # 现有测试（不动）
    └── web/                  # 新增：Web 端测试
        └── test_bridge.py
```

---

## 四、核心模块设计

### 4.1 Web Bridge（薄壳，约 80 行）

**功能：**
- 启动 WebSocket 服务器（默认端口 8437）
- 每个 WebSocket 连接 → 维护一个到 daemon 的 TCP 连接
- 收到浏览器消息（WebSocket 文本帧）→ 加上 `\n` 转发到 daemon
- 收到 daemon 消息（NDJSON 行）→ 转发到浏览器

**代码骨架：**

```python
# web/bridge/server.py
import asyncio
import json
import websockets
from websockets.server import serve

DAEMON_HOST = "127.0.0.1"
DAEMON_PORT = 7437  # 与 .env 的 REPO_PORT 一致
WEB_PORT = 8437


async def proxy(ws):
    """一个浏览器连接 → 一个 daemon TCP 连接"""
    try:
        reader, writer = await asyncio.open_connection(DAEMON_HOST, DAEMON_PORT)
    except (ConnectionRefusedError, OSError):
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "error": {"code": -1, "message": "daemon not running"}
        }))
        await ws.close()
        return

    async def ws_to_daemon():
        async for msg in ws:
            if isinstance(msg, bytes):
                msg = msg.decode()
            writer.write(msg.encode() + b"\n")
            await writer.drain()

    async def daemon_to_ws():
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                await ws.send(line.decode().rstrip("\n"))
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass

    try:
        await asyncio.gather(ws_to_daemon(), daemon_to_ws(), return_exceptions=True)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def main():
    print(f"Web Bridge starting on ws://127.0.0.1:{WEB_PORT}")
    print(f"Forwarding to daemon at {DAEMON_HOST}:{DAEMON_PORT}")
    async with serve(proxy, "127.0.0.1", WEB_PORT, max_size=64 * 1024 * 1024):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
```

**为什么这样设计？**
- 80 行实现所有功能，无业务逻辑
- daemon 协议完全不变，浏览器和 TUI 行为一致
- 可以独立部署、独立测试
- `max_size=64*1024*1024` 与 daemon 的 `limit=_MAX_LINE_BYTES` 一致

### 4.2 前端 RPC 客户端（约 100 行）

**直接复用项目已有的 `socket_client.py` 思路，改成 WebSocket 版本。**

```javascript
// web/static/js/rpc.js
export class RepoRpc {
  constructor() {
    this.ws = null;
    this.pending = new Map();   // req_id -> {resolve, reject}
    this.eventHandlers = [];
    this.onClose = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket("ws://127.0.0.1:8437");
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error("WebSocket 连接失败"));
      this.ws.onmessage = (e) => this._dispatch(e.data);
      this.ws.onclose = () => {
        if (this.onClose) this.onClose();
      };
    });
  }

  async call(method, params = {}) {
    const reqId = crypto.randomUUID();
    const fut = new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
    });
    this.ws.send(JSON.stringify({
      jsonrpc: "2.0", id: reqId, method, params
    }));
    return fut;
  }

  onEvent(handler) {
    this.eventHandlers.push(handler);
  }

  _dispatch(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      console.error("invalid JSON from bridge:", line);
      return;
    }
    if ("jsonrpc" in msg) {
      // RPC 响应
      const fut = this.pending.get(msg.id);
      if (fut) {
        this.pending.delete(msg.id);
        if (msg.error) {
          const err = new Error(msg.error.message || "RPC error");
          err.code = msg.error.code;
          fut.reject(err);
        } else {
          fut.resolve(msg.result || {});
        }
      }
    } else if (msg.kind === "event") {
      // 服务端推送事件
      this.eventHandlers.forEach(h => {
        try { h(msg.event); } catch (e) { console.error(e); }
      });
    }
  }
}
```

### 4.3 核心功能映射

把 daemon 已有的 JSON-RPC 方法映射到 UI 组件：

| Daemon 方法 | Web 端 UI 组件 |
|------------|----------------|
| `core.ping` | 顶部状态栏（连接状态、版本、运行时间） |
| `event.subscribe` | 全局事件订阅（启动时调一次） |
| `session.create` | "新建会话" 按钮 |
| `session.send_message` | 消息输入框 + 发送按钮 |
| `session.get_history` | 会话详情侧边栏 |
| `session.close` | 会话菜单的"关闭"项 |
| `session.compact` | 会话菜单的"压缩上下文"项 |
| `permission.respond` | 权限审批弹窗的"允许/拒绝"按钮 |
| `agent.run` | 主页"快速运行"入口 |
| `run.list` | 历史 run 列表 |
| `run.get` | run 详情查看 |

---

## 五、UI 设计

### 5.1 整体布局（桌面端）

```
┌────────────────────────────────────────────────────────────────┐
│  ◇ RepoClaude     状态: ● 已连接  v0.0.1    ⌘K  ☀  ⏻ 新会话   │  ← 顶栏 (56px)
├──────────┬─────────────────────────────────────────────────────┤
│          │                                                      │
│ 会话列表  │                对话区                              │
│ (240px)  │                                                      │
│          │   [你]  帮我重构 auth 模块                          │
│ ▸ 当前   │                                                      │
│   会话 A  │   [AI]  好的，我先看一下现有代码...                  │
│          │         [工具: read_file auth.py]                    │
│ ○ 会话 B  │         [AI]  我看到 auth.py 中第 42 行的...         │
│   5 分钟前 │                                                      │
│          │                                                      │
│ + 新会话  │                                                      │
│          ├─────────────────────────────────────────────────────┤
│          │  [输入框........................]        [发送 →]   │  ← 底栏
└──────────┴─────────────────────────────────────────────────────┘
```

### 5.2 视觉风格

**设计参考：**
- **配色**：参考 Linear / Vercel Dashboard 风格，浅色为主，强调留白
- **字体**：等宽（JetBrains Mono / SF Mono）展示代码，正文用系统字体
- **圆角**：6-8px 统一圆角
- **阴影**：极轻，几乎不可见的微阴影
- **过渡**：200ms ease 动画

**CSS 变量（浅色 + 深色双主题）：**

```css
:root {
  /* 背景层 */
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-elevated: #ffffff;

  /* 边框与分隔 */
  --border: #e5e7eb;
  --border-strong: #d1d5db;

  /* 文字 */
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;

  /* 强调色 */
  --accent: #6366f1;          /* indigo-500 */
  --accent-hover: #4f46e5;    /* indigo-600 */
  --accent-bg: #eef2ff;       /* indigo-50 */

  /* 状态色 */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;

  /* 消息气泡 */
  --user-bubble: #eef2ff;     /* 用户消息背景 */
  --ai-bubble: #f9fafb;       /* AI 消息背景 */
  --tool-bubble: #f3f4f6;     /* 工具调用块 */

  /* 尺寸 */
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow: 0 2px 8px rgba(0,0,0,0.06);
}

[data-theme="dark"] {
  --bg-primary: #0f1115;
  --bg-secondary: #16181d;
  --bg-elevated: #1c1f26;
  --border: #2a2e37;
  --border-strong: #3a3f4b;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --text-tertiary: #6b7280;
  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-bg: #1e1b4b;
  --user-bubble: #1e1b4b;
  --ai-bubble: #1c1f26;
  --tool-bubble: #232730;
}
```

### 5.3 关键组件设计

#### 顶栏（极简）

```
┌──────────────────────────────────────────────────────────┐
│  ◇ RepoClaude         状态: ● 已连接  v0.0.1    ⌘K  ☀  ⏻ │
└──────────────────────────────────────────────────────────┘
```

- 左：Logo + 名称
- 中：连接状态点（绿/红/黄），悬停显示详情
- 右：快捷键、主题切换、新会话按钮

#### 侧边栏（会话列表）

- 列表项：标题（前 30 字截断）+ 时间相对值（"5 分钟前"）
- 鼠标悬停：显示操作图标（重命名/关闭）
- 选中态：左侧 2px 强调色条
- 底部"+ 新会话"按钮

#### 对话区

**用户消息：**
- 右对齐，浅色气泡
- 最大宽度 70%
- 字号 14px

**AI 消息：**
- 左对齐，无气泡
- 左侧 2px 强调色竖条
- 包含 thinking blocks（折叠）、text、tool_use（独立展示）

**工具调用块：**
```
┌─────────────────────────────────────┐
│ 🔧 bash                             │
│ $ rm -rf node_modules               │
│ ✓ 退出码 0  ·  耗时 234ms           │
└─────────────────────────────────────┘
```
- 灰色背景块
- 工具名 + 参数摘要 + 执行结果
- 可点击展开看完整输出

**流式渲染：**
- token 逐字显示
- 当前 token 灰色背景高亮
- 完成后高亮消失

**权限审批弹窗：**
```
┌──────────────────────────────────────┐
│  ⚠ 权限审批                          │
│                                      │
│  工具: bash                          │
│  参数预览:                           │
│    command: 'rm -rf node_modules'    │
│    cwd: /Users/.../project           │
│                                      │
│  [拒绝] [允许一次]                   │
│  [始终拒绝] [始终允许]               │
└──────────────────────────────────────┘
```

- 居中弹窗，半透明背景遮罩
- 参数预览，关键值加粗
- 4 个按钮：拒绝 / 允许一次 / 始终拒绝 / 始终允许

#### 输入框

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  输入消息...                          [发送 →]   │
│                                                  │
└──────────────────────────────────────────────────┘
        Shift+Enter 换行 · Enter 发送
```

- 自动撑高（最多 6 行）
- `Enter` 发送，`Shift+Enter` 换行
- 发送时按钮变 loading 状态
- 底栏小字显示快捷键提示

### 5.4 响应式

| 断点 | 布局 |
|------|------|
| ≥1024px（桌面） | 三栏：侧边栏 + 对话区 |
| 768-1023px（平板） | 侧边栏可折叠（汉堡按钮） |
| <768px（移动） | 单栏，侧边栏抽屉式 |

---

## 六、关键交互流程

### 6.1 用户发送消息

```
[用户] 输入消息
  ↓ Enter
[前端] session.send_message(sid, text)
  ↓ JSON-RPC over WebSocket
[Bridge] 转发到 daemon
  ↓ NDJSON
[daemon] session.send_message 处理器
  ↓
[loop] ReAct 主循环开始
  ↓
[EventBus] 发送事件流
  ↓
[Bridge] 转发事件
  ↓
[前端] eventHandlers 接收，渲染
```

### 6.2 权限审批

```
[loop] 调用 tool 前 → permission_manager.check_and_wait
  ↓
[EventBus] permission.requested
  ↓
[Bridge] 转发
  ↓
[前端] 显示审批弹窗
  ↓
[用户] 点击"允许一次"
  ↓
[前端] permission.respond(tool_use_id, "allow_once")
  ↓ JSON-RPC
[daemon] permission_manager.respond
  ↓
[loop] Future set_result → 协程继续
  ↓
[tool] 执行 → tool_result
```

### 6.3 会话切换

```
[用户] 点击侧边栏会话 B
  ↓
[前端] session.get_history(sid_b)
  ↓
[daemon] 返回消息列表
  ↓
[前端] 渲染历史消息
  ↓
[前端] event.subscribe(scope=sid_b) // 只订阅该会话事件
```

---

## 七、文件清单与代码骨架

### 7.1 HTML 骨架

```html
<!-- web/static/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoClaude</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css">
</head>
<body>
  <div id="app">
    <header class="topbar">
      <div class="brand">◇ RepoClaude</div>
      <div class="status" id="status">● 未连接</div>
      <div class="actions">
        <button id="theme-toggle" title="主题切换">☀</button>
        <button id="new-session" title="新建会话">⏻ 新会话</button>
      </div>
    </header>

    <div class="main">
      <aside class="sidebar" id="sidebar">
        <div class="session-list" id="session-list"></div>
        <button class="new-session-btn" id="new-session-btn">+ 新会话</button>
      </aside>

      <main class="chat">
        <div class="messages" id="messages"></div>
        <div class="input-area">
          <textarea id="input" placeholder="输入消息..." rows="1"></textarea>
          <button id="send">发送 →</button>
        </div>
        <div class="hint">Enter 发送 · Shift+Enter 换行</div>
      </main>
    </div>

    <div class="modal" id="permission-modal" hidden></div>
  </div>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

### 7.2 CSS 骨架

```css
/* web/static/css/style.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  height: 100vh;
  overflow: hidden;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* 顶栏 */
.topbar {
  height: 56px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
}

.brand { font-weight: 600; font-size: 15px; }

.status {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
.status.connected { color: var(--success); }
.status.error { color: var(--error); }

/* 主体布局 */
.main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 240px;
  background: var(--bg-primary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.session-list { flex: 1; overflow-y: auto; padding: 8px; }

.session-item {
  padding: 8px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  margin-bottom: 2px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid transparent;
  transition: background 0.15s;
}
.session-item:hover { background: var(--bg-secondary); }
.session-item.active {
  background: var(--accent-bg);
  border-left-color: var(--accent);
}
.session-item .title { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-item .meta { color: var(--text-tertiary); font-size: 11px; }

.new-session-btn {
  margin: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}
.new-session-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }

/* 对话区 */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 16px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}

.message { margin-bottom: 16px; display: flex; }
.message.user { justify-content: flex-end; }
.message.assistant { justify-content: flex-start; }
.message-content {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  line-height: 1.6;
  word-wrap: break-word;
}
.message.user .message-content {
  background: var(--user-bubble);
}
.message.assistant .message-content {
  background: transparent;
  border-left: 2px solid var(--accent);
  padding-left: 12px;
  max-width: 100%;
}

.tool-block {
  background: var(--tool-bubble);
  border-radius: var(--radius);
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 13px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.tool-block .tool-name { color: var(--accent); font-weight: 600; }

/* 输入区 */
.input-area {
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}
#input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  min-height: 36px;
  max-height: 200px;
}
#input:focus { border-color: var(--accent); }

#send {
  padding: 0 20px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
}
#send:hover { background: var(--accent-hover); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }

.hint {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 4px;
  background: var(--bg-primary);
}

/* 权限审批弹窗 */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-content {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 480px;
  max-width: 90%;
  box-shadow: var(--shadow);
}
.modal-content h3 { margin-bottom: 16px; }
.modal-params {
  background: var(--bg-secondary);
  padding: 12px;
  border-radius: var(--radius);
  font-family: ui-monospace, monospace;
  font-size: 13px;
  margin-bottom: 16px;
  max-height: 200px;
  overflow-y: auto;
}
.modal-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.modal-actions button {
  padding: 8px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-primary);
  cursor: pointer;
  font-size: 13px;
}
.modal-actions button.danger { color: var(--error); border-color: var(--error); }
.modal-actions button.primary { background: var(--accent); color: white; border-color: var(--accent); }
```

### 7.3 主入口 JS

```javascript
// web/static/js/app.js
import { RepoRpc } from './rpc.js';
import { Chat } from './chat.js';
import { Session } from './session.js';
import { Permission } from './permission.js';
import { Theme } from './theme.js';

const rpc = new RepoRpc();
const theme = new Theme();
const session = new Session(rpc);
const chat = new Chat(rpc, session);
const permission = new Permission(rpc);

async function main() {
  theme.init();
  try {
    await rpc.connect();
    document.getElementById('status').textContent = '● 已连接';
    document.getElementById('status').className = 'status connected';
    await rpc.call('core.ping');
    await session.refreshList();
    await session.loadActive();
    await rpc.call('event.subscribe', { topics: ['*'], scope: 'global' });
  } catch (e) {
    document.getElementById('status').textContent = '● 连接失败';
    document.getElementById('status').className = 'status error';
    console.error(e);
    return;
  }

  rpc.onEvent((event) => {
    const type = event.type || '';
    if (type.startsWith('llm.')) chat.handleLlmEvent(event);
    else if (type.startsWith('tool.')) chat.handleToolEvent(event);
    else if (type.startsWith('permission.')) permission.handleEvent(event);
    else if (type.startsWith('run.')) chat.handleRunEvent(event);
  });

  document.getElementById('send').onclick = () => chat.send();
  document.getElementById('input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.send();
    }
  };
  document.getElementById('new-session').onclick = () => session.create();
  document.getElementById('new-session-btn').onclick = () => session.create();
  document.getElementById('theme-toggle').onclick = () => theme.toggle();

  // 自动撑高输入框
  const input = document.getElementById('input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });
}

main();
```

### 7.4 Chat 视图

```javascript
// web/static/js/chat.js
export class Chat {
  constructor(rpc, session) {
    this.rpc = rpc;
    this.session = session;
    this.messagesEl = document.getElementById('messages');
    this.inputEl = document.getElementById('input');
    this.currentAssistantEl = null;
  }

  async send() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    const sid = this.session.activeId;
    if (!sid) {
      await this.session.create();
    }

    this.appendUserMessage(text);
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    document.getElementById('send').disabled = true;

    try {
      await this.rpc.call('session.send_message', {
        session_id: sid, content: text
      });
    } catch (e) {
      this.appendSystemMessage(`错误: ${e.message}`);
    } finally {
      document.getElementById('send').disabled = false;
    }
  }

  handleLlmEvent(event) {
    if (event.type === 'llm.token') {
      if (!this.currentAssistantEl) this.startAssistant();
      this.appendToken(event.token);
    } else if (event.type === 'llm.message_done') {
      this.finishAssistant();
    }
  }

  handleToolEvent(event) {
    if (event.type === 'tool.started') {
      this.appendToolBlock(event);
    } else if (event.type === 'tool.finished') {
      this.updateToolBlock(event);
    }
  }

  handleRunEvent(event) {
    if (event.type === 'run.started') {
      this.clearMessages();
    } else if (event.type === 'run.finished') {
      this.session.refreshList();
    }
  }

  appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML = `<div class="message-content"></div>`;
    div.querySelector('.message-content').textContent = text;
    this.messagesEl.appendChild(div);
    this.scrollToBottom();
  }

  startAssistant() {
    this.currentAssistantEl = document.createElement('div');
    this.currentAssistantEl.className = 'message assistant';
    this.currentAssistantEl.innerHTML = `<div class="message-content"></div>`;
    this.messagesEl.appendChild(this.currentAssistantEl);
  }

  appendToken(token) {
    const el = this.currentAssistantEl.querySelector('.message-content');
    el.textContent += token;
    this.scrollToBottom();
  }

  finishAssistant() {
    this.currentAssistantEl = null;
  }

  appendToolBlock(event) {
    const div = document.createElement('div');
    div.className = 'tool-block';
    div.id = `tool-${event.tool_use_id}`;
    div.innerHTML = `
      <div class="tool-name">🔧 ${event.tool_name}</div>
      <pre>${this.escape(JSON.stringify(event.input, null, 2))}</pre>
    `;
    this.messagesEl.appendChild(div);
    this.scrollToBottom();
  }

  updateToolBlock(event) {
    const el = document.getElementById(`tool-${event.tool_use_id}`);
    if (el) el.classList.add('done');
  }

  appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="message-content" style="color: var(--error)"></div>`;
    div.querySelector('.message-content').textContent = text;
    this.messagesEl.appendChild(div);
  }

  clearMessages() {
    this.messagesEl.innerHTML = '';
  }

  scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

### 7.5 Session 管理

```javascript
// web/static/js/session.js
export class Session {
  constructor(rpc) {
    this.rpc = rpc;
    this.activeId = null;
    this.listEl = document.getElementById('session-list');
  }

  async refreshList() {
    try {
      const result = await this.rpc.call('session.list', {});
      this.renderList(result.sessions || []);
    } catch (e) {
      console.error('failed to load sessions:', e);
    }
  }

  renderList(sessions) {
    this.listEl.innerHTML = '';
    sessions.forEach(s => {
      const div = document.createElement('div');
      div.className = 'session-item' + (s.id === this.activeId ? ' active' : '');
      div.onclick = () => this.load(s.id);
      div.innerHTML = `
        <div class="title">${this.escape(s.title || '未命名会话')}</div>
        <div class="meta">${this.formatTime(s.updated_at)}</div>
      `;
      this.listEl.appendChild(div);
    });
  }

  async load(sid) {
    this.activeId = sid;
    await this.loadHistory(sid);
    this.refreshList();
  }

  async loadActive() {
    if (this.activeId) await this.load(this.activeId);
  }

  async loadHistory(sid) {
    const result = await this.rpc.call('session.get_history', { session_id: sid });
    this.renderHistory(result.messages || []);
  }

  renderHistory(messages) {
    const messagesEl = document.getElementById('messages');
    messagesEl.innerHTML = '';
    messages.forEach(m => {
      if (m.role === 'user') {
        // 渲染用户消息
      } else if (m.role === 'assistant') {
        // 渲染 AI 消息
      }
    });
  }

  async create() {
    const result = await this.rpc.call('session.create', {});
    this.activeId = result.session_id;
    await this.refreshList();
    document.getElementById('messages').innerHTML = '';
  }

  formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff/60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff/3600)} 小时前`;
    return d.toLocaleDateString('zh-CN');
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

### 7.6 Permission 弹窗

```javascript
// web/static/js/permission.js
export class Permission {
  constructor(rpc) {
    this.rpc = rpc;
    this.modalEl = document.getElementById('permission-modal');
    this.pending = new Map();  // tool_use_id -> resolve
  }

  handleEvent(event) {
    if (event.type !== 'permission.requested') return;
    this.show(event);
  }

  show(req) {
    return new Promise((resolve) => {
      this.pending.set(req.tool_use_id, resolve);
      this.modalEl.innerHTML = `
        <div class="modal-content">
          <h3>⚠ 权限审批</h3>
          <p>工具: <strong>${this.escape(req.tool_name)}</strong></p>
          <div class="modal-params">${this.escape(JSON.stringify(req.params, null, 2))}</div>
          <div class="modal-actions">
            <button class="danger" data-decision="deny_once">拒绝</button>
            <button data-decision="allow_once">允许一次</button>
            <button class="danger" data-decision="deny_always">始终拒绝</button>
            <button class="primary" data-decision="allow_always">始终允许</button>
          </div>
        </div>
      `;
      this.modalEl.hidden = false;
      this.modalEl.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => this.respond(req.tool_use_id, btn.dataset.decision);
      });
    });
  }

  async respond(toolUseId, decision) {
    this.modalEl.hidden = true;
    try {
      await this.rpc.call('permission.respond', {
        tool_use_id: toolUseId, decision
      });
    } catch (e) {
      console.error('failed to respond:', e);
    }
    const resolve = this.pending.get(toolUseId);
    if (resolve) {
      this.pending.delete(toolUseId);
      resolve();
    }
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
```

### 7.7 Theme 切换

```javascript
// web/static/js/theme.js
export class Theme {
  constructor() {
    this.key = 'repo-claude-theme';
  }

  init() {
    const saved = localStorage.getItem(this.key) || 'light';
    this.apply(saved);
  }

  toggle() {
    const current = document.documentElement.dataset.theme || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    this.apply(next);
    localStorage.setItem(this.key, next);
  }

  apply(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'light' ? '☀' : '🌙';
  }
}
```

---

## 八、CLI 入口（可选）

在主项目 `src/repo_claude/cli/commands/web.py` 添加一个 CLI 命令（**这是唯一需要修改主项目的地方**）：

```python
# src/repo_claude/cli/commands/web.py
import asyncio
import sys
from pathlib import Path
from repo_claude.core.config import RepoConfig

WEB_PORT = 8437
BRIDGE_DIR = Path(__file__).parent.parent.parent.parent / "web" / "bridge"


def cmd_web_start(config: RepoConfig, port: int = WEB_PORT) -> None:
    """启动 Web Bridge，把 daemon 协议转译为 WebSocket。"""
    sys.path.insert(0, str(BRIDGE_DIR))
    from server import main as bridge_main
    print(f"Web Bridge starting on ws://127.0.0.1:{port}")
    print(f"Open http://127.0.0.1:{port + 1} in your browser")
    asyncio.run(bridge_main())
```

**在 `cli/main.py` 注册子命令**：

```python
# 在 cli/main.py 中添加
elif args.command == "web":
    from repo_claude.cli.commands.web import cmd_web_start
    cmd_web_start(config, port=args.port)
```

**影响评估：**
- 仅新增文件，不修改任何已有文件
- TUI、CLI、daemon 行为完全不变
- 单元测试不受影响（`tests/` 目录不变）

---

## 九、依赖管理

**Web 端独立 `pyproject.toml`**（`web/pyproject.toml`）：

```toml
[project]
name = "repo-claude-web"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "websockets>=12.0",
]

[project.scripts]
repo-web = "bridge.server:main"
```

**主项目 pyproject.toml 改动：**
- 在 `dependencies` 末尾加 `"websockets>=12.0"`（可选，因为 web 端是独立功能）
- 或者保持不变，让用户自己 `uv pip install websockets`

**前端依赖（CDN 引入，不打包）：**
- `marked@12`（Markdown 渲染，~30KB）
- `highlight.js@11`（代码高亮，~50KB）
- 全部用 `<script src="https://cdn.jsdelivr.net/...">` 引入

---

## 十、与原项目的兼容性保证

| 检查项 | 保证方式 |
|--------|---------|
| **daemon 协议不变** | Bridge 透传 NDJSON，不解析协议 |
| **不修改 core/** | 所有新代码在 `web/` 目录 |
| **不破坏现有测试** | 单元测试只覆盖 core，TUI 不受影响 |
| **TUI 可继续使用** | 端口 7437 多客户端支持，TUI 和 Web 可同时连 |
| **pyproject.toml 兼容** | Web 端独立 `web/pyproject.toml`，主项目可选安装 |
| **可选启动** | `repo web` 命令可选，没装也不影响 `repo`/`repo-tui` |
| **Git 历史干净** | Web 端作为一个新 commit，与 daemon 改造分开 |

---

## 十一、关键技术选型

| 选择 | 理由 |
|------|------|
| **websockets** 库 | Python 原生异步支持，比 aiohttp 轻量 |
| **原生 JS（无框架）** | 减少构建复杂度，60KB 即可搞定所有交互 |
| **WebSocket** | 浏览器原生，daemon TCP 一一对应 |
| **CSS Grid + Flexbox** | 布局直观，无须 CSS 框架 |
| **marked + highlight.js** | Markdown + 代码高亮，按需加载（CDN） |
| **localStorage** | 主题偏好持久化 |

---

## 十二、风险与缓解

| 风险 | 缓解 |
|------|------|
| Bridge 进程单点 | 启动时检测 daemon，断连自动重连 |
| WebSocket 大帧 | 单条消息限 64MB，与 daemon 一致 |
| 跨域问题 | Bridge 只绑 127.0.0.1，不暴露公网 |
| 大量事件阻塞 | 浏览器端用 requestAnimationFrame 批量渲染 |
| Bridge 进程崩溃 | 监控进程状态，崩溃时自动重启（可选） |
| 并发编辑冲突 | 当前不支持多人协作编辑同一会话（未来扩展） |

---

## 十三、实现计划

### 阶段一：MVP（最小可用）✅ 已完成

| 任务 | 状态 | 实际产出 |
|------|------|---------|
| Web Bridge 80 行实现 | ✅ | 114 行，基于 `websockets` 库 |
| 基础 HTML + CSS | ✅ | 93 行 HTML，711 行 CSS（双主题 + 响应式） |
| RPC 客户端 | ✅ | 171 行 `rpc.js`（自动重连、状态订阅） |
| 会话列表 + 对话区 | ✅ | 220 行 `session.js`（localStorage 记忆） |
| 输入框 + 发送 | ✅ | `chat.js` 中实现（流式 token + 工具块） |
| 权限审批弹窗 | ✅ | 93 行 `permission.js`（4 种决策 + Esc/Enter 快捷键） |

**阶段一额外实现（超出设计）：**
- 子 Agent 块展示（`subagent.started/finished`）
- 上下文压缩提示（`context.compacted`）
- Toast 状态提示
- 响应式布局（< 768px 侧栏抽屉式）
- `repo web` CLI 子命令注册
- 4 个 Bridge 单元测试

**与设计文档的差异：**
1. 事件名按真实协议修正：`tool.started/finished` → `tool.call_started/finished/failed`，`llm.message_done` → `session.waiting_for_input`
2. 决策值按真实协议修正：`deny_always/allow_always` → `always_deny/always_allow`
3. `session.list` RPC 暂未实现（daemon 未暴露），前端改用 `session.created` 事件 + localStorage 追踪会话
4. 静态文件服务暂用 `python -m http.server`（阶段二合并到 Bridge）

### 阶段二：体验优化

- Markdown 渲染（用 marked.js，~30KB）
- 代码高亮（用 highlight.js，~50KB）
- 工具调用可视化折叠面板（已部分实现）
- 会话重命名 / 关闭（已实现）
- 输入框自动撑高（已实现）
- 流式渲染光标闪烁（已实现）
- Bridge 同时托管静态文件（省去单独 HTTP 服务）

### 阶段三：高级功能

- 多客户端实时同步（已天然支持，靠 event.subscribe）
- 子 Agent 可视化（嵌套进度条）
- Trace 实时查看
- 移动端深度适配
- 键盘快捷键面板（⌘K 调出）
- 文件拖拽上传
- 多语言切换（中/英）

---

## 十四、测试方案

### Bridge 测试

```python
# tests/web/test_bridge.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_proxy_forwards_ws_to_daemon():
    """测试 WebSocket 消息能转发到 daemon"""
    # 启动 mock daemon
    # 启动 bridge
    # 发送 WebSocket 消息
    # 验证 daemon 收到
    pass

@pytest.mark.asyncio
async def test_proxy_forwards_daemon_to_ws():
    """测试 daemon 消息能转发到 WebSocket"""
    pass

@pytest.mark.asyncio
async def test_proxy_handles_daemon_unavailable():
    """测试 daemon 不可用时返回错误"""
    pass
```

### 前端测试（手动）

- 跨浏览器测试（Chrome / Firefox / Safari）
- 跨设备测试（桌面 / 平板 / 手机）
- 主题切换测试
- 权限审批流程测试
- 流式渲染性能测试

---

## 十五、待确认的设计决策

| 决策点 | 默认选择 | 备选 |
|--------|---------|------|
| 前端技术栈 | 原生 JS（无框架） | Vue 3 / React 18 |
| Bridge 端口 | 8437 | 自定义 |
| Bridge 部署方式 | 独立进程（`repo web`） | 内嵌到 daemon（需改 daemon） |
| 主题 | 浅色 + 深色双主题 | 只深色 / 只浅色 |
| 是否引入构建工具 | 否（CDN 引入 marked/highlight.js） | Vite 构建 |
| 前端是否要打包成单 HTML | 否（拆成多个文件） | 打包成单 HTML（更便携） |
| 是否支持 Markdown | 是（marked.js） | 否（纯文本） |
| 是否支持代码高亮 | 是（highlight.js） | 否 |

需要我调整某个决策点，或者直接开始实现阶段一的 MVP 吗？
