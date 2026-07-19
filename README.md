# RepoClaude

从零实现的本地 AI Agent 运行时（mini 版 Claude Code）。

RepoClaude是面向开发者的本地AI Agent平台，采用“守护进程 + 终端 TUI 客户端”架构，实现LLM流式输出、工具调用、权限审批、多Agent协作和MCP工具接入。项目重点解决Agent在复杂任务场景下的任务执行、工具调用、上下文管理和执行过程可观测问题。

---

## 架构总览

```
用户
├─.repo CLI          一次性命令（ping / run / chat / trace）
└─ repo-tui          终端 UI（实时事件流、权限审批卡片、上下文水位）
       │
       │ JSON-RPC 2.0 over NDJSON (TCP 127.0.0.1:7437)
       ↓
repo-core daemon     常驻守护进程
  ├─ AgentRunner      组装运行时依赖，编排一次完整 run
  ├─ AgentLoop        ReAct 主循环：LLM 思考 → 工具调用 → 结果回填
  ├─ EventBus         发布/订阅事件总线
  ├─ SessionManager   会话生命周期（thread / notes / context 三层记忆）
  ├─ PermissionManager 6 级权限评估（拒绝 → 启发式 → 缓存 → 允许 → 默认）
  ├─ Compactor       上下文水位检测 + LLM 驱动压缩
  ├─ SkillLoader     斜杠命令解析（/review、/orchestrate …）
  ├─ SpawnAgentTool  子 Agent 派生（隔离上下文，最大深度 2）
  ├─ McpServerManager MCP 外部工具接入（stdio / tcp）
  ├─ ToolRegistry    工具注册与 Anthropic 兼容 schema 生成
  └─ TraceWriter     三层数据流可追踪（IPC / EventBus / LLM）
```

---

## 快速开始

### 环境要求

- **Python 3.12**（仅此版本）
- **uv**（Python 包管理器）
- **LLM API Key**（Anthropic 官方或 DeepSeek 等兼容接口）

### 1. 安装 uv

```bash
pip install uv
```



### 2. 同步依赖

```bash
uv sync
```


验证：

```bash
uv run repo --version
# → 0.0.1
```

### 3. 配置 .env

```bash
cp .env.example .env
```

编辑 `.env`，填入 LLM 配置：

**方案 A — Anthropic 官方 API：**

```env
ANTHROPIC_API_KEY=sk-ant-your-real-key
REPO_LLM_DEFAULT_MODEL=claude-sonnet-4-6
REPO_MAX_STEPS=20
```

**方案 B — DeepSeek 兼容接口：**

```env
ANTHROPIC_API_KEY=sk-your-deepseek-key
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
REPO_LLM_DEFAULT_MODEL=deepseek-v4-flash
REPO_MAX_STEPS=20
```


### 4. 启动守护进程

打开**终端 1**，保持运行：

```bash
uv run repo-core
```


### 5. 验证连通

打开**终端 2**：

```bash
uv run repo ping
# → pong server=0.0.1 uptime=3014ms latency=0ms
```

### 6. 跑一次任务

```bash
uv run repo run --goal "用一句话介绍这个项目"
```

终端会显示工具调用过程和最终回答。同时 `~/.repo/sessions/<id>/runs/<id>/events.jsonl` 会记录完整事件流。

### 7. 启动 TUI

```bash
uv run repo-tui
```

TUI 连接后可输入消息、看到 token 流式输出、工具调用折叠块、权限审批卡片、上下文水位等信息。

### Windows 用户注意

`asyncio.loop.add_signal_handler()` 在 Windows 上不支持，项目已做兼容处理（回退到 `signal.signal()`）。如果遇到 `NotImplementedError`，确认 `src/repo_claude/core/app.py` 的 `run()` 方法中信号注册使用了 `try/except NotImplementedError`。

---

## 项目结构

```
RepoClaude/
├── src/repo_claude/
│   ├── __init__.py              # __version__ = "0.0.1"
│   ├── cli/                     # CLI 客户端
│   │   ├── main.py              # 命令行解析与分发
│   │   └── commands/            # ping / run / chat / core / trace / version
│   ├── core/                    # 守护进程（核心引擎）
│   │   ├── app.py               # CoreApp：组装所有组件，注册 handler，启动事件循环
│   │   ├── config.py            # 四层优先级配置系统
│   │   ├── context.py           # ExecutionContext：消息、步骤、system prompt
│   │   ├── loop.py              # AgentLoop：ReAct 主循环
│   │   ├── runner.py            # AgentRunner：组装依赖，编排 run
│   │   ├── runs.py              # run ID 生成，路径工具
│   │   ├── logging_setup.py     # 日志初始化
│   │   ├── bus/                 # JSON-RPC 2.0 协议层
│   │   │   ├── envelope.py      # JsonRpcRequest / Success / Error
│   │   │   ├── commands.py      # Command  discriminated union（9 对命令/结果）
│   │   │   └── events.py        # Event discriminated union（19 个事件类型）
│   │   ├── transport/           # 传输层
│   │   │   ├── socket_server.py # TCP 服务器（NDJSON 行协议）
│   │   │   ├── socket_client.py # TCP 客户端
│   │   │   └── ipc_broadcaster.py # 事件推送到订阅客户端
│   │   ├── events/              # 事件系统
│   │   │   ├── bus.py           # EventBus：发布/订阅
│   │   │   └── writer.py        # EventWriter：持久化 events.jsonl
│   │   ├── llm/                 # LLM 接入层
│   │   │   ├── base.py          # LLMProvider Protocol
│   │   │   ├── provider.py      # AnthropicProvider（流式 + 指数退避重试）
│   │   │   └── types.py         # UsageStats / ToolCallBlock / LlmResponse
│   │   ├── tools/               # 工具系统
│   │   │   ├── base.py          # BaseTool ABC
│   │   │   ├── registry.py      # ToolRegistry
│   │   │   ├── invocation.py    # 参数校验 + 权限检查 + 超时 + 重试
│   │   │   ├── errors.py        # RateLimitedError
│   │   │   └── builtin/         # 9 个内建工具
│   │   ├── session/             # 会话系统
│   │   │   ├── model.py         # Session 数据模型
│   │   │   ├── store.py         # SessionStore：持久化 thread / notes / meta
│   │   │   └── manager.py       # SessionManager：生命周期 + skill 解析
│   │   ├── permissions/         # 权限系统
│   │   │   ├── manager.py       # 6 级权限评估 + Future-based 用户审批
│   │   │   ├── policy.py        # ToolPolicy / PermissionDecision / 默认策略
│   │   │   ├── storage.py       # TOML 策略文件读写
│   │   │   └── errors.py        # PermissionDeniedError
│   │   ├── compact/             # 上下文压缩
│   │   │   ├── compactor.py     # LLM 驱动压缩，生成 summary_*.md
│   │   │   └── budget.py        # tool_result 超长截断
│   │   ├── skills/              # Skills 斜杠命令
│   │   │   ├── loader.py        # Markdown + YAML frontmatter 解析
│   │   │   └── builtin/         # orchestrate / review / init / summarize
│   │   ├── subagent/            # 子 Agent
│   │   │   ├── tool.py          # SpawnAgentTool + AgentResultTool
│   │   │   └── registry.py      # BackgroundTaskRegistry
│   │   ├── mcp/                 # MCP 外部工具
│   │   │   ├── client.py        # JSON-RPC 2.0 MCP 客户端（stdio / tcp）
│   │   │   ├── server.py        # McpServerManager 生命周期
│   │   │   └── tool.py          # McpTool 包装为 BaseTool
│   │   ├── agents/              # Agent 角色配置
│   │   │   ├── loader.py        # TOML 角色文件解析
│   │   │   └── builtin/         # planner / executor / reviewer
│   │   ├── task/                # 子任务管理
│   │   │   ├── manager.py       # JSON 文件持久化的 CRUD
│   │   │   └── model.py         # Task 数据模型
│   │   ├── trace/               # 链路追踪
│   │   │   ├── record.py        # TraceRecord
│   │   │   ├── writer.py        # TraceWriter（JSONL）
│   │   │   └── provider.py      # TracingProvider：包装 LLM 调用记录
│   │   └── memory/              # 项目级上下文
│   │       └── loader.py        # 读取 .repo/context.md
│   └── tui/                     # TUI 前端（Textual 框架）
│       ├── __main__.py          # 入口
│       └── app.py               # RepoTuiApp（43KB）
├── tests/
│   ├── conftest.py              # free_port / running_daemon 夹具
│   ├── unit/                    # 34 个单元测试
│   └── integration/             # 5 个集成测试
├── scripts/
│   └── gen_protocol_doc.py      # 从 pydantic 模型生成 WIRE_PROTOCOL.md
├── .env.example                 # 环境变量模板
├── pyproject.toml               # 项目配置（PEP 621 + Hatch）
├── CLAUDE.md                    # Claude Code 协作指引
├── RUNBOOK.md                   # 运维手册
└── WIRE_PROTOCOL.md             # 协议文档（自动生成）
```

---

## 运行链路

一次 .repo run --goal "..."` 的完整执行路径：

```
用户敲下命令
  → CLI 解析参数，构造 JSON-RPC 请求
  → TCP 127.0.0.1:7437，NDJSON 编码发送
  → SocketServer 接收，dispatch 到 agent.run handler
  → SessionManager 创建 one_shot session
  → AgentRunner 组装：
      ToolRegistry（内建 + MCP）→ ExecutionContext → AgentLoop
  → AgentLoop 主循环（最多 max_steps 轮）：
      ① 构建 Anthropic messages（system + thread + tools）
      ② AnthropicProvider.chat() 流式调用 LLM
      ③ 每 token 发布 LlmTokenEvent → EventBus → TUI 实时渲染
      ④ 模型返回 tool_use → invoke_tool()：
         参数校验（pydantic）→ 权限审批（PermissionManager）
         如果 ASK → 推送 PermissionRequestedEvent → TUI 审批卡片
         用户批准 → 执行工具 → 发布 ToolCallFinishedEvent
      ⑤ tool_result 追加入 messages → 回到 ①
      ⑥ 模型返回 end_turn → 循环结束
  → 发布 RunFinishedEvent
  → 结果返回 CLI / TUI
  → events.jsonl 持久化完整事件流（可回放）
```

---

## 开发阶段（S0 → S7）

项目按 8 个工程阶段演进，每个阶段解决一个真实的 Agent 工程问题：

| 阶段 | 主题 | 核心问题 |
|------|------|----------|
| **S0** | 骨架与协议契约 | CLI 和 daemon 通过 TCP JSON-RPC 2.0 完成 ping/pong |
| **S1** | Agent 最小闭环 | 从 goal 到 LLM → 工具调用 → 事件文件，完整跑通 |
| **S2** | 事件流外化 | AgentRunner 搬进 daemon，CLI/TUI 通过 IPC 订阅事件 |
| **S3** | 自主规划与 TUI | 任务拆解工具 + Textual TUI，实时展示执行过程 |
| **Trace** | 系统级时间线 | IPC / EventBus / LLM 三层数据流可追踪、可回放 |
| **S4** | 会话与记忆 | thread / notes / context 三层记忆，跨 run 续航 |
| **S5** | 工具安全 | 参数校验、6 级权限审批、失败分类、指数退避重试 |
| **S6** | 上下文治理 | 水位检测、tool_result 截断、LLM 驱动 compact 压缩 |
| **S7** | 扩展边界 | Skills、Subagents（planner/executor/reviewer）、MCP 外部工具 |

S0 就先把 daemon 和客户端拆开——这一步看起来比普通脚手架重，但它换来的是后面所有能力不用推倒重来。

---

## 配置参考

### 四层优先级（低 → 高）

1. 代码内建默认值
2. `~/.repo/config.toml`（用户全局）
3. `.repo/config.toml`（项目本地）
4. `.env` 文件
5. 环境变量（`REPO_*`）

### 主要环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPO_HOST` | `127.0.0.1` | TCP 监听地址 |
| `REPO_PORT` | `7437` | TCP 监听端口 |
| `REPO_LOG_LEVEL` | `INFO` | 日志级别 |
| `REPO_LOG_FILE` | `~/.repo/logs/core.log` | 日志文件路径 |
| `REPO_LOG_FORMAT` | `text` | 日志格式（text / json） |
| `ANTHROPIC_API_KEY` | — | LLM API 密钥（**必填**） |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | API 基础 URL（DeepSeek 等兼容接口用） |
| `REPO_LLM_DEFAULT_MODEL` | `claude-sonnet-4-6` | 默认模型 |
| `REPO_MAX_STEPS` | `20` | AgentLoop 最大步数 |
| `REPO_PERMISSION_TIMEOUT_S` | `60.0` | 权限审批超时秒数 |

### ~/.repo/config.toml 示例

```toml
[core]
host = "127.0.0.1"
port = 7437

[logging]
level  = "INFO"
file   = "~/.repo/logs/core.log"
format = "text"

[agent]
max_steps = 20

[llm]
default_model = "claude-sonnet-4-6"

[permission]
timeout_s = 60.0

[compaction]
auto_threshold = 0.8
tool_result_limit = 8000
tool_result_keep = 4000

# MCP 外部工具服务器
[[mcp.servers]]
name = "my-tools"
transport = "stdio"
command = "my-mcp-server"
args = ["--port", "3000"]
```

---

## CLI 命令参考

```bash
# 版本
uv run repo --version

# 连通性检查
uv run repo ping

# 一次性任务
uv run repo run --goal "你的目标描述"

# 多轮对话
uv run repo chat

# 守护进程生命周期
uv run repo core start     # 启动 daemon
uv run repo core stop      # 停止 daemon
uv run repo core status    # 查看状态

# 链路追踪
uv run repo trace list     # 列出 trace
uv run repo trace view <id> # 查看某条 trace
```

---

## 开发指南

```bash
# 安装依赖
uv sync

# Lint
uv run ruff check src tests scripts

# 类型检查
uv run mypy src

# 单元测试（不需要 daemon）
uv run pytest tests/unit -v

# 集成测试（需要 ANTHROPIC_API_KEY）
uv run pytest tests/integration -v

# 全量测试
uv run pytest tests/ -v

# 单个测试
uv run pytest tests/unit/test_envelope.py::test_request_roundtrip -v

# 重新生成协议文档
uv run python scripts/gen_protocol_doc.py

# 验证协议文档同步
uv run python scripts/gen_protocol_doc.py --check
```


## 内建工具

| 工具 | 功能 | 需要权限审批 |
|------|------|:---:|
| `read_file` | 读取文件 | |
| `write_file` | 写入/覆写文件 | ✅ |
| `list_dir` | 列出目录 | |
| `bash` | 执行 Shell 命令 | ✅ |
| `note_save` | 保存笔记到 session | |
| `task_create` | 创建子任务 | |
| `task_update` | 更新子任务状态 | |
| `task_list` | 列出子任务 | |
| `task_get` | 获取子任务详情 | |
| `spawn_agent` | 派生子 Agent | |
| `agent_result` | 查询后台子 Agent 结果 | |

---

## 内建 Skills

| Skill | 触发方式 | 功能 |
|-------|----------|------|
| `orchestrate` | `/orchestrate <目标>` | planner → executor → reviewer 三阶段工作流 |
| `review` | `/review <文件>` | 代码审查 |
| `init` | `/init` | 初始化项目的 CLAUDE.md |
| `summarize` | `/summarize <内容>` | 内容摘要 |

## 技术栈

- **语言**：Python 3.12
- **LLM SDK**：Anthropic Python SDK（流式 + prompt caching）
- **数据校验**：Pydantic v2（discriminated union）
- **TUI**：Textual（终端 UI 框架）
- **IPC**：JSON-RPC 2.0 over NDJSON（TCP）
- **构建**：Hatchling（PEP 517）
- **测试**：pytest + pytest-asyncio
- **Lint/类型**：Ruff + Mypy strict

---

## License

