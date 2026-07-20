// web/static/js/permission.js
// 权限审批弹窗
//
// 决策字符串与 daemon 一致（参见 src/repo_claude/core/bus/commands.py）：
//   allow_once | always_allow | deny_once | always_deny

const DECISION_LABELS = {
  allow_once: "允许一次",
  always_allow: "始终允许",
  deny_once: "拒绝",
  always_deny: "始终拒绝",
};

export class Permission {
  constructor(rpc) {
    this.rpc = rpc;
    this.modalEl = document.getElementById("permission-modal");
    this.toolEl = document.getElementById("permission-tool");
    this.sessionEl = document.getElementById("permission-session");
    this.paramsEl = document.getElementById("permission-params");
    this.actionEls = this.modalEl ? this.modalEl.querySelectorAll("button[data-decision]") : [];
    this._current = null;  // { tool_use_id, session_id }
    this._onKey = this._onKey.bind(this);
  }

  // ---- 事件入口 ----
  handleEvent(event) {
    if (event.type !== "permission.requested") return;
    this.show(event);
  }

  show(req) {
    this._current = { tool_use_id: req.tool_use_id, session_id: req.session_id };
    this.toolEl.textContent = req.tool_name || "?";
    this.sessionEl.textContent = (req.session_id || "").slice(0, 16);
    // 优先用 daemon 给的 param_preview；没有则用格式化后的 params
    const preview = req.param_preview
      || (req.params ? this._formatParams(req.params) : "(no params)");
    this.paramsEl.textContent = preview;
    this.modalEl.hidden = false;
    document.addEventListener("keydown", this._onKey);
    // 聚焦到默认按钮（允许一次）
    const defaultBtn = this.modalEl.querySelector('[data-decision="allow_once"]');
    if (defaultBtn) defaultBtn.focus();
  }

  async respond(decision) {
    if (!this._current) return;
    const { tool_use_id } = this._current;
    this._hide();
    try {
      await this.rpc.call("permission.respond", { tool_use_id, decision });
    } catch (e) {
      this._toast(`权限响应失败: ${e.message}`, "error");
    } finally {
      this._current = null;
    }
  }

  _hide() {
    this.modalEl.hidden = true;
    document.removeEventListener("keydown", this._onKey);
  }

  _onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      this.respond("deny_once");
    } else if (e.key === "Enter") {
      // Enter 默认 allow_once
      e.preventDefault();
      this.respond("allow_once");
    }
  }

  _formatParams(params) {
    try {
      return JSON.stringify(params, null, 2);
    } catch (_) {
      return String(params);
    }
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
}
