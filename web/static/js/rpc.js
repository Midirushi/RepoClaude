// web/static/js/rpc.js
// RepoClaude 前端 JSON-RPC 2.0 over WebSocket 客户端
//
// 协议约定（与 daemon 一致）：
// - 请求：{ jsonrpc: "2.0", id, method, params }
// - 响应：{ jsonrpc: "2.0", id, result | error }
// - 服务端推送：{ kind: "event", event: { type, ... } }
//
// 错误码参考 src/repo_claude/core/bus/envelope.py：
//   -32700 PARSE_ERROR / -32600 INVALID_REQUEST / -32601 METHOD_NOT_FOUND
//   -32602 INVALID_PARAMS / -32603 INTERNAL_ERROR
//   -32010 SESSION_NOT_FOUND / -32011 SESSION_CLOSED / -32012 SESSION_BUSY

const BRIDGE_URL = "ws://127.0.0.1:8437";

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class RepoRpc {
  constructor() {
    this.ws = null;
    this.pending = new Map();        // id -> { resolve, reject, method }
    this.eventHandlers = new Set();
    this.stateHandlers = new Set();   // 状态：connecting/connected/error/closed
    this.state = "idle";              // idle | connecting | connected | error | closed
    this.shouldReconnect = false;
    this._reconnectTimer = null;
  }

  // ---- 状态订阅 ----
  onStateChange(handler) {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateHandlers.forEach((h) => {
      try { h(state); } catch (e) { console.error(e); }
    });
  }

  // ---- 连接 ----
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    this.shouldReconnect = true;
    return this._doConnect();
  }

  _doConnect() {
    return new Promise((resolve, reject) => {
      this._setState("connecting");
      let ws;
      try {
        ws = new WebSocket(BRIDGE_URL);
      } catch (e) {
        this._setState("error");
        reject(e);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this._setState("connected");
        resolve();
      };
      ws.onerror = () => {
        // onerror 之后通常会触发 onclose；这里不 resolve/reject，留给 onclose
      };
      ws.onmessage = (e) => this._dispatch(e.data);
      ws.onclose = () => {
        this._setState("closed");
        // 拒绝所有 pending 请求
        for (const { reject, method } of this.pending.values()) {
          reject(new RpcError(-1, `WebSocket closed while waiting for ${method}`));
        }
        this.pending.clear();
        if (this.shouldReconnect) {
          this._scheduleReconnect();
        }
      };
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doConnect().catch(() => { /* ignore; will retry on next error */ });
    }, 2000);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* noop */ }
    }
  }

  // ---- RPC 调用 ----
  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RpcError(-1, "WebSocket not connected"));
    }
    const id = this._genId();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.ws.send(payload);
      } catch (e) {
        this.pending.delete(id);
        reject(new RpcError(-1, `send failed: ${e.message}`));
      }
    });
  }

  // ---- 事件订阅 ----
  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  // ---- 消息分发 ----
  _dispatch(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error("invalid JSON from bridge:", raw);
      return;
    }
    // RPC 响应
    if (msg && "jsonrpc" in msg) {
      const id = msg.id;
      if (id != null && this.pending.has(id)) {
        const { resolve, reject, method } = this.pending.get(id);
        this.pending.delete(id);
        if (msg.error) {
          reject(new RpcError(msg.error.code, msg.error.message || `${method} failed`, msg.error.data));
        } else {
          resolve(msg.result ?? {});
        }
      }
      return;
    }
    // 服务端推送事件
    if (msg && msg.kind === "event" && msg.event) {
      this.eventHandlers.forEach((h) => {
        try { h(msg.event); } catch (e) { console.error("event handler error:", e); }
      });
    }
  }

  _genId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
