// web/static/js/trace.js
// Trace 实时查看面板：从 daemon.jsonl 读取 trace 记录并展示。

const LAYER_COLORS = {
  ipc: "#fbbf24",
  event: "#34d399",
  llm: "#a78bfa",
};

const DIRECTION_LABELS = {
  "CLIENT→CORE": "→CORE",
  "CORE→CLIENT": "CORE→",
  "CORE": "CORE",
  "CORE→LLM": "→LLM",
  "LLM→CORE": "LLM→",
};

export class TracePanel {
  constructor(rpc) {
    this.rpc = rpc;
    this.panelEl = document.getElementById("trace-panel");
    this.listEl = document.getElementById("trace-list");
    this.filterEl = document.getElementById("trace-filter");
    this.visible = false;
    this._timer = null;
    this._filter = "all";
    this._maxLines = 200;

    if (this.filterEl) {
      this.filterEl.onchange = () => {
        this._filter = this.filterEl.value;
        this.refresh();
      };
    }

    const closeBtn = document.getElementById("trace-close");
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
    }

    const clearBtn = document.getElementById("trace-clear");
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (this.listEl) this.listEl.innerHTML = "";
      };
    }
  }

  show() {
    if (!this.panelEl) return;
    this.panelEl.classList.add("open");
    this.visible = true;
    this.refresh();
    this._startPolling();
  }

  hide() {
    if (!this.panelEl) return;
    this.panelEl.classList.remove("open");
    this.visible = false;
    this._stopPolling();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  _startPolling() {
    this._stopPolling();
    this._timer = setInterval(() => this.refresh(), 2000);
  }

  _stopPolling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async refresh() {
    if (!this.visible || !this.rpc.ws || this.rpc.ws.readyState !== WebSocket.OPEN) return;
    try {
      const params = { lines: this._maxLines };
      if (this._filter !== "all") {
        params.layer = this._filter;
      }
      const result = await this.rpc.call("trace.read", params);
      this._render(result.records || []);
    } catch (e) {
      // 静默失败
    }
  }

  _render(records) {
    if (!this.listEl) return;
    this.listEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const rec of records) {
      const row = document.createElement("div");
      row.className = "trace-row";

      const ts = document.createElement("span");
      ts.className = "trace-ts";
      ts.textContent = this._formatTs(rec.ts);

      const layer = document.createElement("span");
      layer.className = "trace-layer";
      layer.textContent = rec.layer || "?";
      layer.style.color = LAYER_COLORS[rec.layer] || "var(--text-tertiary)";

      const dir = document.createElement("span");
      dir.className = "trace-dir";
      dir.textContent = DIRECTION_LABELS[rec.direction] || rec.direction || "";

      const kind = document.createElement("span");
      kind.className = "trace-kind";
      kind.textContent = rec.kind || "";

      const summary = document.createElement("span");
      summary.className = "trace-summary";
      summary.textContent = this._summarize(rec);

      row.appendChild(ts);
      row.appendChild(layer);
      row.appendChild(dir);
      row.appendChild(kind);
      row.appendChild(summary);
      frag.appendChild(row);
    }
    this.listEl.appendChild(frag);
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  _summarize(rec) {
    const data = rec.data || {};
    const kind = rec.kind || "";
    if (kind === "command") return `${data.method || ""} (${data.id || ""})`;
    if (kind === "response") return `id=${data.id || ""}`;
    if (kind === "error") return `id=${data.id || ""} ${data.error?.message || ""}`;
    if (kind === "push") return `${data.event_type || ""} → ${data.sub_id || ""}`;
    if (kind === "event") return data.type || "";
    if (kind === "api_call") {
      const model = data.model || "";
      const msgCount = data.message_count ?? data.messages?.length ?? 0;
      return `${model} (${msgCount} msgs)`;
    }
    if (kind === "api_response") {
      const usage = data.usage;
      const latency = data.latency_ms != null ? `${data.latency_ms}ms` : "";
      const tokens = usage ? `${(usage.input_tokens || 0) + (usage.output_tokens || 0)} tok` : "";
      return `${data.stop_reason || ""} ${latency} ${tokens}`.trim();
    }
    return JSON.stringify(data).slice(0, 80);
  }

  _formatTs(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.slice(11, 19);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
}
