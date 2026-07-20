// web/static/js/app.js
// 主入口：组装 RPC、Chat、Session、Permission、Theme，并绑定 DOM 事件。

import { RepoRpc } from "./rpc.js";
import { Theme } from "./theme.js";
import { Session } from "./session.js";
import { Chat } from "./chat.js";
import { Permission } from "./permission.js";
import { SkillCompleter } from "./skill.js";

const rpc = new RepoRpc();
const theme = new Theme();
const chat = new Chat(rpc, null);   // 先给 null，session 构造完后再注入
const session = new Session(rpc, chat);
const permission = new Permission(rpc);
chat.session = session;

theme.init();

// ---- 状态条 ----
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const statusVersion = document.getElementById("status-version");

function setStatusUi(state) {
  statusEl.classList.remove("connected", "error", "connecting");
  if (state === "connected") {
    statusEl.classList.add("connected");
    statusLabel.textContent = "已连接";
  } else if (state === "connecting") {
    statusEl.classList.add("connecting");
    statusLabel.textContent = "连接中...";
  } else if (state === "error") {
    statusEl.classList.add("error");
    statusLabel.textContent = "连接失败";
  } else {
    statusLabel.textContent = "未连接";
  }
}

rpc.onStateChange(setStatusUi);

// ---- toast ----
function toast(text, kind) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.className = "toast" + (kind ? ` ${kind}` : "");
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ---- 事件路由 ----
rpc.onEvent((event) => {
  const t = event.type || "";
  if (t === "session.created") {
    session.handleCreated(event);
  }
  chat.handleEvent(event);
  if (t.startsWith("permission.")) {
    permission.handleEvent(event);
  }
});

// ---- DOM 事件绑定 ----
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const skillCompleter = new SkillCompleter(rpc, inputEl);

sendBtn.onclick = () => {
  skillCompleter.hide();
  chat.send();
};

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !skillCompleter._popup) {
    e.preventDefault();
    skillCompleter.hide();
    chat.send();
  }
});

// 输入框自动撑高
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
});

document.getElementById("theme-toggle").onclick = () => theme.toggle();
document.getElementById("new-session-top").onclick = () => session.create();
document.getElementById("new-session-btn").onclick = () => session.create();

// 侧栏（窄屏）
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
if (sidebarToggle) {
  sidebarToggle.onclick = () => sidebar.classList.toggle("open");
}

// ---- 事件订阅 ----
async function subscribeEvents() {
  await rpc.call("event.subscribe", {
    topics: [
      "session.*",
      "run.*",
      "step.*",
      "tool.*",
      "llm.*",
      "permission.*",
      "subagent.*",
      "skill.*",
      "context.*",
      "log.*",
    ],
    scope: "global",
  });
}

// ---- 重连后恢复订阅 ----
rpc.onReconnect(async () => {
  try {
    await subscribeEvents();
    console.log("event subscription restored after reconnect");
  } catch (e) {
    console.error("failed to restore event subscription:", e);
  }
});

// ---- 主流程 ----
async function bootstrap() {
  session.init();
  try {
    await rpc.connect();
  } catch (e) {
    toast(`无法连接 bridge: ${e.message}`, "error");
    return;
  }

  try {
    // 1. ping 拿版本号
    const pong = await rpc.call("core.ping", { client: "web-frontend-mvp" });
    if (pong && pong.server_version) {
      statusVersion.textContent = `v${pong.server_version}`;
    }
  } catch (e) {
    toast(`ping 失败: ${e.message}`, "error");
  }

  try {
    // 2. 全局事件订阅
    await subscribeEvents();
  } catch (e) {
    toast(`事件订阅失败: ${e.message}`, "error");
  }

  // 3. 加载技能列表（用于斜杠命令补全）
  skillCompleter.loadSkills();

  // 4. 恢复上次 active session（如果 daemon 还在）
  const restored = await session.loadActive();
  if (!restored) {
    // 没有 active 或服务端已不记得，提示用户新建
    document.getElementById("welcome").style.display = "block";
  } else {
    document.getElementById("welcome").style.display = "none";
  }

  // 5. 焦点
  inputEl.focus();
}

bootstrap();

// 暴露给 console 方便调试
window.repo = { rpc, session, chat, permission, theme, toast, skillCompleter };
