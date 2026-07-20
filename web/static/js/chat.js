// web/static/js/chat.js
// 对话视图：消息渲染、流式输出、工具调用块、子 agent 块
//
// 事件映射（参见 src/repo_claude/core/bus/events.py）：
//   llm.token              → 追加 token 到当前 assistant 块
//   tool.call_started      → 新增 tool-block（包含 params 预览）
//   tool.call_finished     → 标记 done + 写入 output
//   tool.call_failed       → 标记 failed + 错误信息
//   subagent.started/finished → 子 agent 进度块
//   run.started/finished   → 状态标记
//   session.waiting_for_input → 一轮结束，光标停止闪烁

import { markdownToHtml } from "./markdown.js";

export class Chat {
  constructor(rpc, session) {
    this.rpc = rpc;
    this.session = session;
    this.messagesEl = document.getElementById("messages");
    this.inputEl = document.getElementById("input");
    this.sendBtn = document.getElementById("send");

    // 当前正在累积的 assistant 流式块
    this.currentAssistantEl = null;
    this.currentAssistantTextEl = null;
    this._receivedAnyToken = false;
    this._hasPendingInput = false;
  }

  // ---- 用户操作 ----
  async send() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (this._hasPendingInput) {
      this._toast("上一轮尚未结束，请稍候", "error");
      return;
    }

    // 确保有 active session
    let sid = this.session.activeId;
    if (!sid) {
      const created = await this.session.create();
      if (!created) return;
      sid = created;
    }

    this._appendUserMessage(text);
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this._setSending(true);

    try {
      await this.rpc.call("session.send_message", { session_id: sid, content: text });
      // 不在这里清理 _setSending；等 session.waiting_for_input 事件触发后清理
    } catch (e) {
      this._appendError(`发送失败: ${e.message}`);
      this._setSending(false);
    }
  }

  _setSending(sending) {
    this._hasPendingInput = sending;
    this.sendBtn.disabled = sending;
    this.sendBtn.textContent = sending ? "..." : "发送 →";
  }

  // ---- 事件路由 ----
  handleEvent(event) {
    const t = event.type || "";
    if (t === "llm.token") {
      this._handleLlmToken(event);
    } else if (t === "tool.call_started") {
      this._handleToolStarted(event);
    } else if (t === "tool.call_finished") {
      this._handleToolFinished(event);
    } else if (t === "tool.call_failed") {
      this._handleToolFailed(event);
    } else if (t === "run.started") {
      this._handleRunStarted(event);
    } else if (t === "run.finished") {
      this._handleRunFinished(event);
    } else if (t === "step.started") {
      this._appendSystem(`步骤 ${event.step} 开始`);
    } else if (t === "step.finished") {
      // 可选：步骤结束
    } else if (t === "subagent.started") {
      this._appendSubagent(event.description || "(子 agent)", "started");
    } else if (t === "subagent.finished") {
      this._updateSubagent(event.run_id, event.status || "finished");
    } else if (t === "session.waiting_for_input") {
      this._finishAssistant();
      this._setSending(false);
    } else if (t === "session.closed") {
      this._finishAssistant();
      this._setSending(false);
      this._appendSystem("会话已关闭");
    } else if (t === "session.message_received") {
      // 服务端已收到用户消息的确认
    } else if (t === "llm.usage") {
      this._appendUsage(event);
    } else if (t === "llm.model_selected") {
      this._appendModelSelected(event);
    } else if (t === "log.line") {
      // 阶段一不展示日志
    } else if (t === "context.compacted") {
      this._appendSystem(
        `上下文已压缩: ${event.original_tokens} → ${event.summary_tokens} tokens`,
      );
    } else if (t === "permission.granted") {
      this._appendSystem(`已授权 (${event.decision})`);
    } else if (t === "permission.denied") {
      this._appendSystem(`已拒绝 (${event.decision})`);
    } else if (t === "skill.invoked") {
      this._appendSystem(`技能 /${event.skill_name}`);
    }
  }

  // ---- LLM 流式渲染 ----
  _handleLlmToken(event) {
    if (!this.currentAssistantEl) this._startAssistant();
    this._receivedAnyToken = true;
    this._appendToken(event.token || "");
  }

  _startAssistant() {
    this._receivedAnyToken = false;
    const wrap = document.createElement("div");
    wrap.className = "message assistant";
    const content = document.createElement("div");
    content.className = "message-content streaming-cursor";
    wrap.appendChild(content);
    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = this._formatTime(new Date());
    wrap.appendChild(ts);
    this.messagesEl.appendChild(wrap);
    this.currentAssistantEl = wrap;
    this.currentAssistantTextEl = content;
    this._assistantStartTs = ts;
    this._scrollToBottom();
  }

  _appendToken(token) {
    if (!this.currentAssistantTextEl) return;
    this.currentAssistantTextEl.textContent += token;
    this._scrollToBottom();
  }

  _finishAssistant() {
    if (this.currentAssistantTextEl) {
      this.currentAssistantTextEl.classList.remove("streaming-cursor");
      const text = this.currentAssistantTextEl.textContent;
      this.currentAssistantTextEl.innerHTML = markdownToHtml(text);
    }
    if (this._assistantStartTs) {
      this._assistantStartTs.textContent = this._formatTime(new Date());
    }
    this.currentAssistantEl = null;
    this.currentAssistantTextEl = null;
    this._assistantStartTs = null;
  }

  // ---- 工具调用 ----
  _handleToolStarted(event) {
    // 工具调用前通常 assistant 已开始；先关闭流式块
    this._finishAssistant();
    const block = document.createElement("div");
    block.className = "tool-block";
    block.id = `tool-${event.tool_use_id}`;
    const summary = this._summarizeParams(event.tool_name, event.params || {});
    block.innerHTML = `
      <div class="tool-header">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${this._escape(event.tool_name)}</span>
        <span class="tool-status">运行中...</span>
      </div>
      <div class="tool-summary">${this._escape(summary)}</div>
      <button class="tool-toggle">展开</button>
      <div class="tool-detail">${this._escape(JSON.stringify(event.params || {}, null, 2))}</div>
    `;
    this.messagesEl.appendChild(block);
    this._scrollToBottom();
    // 展开/折叠
    const toggle = block.querySelector(".tool-toggle");
    const detail = block.querySelector(".tool-detail");
    toggle.onclick = () => {
      const expanded = block.classList.toggle("expanded");
      toggle.textContent = expanded ? "收起" : "展开";
    };
    // 输出框先存起来，finished 时填充
    block._detail = detail;
    block._status = block.querySelector(".tool-status");
  }

  _handleToolFinished(event) {
    const block = document.getElementById(`tool-${event.tool_use_id}`);
    if (!block) return;
    block.classList.add("done");
    if (block._status) {
      const elapsed = event.elapsed_ms != null ? ` · 耗时 ${event.elapsed_ms}ms` : "";
      block._status.textContent = `✓ 完成${elapsed}`;
    }
    if (block._detail && event.output) {
      const output = event.output.length > 4000
        ? event.output.slice(0, 4000) + "\n...(截断)"
        : event.output;
      block._detail.textContent = JSON.stringify(
        { params: JSON.parse(block._detail.textContent || "{}"), output },
        null,
        2,
      );
    }
  }

  _handleToolFailed(event) {
    const block = document.getElementById(`tool-${event.tool_use_id}`);
    if (!block) return;
    block.classList.add("failed");
    if (block._status) {
      block._status.textContent = `✗ ${event.error_class || "failed"}`;
    }
    if (block._detail) {
      const cur = block._detail.textContent || "";
      let params = {};
      try { params = JSON.parse(cur); } catch (_) { /* noop */ }
      block._detail.textContent = JSON.stringify(
        { params, error: event.error_message, class: event.error_class, elapsed_ms: event.elapsed_ms },
        null,
        2,
      );
    }
  }

  // ---- run 状态 ----
  _handleRunStarted(_event) {
    // 不清空消息；允许多 run 累积在同会话
  }

  _handleRunFinished(event) {
    if (event.status === "failed") {
      this._appendError(`run 失败: ${event.reason || "unknown"}`);
    }
    this.session.refreshList().catch(() => { /* noop */ });
  }

  // ---- 子 agent 块 ----
  _appendSubagent(description, status) {
    const div = document.createElement("div");
    div.className = "subagent-block";
    div.dataset.runId = "";  // 留待 finished 时按 parent_run_id 匹配
    div.innerHTML = `<strong>子 agent</strong> · ${this._escape(description)} · ${this._escape(status)}`;
    this.messagesEl.appendChild(div);
    this._scrollToBottom();
  }

  _updateSubagent(runId, status) {
    // 简单实现：把最后一个 subagent-block 标为完成
    const blocks = this.messagesEl.querySelectorAll(".subagent-block");
    const last = blocks[blocks.length - 1];
    if (last) last.innerHTML += ` → ${this._escape(status)}`;
  }

  // ---- 历史渲染 ----
  renderHistory(messages) {
    // 移除欢迎页
    const welcome = document.getElementById("welcome");
    if (welcome) welcome.remove();
    this.messagesEl.innerHTML = "";
    for (const msg of messages || []) {
      const content = msg.content;
      // content 可能是字符串，也可能是 Anthropic 的 block 列表
      if (typeof content === "string") {
        if (msg.role === "user") this._appendUserMessage(content);
        else this._appendAssistantMessage(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            if (msg.role === "user") this._appendUserMessage(block.text);
            else this._appendAssistantMessage(block.text);
          } else if (block.type === "tool_use") {
            // 历史里的 tool_use 只展示不可执行的占位
            const div = document.createElement("div");
            div.className = "tool-block done";
            div.innerHTML = `
              <div class="tool-header">
                <span class="tool-icon">🔧</span>
                <span class="tool-name">${this._escape(block.name)}</span>
                <span class="tool-status">历史</span>
              </div>
              <div class="tool-summary">${this._escape(this._summarizeParams(block.name, block.input || {}))}</div>
            `;
            this.messagesEl.appendChild(div);
          } else if (block.type === "tool_result") {
            const div = document.createElement("div");
            div.className = "tool-block done";
            const resultText = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content, null, 2);
            div.innerHTML = `
              <div class="tool-header">
                <span class="tool-icon">↪</span>
                <span class="tool-name">result</span>
                <span class="tool-status">${block.is_error ? "失败" : "成功"}</span>
              </div>
              <div class="tool-detail">${this._escape(resultText.slice(0, 4000))}</div>
            `;
            this.messagesEl.appendChild(div);
          }
        }
      }
    }
    this._scrollToBottom();
  }

  clear() {
    this.messagesEl.innerHTML = "";
  }

  // ---- 内部工具 ----
  _appendUserMessage(text) {
    const welcome = document.getElementById("welcome");
    if (welcome) welcome.remove();
    const wrap = document.createElement("div");
    wrap.className = "message user";
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    wrap.appendChild(content);
    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = this._formatTime(new Date());
    wrap.appendChild(ts);
    this.messagesEl.appendChild(wrap);
    this._scrollToBottom();
  }

  _appendAssistantMessage(text) {
    const wrap = document.createElement("div");
    wrap.className = "message assistant";
    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = markdownToHtml(text);
    wrap.appendChild(content);
    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = this._formatTime(new Date());
    wrap.appendChild(ts);
    this.messagesEl.appendChild(wrap);
    this._scrollToBottom();
  }

  _appendSystem(text) {
    const wrap = document.createElement("div");
    wrap.className = "message system";
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    wrap.appendChild(content);
    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = this._formatTime(new Date());
    wrap.appendChild(ts);
    this.messagesEl.appendChild(wrap);
    this._scrollToBottom();
  }

  _appendError(text) {
    const wrap = document.createElement("div");
    wrap.className = "message error";
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    wrap.appendChild(content);
    const ts = document.createElement("div");
    ts.className = "ts";
    ts.textContent = this._formatTime(new Date());
    wrap.appendChild(ts);
    this.messagesEl.appendChild(wrap);
    this._scrollToBottom();
  }

  _appendUsage(event) {
    const total = (event.input_tokens || 0) + (event.output_tokens || 0);
    const context = event.context_pct != null ? ` · ${(event.context_pct * 100).toFixed(1)}%` : "";
    this._appendSystem(`Token: ${total.toLocaleString()} (输入 ${(event.input_tokens || 0).toLocaleString()} / 输出 ${(event.output_tokens || 0).toLocaleString()}${context})`);
  }

  _appendModelSelected(event) {
    this._appendSystem(`模型: ${event.model} (策略: ${event.strategy})`);
  }

  _toast(text, kind) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.className = "toast" + (kind ? ` ${kind}` : "");
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  _summarizeParams(toolName, params) {
    const keyByTool = {
      read_file: "path",
      write_file: "path",
      list_dir: "path",
      bash: "command",
      note_save: "content",
    };
    const k = keyByTool[toolName];
    if (k && params[k] != null) {
      const v = String(params[k]);
      return v.length > 60 ? v.slice(0, 60) + "..." : v;
    }
    const first = Object.values(params)[0];
    if (first == null) return "";
    const s = typeof first === "string" ? first : JSON.stringify(first);
    return s.length > 60 ? s.slice(0, 60) + "..." : s;
  }

  _escape(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  _scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}
