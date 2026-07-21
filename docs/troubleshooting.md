# 开发问题解决方案记录

> 本文档记录开发 RepoClaude 过程中遇到的典型问题及其解决方案，便于后续查阅与排查。
> 文档版本：v0.1（2026-07-21）

---

## 目录

- [Web 前端](#web-前端)
  - [1. CODEBLOCK 占位符问题](#1-codeblock-占位符问题)
  - [2. WebSocket 重连订阅丢失](#2-websocket-重连订阅丢失)
  - [3. 辅助信息占据对话窗口](#3-辅助信息占据对话窗口)
  - [4. SkillCompleter 引用未定义变量](#4-skillcompleter-引用未定义变量)
- [后端 Core](#后端-core)
  - [5. session.send_message 阻塞导致无法中断](#5-sessionsend_message-阻塞导致无法中断)
  - [6. Trace 文件读取性能](#6-trace-文件读取性能)
- [运维部署](#运维部署)
  - [7. GitHub Push 网络超时](#7-github-push-网络超时)
  - [8. 端口占用排查](#8-端口占用排查)

---

## Web 前端

### 1. CODEBLOCK 占位符问题（自伤 bug）

**现象**：AI 输出的代码块显示为 `CODEBLOCK0`、`CODEBLOCK1` 等占位符，而不是实际代码。

**初步错误诊断**：以为是 LLM（特别是 deepseek-chat）自身的输出习惯——它把"之前展示过的代码"简写为占位符。于是加了 3 层防御：
1. 系统提示词约束
2. 后端 token 流正则过滤
3. 前端 markdown.js 兜底警告

**真正的根因**：通过查看 trace 文件 `traces/daemon.jsonl`，**LLM 从未输出过 CODEBLOCK 字符串**（`grep CODEBLOCK traces/daemon.jsonl` 返回空）。

真正的元凶是 [markdown.js](file:///Users/Zhuanz1/Downloads/Eino-Agent-Develop/RepoClaude/web/static/js/markdown.js) 自己：

```javascript
// 原实现：markdown 提取代码块后用 \x00CODE_BLOCK_N\x00 占位
return `\x00CODE_BLOCK_${idx}\x00`;
// ...后续处理链中某一步误命中此占位符...
```

我在第 20 行新增的 `processCodeblockPlaceholders`（前端兜底警告）使用的正则 `/\bCODE[_ ]?BLOCK[_ ]?\d+\b/gi`，**误命中了内部占位符 `\x00CODE_BLOCK_0\x00` 中的 `CODE_BLOCK_0`**！于是把占位符替换成了警告框，后面的还原步骤（`/\x00CODE_BLOCK_(\d+)\x00/g`）找不到占位符，**代码块永久丢失**，UI 显示警告框（而非 LLM 输出的 CODEBLOCK）。

**正确解决方案**：

1. 删除所有防御代码（前端 processCodeblockPlaceholders + 后端 token 过滤）
2. 把内部占位符改名，避免与任何潜在的关键词冲突：

```javascript
// 改为不包含 CODE/BLOCK 字样的短占位符
return `\x00CB${idx}\x00`;
// 对应还原正则
html = html.replace(/\x00CB(\d+)\x00/g, ...)
```

3. 保留系统提示词的 RESPONSE FORMAT RULES 作为软性约束（无害）

**排查方法**（关键）：
```bash
# 查 LLM 实际输出的完整内容
grep "api_response" ~/.repo/traces/daemon.jsonl | tail -5
# 查某个字符串是否真的来自 LLM
grep -c "CODEBLOCK" traces/daemon.jsonl  # 0 = LLM 没输出过
```

**关键教训**：
- **先验证再优化**：怀疑 LLM 输出问题前，先查 trace 看真实输出
- **不要盲目加防御**：未经验证的"防御代码"可能本身就是 bug 源
- **内部占位符要唯一**：不要用与业务关键词相同字符的占位符，避免被自己的正则误伤
- **简化优先**：能不加代码就不加，每多一行代码多一份风险

---

### 2. WebSocket 重连订阅丢失

**现象**：浏览器断网重连后，无法继续接收事件推送，UI 卡住。

**根因**：
- WebSocket 重连后没有重新调用 `event.subscribe`
- daemon 端的订阅者对象已随旧连接销毁

**解决方案**：

[rpc.js](file:///Users/Zhuanz1/Downloads/Eino-Agent-Develop/RepoClaude/web/static/js/rpc.js) 增加 `onReconnect` 回调机制：

```javascript
export class RepoRpc {
  constructor() {
    this._reconnectCallbacks = [];
  }

  onReconnect(cb) {
    this._reconnectCallbacks.push(cb);
  }

  _onOpen() {
    // 重连时触发所有回调
    for (const cb of this._reconnectCallbacks) {
      cb();
    }
  }
}
```

[app.js](file:///Users/Zhuanz1/Downloads/Eino-Agent-Develop/RepoClaude/web/static/js/app.js) 订阅时注册重连逻辑：

```javascript
rpc.onReconnect(async () => {
  await subscribeEvents();
  // 恢复 active session
  if (lastSessionId) {
    session.load(lastSessionId);
  }
});
```

---

### 3. 辅助信息占据对话窗口

**现象**：每个对话轮次的"步骤 1 开始"、"模型: deepseek-chat (策略: static)"、"Token: 22,979..."等系统消息占据大量空间，影响主要对话内容阅读。

**根因**：所有辅助信息都使用 `_appendSystem()` 渲染为系统消息气泡（带背景色、内边距）。

**解决方案**：

新增轻量级 `_appendMeta()` 方法，用 11px 灰色细行展示辅助信息：

```javascript
_appendMeta(text) {
  const el = document.createElement("div");
  el.className = "meta-line";
  el.textContent = text;
  this.messagesEl.appendChild(el);
}
```

CSS：
```css
.meta-line {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 2px 0;
  line-height: 1.4;
  user-select: none;
  font-variant-numeric: tabular-nums;
}
```

把 `step.started`、`llm.usage`、`llm.model_selected`、`context.compacted` 都改用 `_appendMeta`。

**效果对比**：
- 之前：3 个大系统气泡
- 现在：3 行 11px 灰色文字，视觉退居次要

---

### 4. SkillCompleter 引用未定义变量

**现象**：集成斜杠命令补全时，初始化报错 `inputEl is not defined`。

**根因**：
- `skillCompleter = new SkillCompleter(rpc, inputEl)` 写在文件顶部
- 但 `inputEl` 在文件下方才定义（变量提升对 `const` 无效）

**解决方案**：

调整代码顺序，把 SkillCompleter 实例化移到 `inputEl` 定义之后：

```javascript
// ❌ 错误：inputEl 未定义
const skillCompleter = new SkillCompleter(rpc, inputEl);
// ...
const inputEl = document.getElementById("input");

// ✅ 正确：先定义 inputEl
const inputEl = document.getElementById("input");
const skillCompleter = new SkillCompleter(rpc, inputEl);
```

**关键教训**：
- ES Module 中 `const` 声明不会变量提升（TDZ）
- 初始化顺序敏感的代码要放在 DOM 获取之后

---

## 后端 Core

### 5. session.send_message 阻塞导致无法中断

**现象**：实现"中断按钮"时，发现无法取消正在运行的 agent run，UI 按钮卡住。

**根因**：
- 原 `_session_send_handler` 是**同步等待**：`await self._sessions.send_message(...)`
- 这意味着 RPC handler 会阻塞到 run 完成
- 无法从外部取消该 task

**解决方案**：

改为 **fire-and-forget** 模式 + 维护 task 映射：

```python
async def _session_send_handler(self, params):
    cmd = SessionSendMessageCommand.model_validate(params)
    run_id = new_run_id()
    sid = cmd.session_id

    # 取消该 session 上正在运行的旧 task
    prev_task = self._session_tasks.get(sid)
    if prev_task is not None and not prev_task.done():
        prev_task.cancel()

    # 启动后台 task，立即返回 run_id
    task = asyncio.create_task(self._run_session_task(sid, cmd.content, run_id))
    self._session_tasks[sid] = task
    task.add_done_callback(lambda _t, k=sid: self._session_tasks.pop(k, None))
    return SessionSendMessageResult(run_id=run_id)
```

`_run_cancel_handler` 通过 `task.cancel()` 取消：

```python
async def _run_cancel_handler(self, params):
    cmd = RunCancelCommand.model_validate(params)
    task = self._session_tasks.get(cmd.session_id)
    if task is None or task.done():
        return RunCancelResult(cancelled=False)
    task.cancel()
    await task  # 等待 CancelledError 处理完毕
    return RunCancelResult(cancelled=True)
```

**关键设计**：取消时必须发布双事件保持前后端状态一致：
- `RunFinishedEvent(status="failed", reason="cancelled")`
- `SessionWaitingForInputEvent`（清理前端 loading 状态）

**关键教训**：
- 长耗时任务 RPC 必须 fire-and-forget
- 维护 `dict[session_id, Task]` 才能精准取消
- 取消时要补发状态事件，否则前端状态不一致

---

### 6. Trace 文件读取性能

**现象**：`trace.read` RPC 在 trace 文件较大时（>10MB）响应缓慢。

**根因**：
- 初版实现读取整个文件到内存，再过滤
- `trace_path.read_text().splitlines()` 对大文件不友好

**解决方案**：

只读取末尾 N 行（利用 `deque`）：

```python
from collections import deque

async def _trace_read_handler(self, params):
    trace_path = Path(self._config.trace.file).expanduser()
    cmd = TraceReadCommand.model_validate(params)

    # 只保留最后 cmd.lines * 2 行（考虑过滤后剩余条数）
    tail_lines = deque(maxlen=cmd.lines * 2)
    with open(trace_path) as f:
        for line in f:
            tail_lines.append(line)

    # 过滤
    records = []
    for line in tail_lines:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cmd.run_id and rec.get("run_id") != cmd.run_id:
            continue
        if cmd.layer and rec.get("layer") != cmd.layer:
            continue
        records.append(rec)
    return TraceReadResult(records=records[-cmd.lines:])
```

**关键教训**：
- 日志类文件读取必须用 streaming + deque
- 不要 `read_text()` 整个文件

---

## 运维部署

### 7. GitHub Push 网络超时

**现象**：`git push origin main` 频繁超时失败，但本地 commit 正常。

**根因**：
- 国内网络访问 GitHub 不稳定
- SSH 协议比 HTTPS 更易超时

**解决方案**：

**临时方案**：重试 + 延迟

```bash
git push origin main || (sleep 5 && git push origin main)
```

**长期方案**：配置 SSH 走 443 端口

```bash
# ~/.ssh/config
Host github.com
  Hostname ssh.github.com
  Port 443
  User git
```

或使用代理：

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

**验证**：`ssh -T git@github.com` 应返回 "Hi username!"

---

### 8. 端口占用排查

**现象**：重启 daemon 或 web bridge 时报 "address already in use"。

**解决方案**：

一键查找并清理端口占用：

```bash
# 查找占用进程
lsof -nP -iTCP:7437 -sTCP:LISTEN -t
# 批量清理
lsof -nP -iTCP:7437 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null

# Web Bridge 端口 8437 同理
lsof -nP -iTCP:8437 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null

sleep 1  # 等待端口释放
```

**关键教训**：
- `lsof -nP -iTCP:PORT -sTCP:LISTEN -t` 只输出 PID，便于管道处理
- `2>/dev/null` 静默无占用时的错误输出
- kill 后必须 sleep 1 秒等端口释放

---

## 附：常用排查命令

### 查看 daemon 日志

```bash
tail -f ~/.repo/logs/daemon.log
```

### 查看 trace 记录

```bash
repo trace -f                    # 实时跟随
repo trace --layer llm           # 只看 LLM 层
repo trace <run_id>              # 按 run_id 过滤
```

### TCP 直连测试 RPC

```bash
python -c "
import json, socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 7437))
req = json.dumps({'jsonrpc':'2.0','id':'1','method':'skill.list','params':{}}) + '\n'
s.sendall(req.encode())
buf = b''
while True:
    data = s.recv(4096)
    buf += data
    if b'\n' in buf:
        break
print(json.loads(buf.split(b'\n')[0]))
"
```

### 检查 Web Bridge WebSocket 连接

```bash
# 查看活跃连接
lsof -nP -iTCP:8437 | grep ESTABLISHED
```

---

## 贡献指南

遇到新的典型问题时，请按以下格式添加到本文档：

```markdown
### N. 问题标题

**现象**：用户看到的表现。

**根因**：技术层面的根本原因。

**解决方案**：代码示例 + 关键文件链接。

**关键教训**：一句话总结可复用的经验。
```
