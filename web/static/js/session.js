// web/static/js/session.js
// 会话管理
//
// 阶段一能力：
// - 当前 active session 用 localStorage 记忆
// - session.create / session.get_history / session.close
// - 通过订阅 session.created 事件把外部创建的会话补到列表里
// - 通过 session.get_history 加载历史

const STORAGE_KEY = "repo-claude-active-session";

export class Session {
  constructor(rpc, chat) {
    this.rpc = rpc;
    this.chat = chat;
    this.listEl = document.getElementById("session-list");
    this.emptyEl = document.getElementById("session-empty");
    this.countEl = document.getElementById("session-count");

    this.activeId = null;
    this.titles = new Map();   // sid -> { title, updatedAt }
    this.sids = new Set();     // 当前已知 sid
  }

  init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.activeId = saved;
    } catch (_) { /* localStorage 不可用 */ }
  }

  // ---- 创建 ----
  async create(title) {
    try {
      const result = await this.rpc.call("session.create", {
        mode: "chat",
        title: title || "",
      });
      const sid = result.session_id;
      this._addOrUpdate(sid, { title: title || "新会话", updatedAt: new Date().toISOString() });
      this._setActive(sid);
      this._render();
      this.chat.clear();
      return sid;
    } catch (e) {
      this._toast(`创建会话失败: ${e.message}`, "error");
      return null;
    }
  }

  // ---- 切换 ----
  async load(sid) {
    if (!sid) return;
    this._setActive(sid);
    this._render();
    await this._refreshHistory(sid);
  }

  async _refreshHistory(sid) {
    try {
      const result = await this.rpc.call("session.get_history", { session_id: sid });
      // 没有新消息时不重渲染（保留流式内容）
      if (!result.messages || result.messages.length === 0) {
        this.chat.clear();
        return;
      }
      this.chat.renderHistory(result.messages, result.user_message_ts);
      // 推断标题：取首条 user 消息前 30 字
      const firstUser = result.messages.find((m) => m.role === "user");
      if (firstUser) {
        const text = this._extractText(firstUser.content);
        if (text) {
          this._addOrUpdate(sid, { title: text.slice(0, 30), updatedAt: this.titles.get(sid)?.updatedAt });
          this._render();
        }
      }
    } catch (e) {
      this._toast(`加载历史失败: ${e.message}`, "error");
    }
  }

  // ---- 关闭 ----
  async close(sid) {
    sid = sid || this.activeId;
    if (!sid) return;
    if (!confirm("确认关闭此会话？")) return;
    try {
      await this.rpc.call("session.close", { session_id: sid, force: true });
      this.sids.delete(sid);
      this.titles.delete(sid);
      if (this.activeId === sid) {
        this.activeId = null;
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
        this.chat.clear();
      }
      this._render();
    } catch (e) {
      this._toast(`关闭失败: ${e.message}`, "error");
    }
  }

  // ---- 压缩上下文 ----
  async compact(sid) {
    sid = sid || this.activeId;
    if (!sid) return;
    this._toast("正在压缩上下文...", "info");
    try {
      const result = await this.rpc.call("session.compact", { session_id: sid });
      const saved = result.saved_tokens || 0;
      const summary = result.summary_tokens || 0;
      this._toast(`压缩完成: 节省 ${saved.toLocaleString()} tokens (摘要 ${summary.toLocaleString()} tokens)`, "success");
    } catch (e) {
      this._toast(`压缩失败: ${e.message}`, "error");
    }
  }

  // ---- 事件钩子（外部创建的会话） ----
  handleCreated(event) {
    this._addOrUpdate(event.session_id, {
      title: "新会话",
      updatedAt: event.ts || new Date().toISOString(),
    });
    this._render();
  }

  // ---- 内部 ----
  _addOrUpdate(sid, info) {
    this.sids.add(sid);
    const prev = this.titles.get(sid) || {};
    this.titles.set(sid, { ...prev, ...info });
  }

  _setActive(sid) {
    this.activeId = sid;
    try { localStorage.setItem(STORAGE_KEY, sid); } catch (_) { /* noop */ }
  }

  _render() {
    if (!this.listEl) return;
    if (this.sids.size === 0) {
      this.listEl.innerHTML = "";
      if (this.emptyEl) {
        this.listEl.appendChild(this.emptyEl);
      }
      if (this.countEl) this.countEl.textContent = "0";
      return;
    }
    // 按 updatedAt 倒序
    const arr = Array.from(this.sids)
      .map((sid) => ({ sid, ...(this.titles.get(sid) || {}) }))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    this.listEl.innerHTML = "";
    for (const item of arr) {
      const div = document.createElement("div");
      div.className = "session-item" + (item.sid === this.activeId ? " active" : "");
      const title = item.title || `会话 ${item.sid.slice(-6)}`;
      const meta = this._formatTime(item.updatedAt);
      div.innerHTML = `
        <div class="title">${this._escape(title)}</div>
        <div class="meta">${this._escape(meta)}</div>
        <button class="compact-btn" title="压缩上下文" aria-label="压缩上下文">⚙</button>
        <button class="close-btn" title="关闭会话" aria-label="关闭会话">✕</button>
      `;
      div.onclick = (e) => {
        if (e.target.classList.contains("close-btn") || e.target.classList.contains("compact-btn")) return;
        this.load(item.sid);
      };
      const compactBtn = div.querySelector(".compact-btn");
      compactBtn.onclick = (e) => {
        e.stopPropagation();
        this.compact(item.sid);
      };
      const closeBtn = div.querySelector(".close-btn");
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.close(item.sid);
      };
      this.listEl.appendChild(div);
    }
    if (this.countEl) this.countEl.textContent = String(arr.length);
  }

  _formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return d.toLocaleDateString("zh-CN");
  }

  _extractText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b && b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
    return "";
  }

  _escape(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
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

  // ---- 自动恢复：尝试把 active session 的历史拉回来 ----
  async loadActive() {
    if (!this.activeId) return false;
    try {
      await this._refreshHistory(this.activeId);
      this._render();
      return true;
    } catch (e) {
      // active session 在新启动的 daemon 中不存在
      this.activeId = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
      return false;
    }
  }

  // ---- 刷新列表：从 server 获取所有 session ----
  async refreshList() {
    try {
      const result = await this.rpc.call("session.list", {});
      for (const s of result.sessions || []) {
        this._addOrUpdate(s.id, {
          title: s.title || "新会话",
          updatedAt: s.updated_at,
        });
      }
    } catch (e) {
      // 阶段一降级：只显示已知会话
    }
    this._render();
  }
}
