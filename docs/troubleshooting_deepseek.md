# RepoClaude 接入 DeepSeek API 问题排查与修复指南

本文档记录了在 macOS 环境下将 RepoClaude 接入 DeepSeek API 时遇到的所有问题及其解决方案。

---

## 问题总览

| 序号 | 问题类型 | 错误信息 | 根本原因 |
|------|----------|----------|----------|
| 1 | API 地址配置 | `ConnectTimeout` | 未配置 `ANTHROPIC_BASE_URL`，默认连接 Anthropic 官方 API |
| 2 | 超时时间不足 | `APITimeoutError` | 默认超时时间（5秒）太短，跨国网络延迟高 |
| 3 | 代理配置无效 | `APIConnectionError` | 代码未从环境变量读取代理配置 |
| 4 | 流式响应兼容性 | `AssertionError` | DeepSeek API 流式响应的 `get_final_message()` 失败 |
| 5 | .env 文件加载 | 环境变量未生效 | `load_dotenv()` 路径搜索不完整 |
| 6 | API 路径错误 | `404 Not Found` | `ANTHROPIC_BASE_URL` 配置错误，SDK 自动添加 `/v1` 前缀 |
| 7 | 文件权限问题 | `PermissionError: Operation not permitted` | macOS 沙盒限制，无法写入 `~/.repo/` 目录 |
| 8 | shell 环境变量覆盖 | `401 Unauthorized` / 连到错误的中转站 | `~/.zshrc` 中 `export ANTHROPIC_BASE_URL` 优先级高于 `.env` |

---

## 问题详情与解决方案

### 问题 1：API 地址未配置

**错误信息：**
```
httpcore.ConnectTimeout
anthropic.APITimeoutError: Request timed out or interrupted
```

**原因分析：**
- RepoClaude 使用 Anthropic Python SDK
- 默认连接 `https://api.anthropic.com`
- 国内网络无法直接访问 Anthropic API

**解决方案：**
在 `.env` 文件中配置 DeepSeek Anthropic 兼容端点：
```env
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
```

**修改文件：**
- `src/repo_claude/core/llm/provider.py` - 添加 `base_url` 参数支持

```python
# 修改前
self._client = anthropic.AsyncAnthropic(api_key=api_key)

# 修改后
base_url = os.environ.get("ANTHROPIC_BASE_URL")
if base_url:
    self._client = anthropic.AsyncAnthropic(api_key=api_key, base_url=base_url)
else:
    self._client = anthropic.AsyncAnthropic(api_key=api_key)
```

---

### 问题 2：超时时间不足

**错误信息：**
```
httpcore.ConnectTimeout
anthropic.APITimeoutError: Request timed out
```

**原因分析：**
- httpx 默认超时时间为 5 秒
- 跨国网络访问 DeepSeek API 延迟较高
- DNS 解析、TLS 握手、请求传输都需要时间

**解决方案：**
创建自定义 `httpx.AsyncClient` 并设置更长的超时时间：

```python
# 设置更长的超时时间，适应跨国网络延迟
timeout = httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)
http_client = httpx.AsyncClient(timeout=timeout, proxy=proxy if proxy else None)
self._client = anthropic.AsyncAnthropic(..., http_client=http_client)
```

**超时参数说明：**

| 参数 | 默认值 | 新值 | 说明 |
|------|--------|------|------|
| `connect` | 5s | 30s | 建立 TCP 连接的超时时间 |
| `read` | 5s | 120s | 等待服务器响应的超时时间 |
| `write` | 5s | 30s | 发送请求体的超时时间 |
| `pool` | 5s | 30s | 从连接池获取连接的超时时间 |

---

### 问题 3：代理配置无效

**错误信息：**
```
anthropic.APIConnectionError: Connection error
```

**原因分析：**
- 用户配置了 `HTTPS_PROXY=http://127.0.0.1:7890`
- 但代码未从环境变量读取代理配置并传递给 Anthropic 客户端

**解决方案：**
从环境变量读取代理配置：

```python
# 从环境变量读取代理
https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
proxy = https_proxy or http_proxy

# 创建自定义 HTTP 客户端（支持代理）
http_client = httpx.AsyncClient(timeout=timeout, proxy=proxy if proxy else None)
```

**注意：**
- 如果代理不稳定，建议移除代理配置，直接连接 DeepSeek API
- DeepSeek API 在国内可以直接访问（无需代理）

---

### 问题 4：流式响应兼容性

**错误信息：**
```
AssertionError
assert self.__final_message_snapshot is not None
```

**原因分析：**
- DeepSeek API 的流式响应格式与 Anthropic 官方略有差异
- `stream.get_final_message()` 可能返回空值

**解决方案：**
添加兼容性处理，从已接收的文本片段构造响应：

```python
try:
    final_message = await stream.get_final_message()
except AssertionError:
    log.warning("stream.get_final_message() failed, using accumulated text parts")
    from anthropic.types import Message, Usage, TextBlock
    final_message = Message(
        id=f"msg_{run_id}",
        type="message",
        role="assistant",
        content=[TextBlock(type="text", text="".join(text_parts))],
        model=self._model,
        stop_reason="end_turn",
        usage=Usage(input_tokens=0, output_tokens=len(text_parts)),
    )
```

---

### 问题 5：.env 文件加载

**错误信息：**
```
level=INFO msg="Connecting to LLM API base_url=https://agentrouter.org/"
```
（显示旧的配置，而非 `.env` 中的新配置）

**原因分析：**
- `load_dotenv()` 只检查当前工作目录的 `.env`
- 如果从其他目录启动守护进程，`.env` 无法被正确加载

**解决方案：**
添加多个 `.env` 路径搜索：

```python
env_paths = [
    Path(".env"),  # 当前工作目录
    Path(__file__).parent.parent.parent.parent / ".env",  # 项目根目录
    Path.cwd() / ".env",  # 当前工作目录（绝对路径）
]
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path, override=False)
        break
```

---

### 问题 6：API 路径错误

**错误信息：**
```
HTTP Request: POST https://api.deepseek.com/v1/v1/messages "HTTP/1.1 404 Not Found"
anthropic.NotFoundError: Error code: 404
```
或
```
HTTP Request: POST https://api.deepseek.com/v1/messages "HTTP/1.1 404 Not Found"
```

**原因分析：**
- Anthropic SDK 会自动在 `base_url` 后添加 `/v1` 前缀
- 如果配置 `ANTHROPIC_BASE_URL=https://api.deepseek.com/v1`，最终路径变成 `/v1/v1/messages`
- DeepSeek 的正确端点是 `/anthropic/v1/messages`

**解决方案：**
正确的 `ANTHROPIC_BASE_URL` 配置：

```env
# 正确 ✅ - SDK 会添加 /v1，最终路径是 /anthropic/v1/messages
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic

# 错误 ❌ - 会导致 /v1/v1/messages
ANTHROPIC_BASE_URL=https://api.deepseek.com/v1

# 错误 ❌ - 会导致 /v1/messages（缺少 /anthropic）
ANTHROPIC_BASE_URL=https://api.deepseek.com
```

---

### 问题 7：文件权限问题

**错误信息：**
```
PermissionError: [Errno 1] Operation not permitted: '/Users/Zhuanz1/.repo/logs/core.log'
PermissionError: [Errno 1] Operation not permitted: '/Users/Zhuanz1/.repo/sessions/...'
```

**原因分析：**
- macOS 沙盒安全限制
- IDE 或终端可能没有写入 `~/.repo/` 目录的权限
- 某些文件可能被系统锁定

**解决方案：**
修改配置，将日志和会话文件存储在项目目录下：

```env
# .env 文件配置
REPO_LOG_FILE=./logs/core.log
REPO_TRACE_FILE=./traces/daemon.jsonl
REPO_SESSIONS_ROOT=./sessions
```

**代码修改：**
```python
# app.py - 添加环境变量支持
sessions_root = Path(os.environ.get("REPO_SESSIONS_ROOT", "./sessions")).expanduser()
```

---

### 问题 8：shell 环境变量覆盖 .env（重点）

**错误信息：**
```
level=INFO msg="Connecting to LLM API base_url=https://agentrouter.org/"
anthropic.AuthenticationError: Error code: 401 - unauthorized client detected
```
（明明 `.env` 里写的是 DeepSeek，实际却连到旧的中转站）

**原因分析：**
- 用户 `~/.zshrc`（或 `~/.bashrc`）中有 `export ANTHROPIC_BASE_URL="https://agentrouter.org/"`
- `load_dotenv(override=False)` 默认不覆盖已存在的环境变量
- shell 全局 export 的优先级高于 `.env`，导致项目级 `.env` 被忽略
- 这个根因不易察觉——配置看起来都对，但实际运行时用了错误的值

**复现条件：**
```bash
# ~/.zshrc 里有
export ANTHROPIC_BASE_URL="https://agentrouter.org/"

# 任何新开的终端都会继承这个变量
# 直接 `uv run repo core start` 启动 daemon 会读取到 agentrouter.org
```

**解决方案：**

代码层面让项目自洽——对项目特定的 `ANTHROPIC_*` 变量，在 `.env` 加载后强制写入 `os.environ`：

```python
# config.py get_config() 中
from dotenv import dotenv_values

# 项目级覆盖键：即使 shell 已 export，也以 .env 为准
_PROJECT_OVERRIDDEN_KEYS = ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL")
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path, override=False)
        env_values = dotenv_values(env_path)
        for key in _PROJECT_OVERRIDDEN_KEYS:
            if key in env_values and env_values[key] is not None:
                os.environ[key] = env_values[key]
        break
```

**为什么用 `dotenv_values` 而不是 `load_dotenv(override=True)`：**
- `override=True` 会全局改变 `load_dotenv` 行为，可能影响其他变量的 shell 继承
- 用 `dotenv_values` 只解析不写入，再选择性覆盖项目关心的变量，更精准
- 不影响 `HTTPS_PROXY` 等通用变量的 shell 继承行为

**临时方案（不改代码）：**
```bash
# 方法 1：启动时用 env -u 擦除干扰变量
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY uv run repo core start

# 方法 2：编辑 ~/.zshrc 注释掉相关 export
# export ANTHROPIC_BASE_URL="https://agentrouter.org/"   ← 注释掉
```

**验证方法：**
```bash
# 模拟 shell 已 export 干扰变量
export ANTHROPIC_BASE_URL="https://agentrouter.org/"

# 启动 daemon（不 unset）
uv run repo core start

# 验证 .env 是否真的覆盖了 shell 值
uv run python -c "
import os
from repo_claude.core.config import get_config
get_config()
print('ANTHROPIC_BASE_URL =', os.environ.get('ANTHROPIC_BASE_URL'))
# 期望输出：https://api.deepseek.com/anthropic
"

# 跑一次任务确认
uv run repo run --goal "hih"
```

---

## 完整配置文件

### .env 示例

```env
# RepoClaude 环境配置 - DeepSeek API

# ── Core Daemon ───────────────────────────────────────────────
REPO_HOST=127.0.0.1
REPO_PORT=7437

# ── Logging ───────────────────────────────────────────────────
REPO_LOG_LEVEL=INFO
REPO_LOG_FILE=./logs/core.log
REPO_LOG_FORMAT=text

# ── LLM - DeepSeek Anthropic 兼容接口 ─────────────────────────
ANTHROPIC_API_KEY=sk-your-deepseek-api-key
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
REPO_LLM_DEFAULT_MODEL=deepseek-chat
REPO_MAX_STEPS=20

# ── Trace ─────────────────────────────────────────────────────
REPO_TRACE_FILE=./traces/daemon.jsonl

# ── Sessions ──────────────────────────────────────────────────
REPO_SESSIONS_ROOT=./sessions

# ── Proxy (可选，如果网络直连不稳定可配置) ───────────────────
# HTTPS_PROXY=http://127.0.0.1:7890
# HTTP_PROXY=http://127.0.0.1:7890
```

---

## 启动命令

```bash
# 创建必要的目录
mkdir -p logs traces sessions

# 启动守护进程
uv run repo-core

# 测试任务
uv run repo run --goal "你好"

# 启动 TUI
uv run repo-tui
```

---

## 修改的文件列表

| 文件 | 修改内容 |
|------|----------|
| `src/repo_claude/core/llm/provider.py` | 1. 支持 `ANTHROPIC_BASE_URL` 环境变量 |
|  | 2. 增加超时配置（connect 30s, read 120s） |
|  | 3. 支持代理配置（从 HTTPS_PROXY 读取） |
|  | 4. 兼容性处理：流式响应 `get_final_message()` 失败时降级处理 |
|  | 5. 添加调试日志 |
| `src/repo_claude/core/config.py` | 修复 `.env` 文件路径搜索问题 |
| `src/repo_claude/core/app.py` | 1. 添加 `os` 模块导入 |
|  | 2. 添加 `REPO_SESSIONS_ROOT` 环境变量支持 |
| `.env` | 配置 DeepSeek API 和路径 |

---

## DeepSeek API 兼容性说明

### 支持的模型

| 模型名称 | 说明 |
|----------|------|
| `deepseek-chat` | 通用对话模型（推荐） |
| `deepseek-reasoner` | 推理增强模型 |

### API 端点

| 端点类型 | URL |
|----------|-----|
| Anthropic 兼容 | `https://api.deepseek.com/anthropic` |
| OpenAI 兼容 | `https://api.deepseek.com/chat/completions` |

### 注意事项

1. **模型名称**：使用 `deepseek-chat` 而非 `deepseek-v4-flash`，后者会返回 `ThinkingBlock` 思考块，需要额外处理
2. **API 路径**：SDK 会自动添加 `/v1` 前缀，配置 `base_url` 时不要手动添加
3. **代理**：DeepSeek API 国内可直接访问，通常不需要代理

---

## 故障排查流程

遇到连接问题时，按以下步骤排查：

1. **测试网络连通性**
   ```bash
   curl -I https://api.deepseek.com
   # 应返回 HTTP/1.1 401（表示网络通，只是缺少认证）
   ```

2. **检查环境变量是否生效**
   ```bash
   cd RepoClaude
   uv run python -c "import os; print(os.environ.get('ANTHROPIC_BASE_URL'))"
   ```

3. **检查代理配置**
   ```bash
   # 测试代理是否工作
   curl -x http://127.0.0.1:7890 https://www.google.com -I
   ```

4. **查看详细日志**
   ```bash
   # 日志文件位置
   cat logs/core.log
   ```

---

## 参考链接

- [DeepSeek API 文档](https://platform.deepseek.com/api-docs/)
- [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python)
- [httpx 文档](https://www.python-httpx.org/)