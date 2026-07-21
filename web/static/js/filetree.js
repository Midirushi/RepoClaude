// web/static/js/filetree.js
// 工作区文件浏览树：懒加载目录、点击文件触发 onOpenFile 回调。

const FILE_ICONS = {
  py: "🐍",
  js: "📜",
  ts: "📘",
  jsx: "⚛",
  tsx: "⚛",
  json: "📋",
  md: "📝",
  txt: "📄",
  html: "🌐",
  css: "🎨",
  yml: "⚙",
  yaml: "⚙",
  toml: "⚙",
  ini: "⚙",
  sh: "💻",
  bash: "💻",
  zsh: "💻",
  go: "🐹",
  rs: "🦀",
  java: "☕",
  c: "🔧",
  cpp: "🔧",
  h: "🔧",
  sql: "🗄",
};

const IGNORED_DIRS = new Set([
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  ".idea",
  ".vscode",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  ".cache",
]);

const IGNORED_FILE_SUFFIXES = [".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe"];

function getFileIcon(name) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] || "📄";
}

function shouldIgnore(name, isDir) {
  if (isDir) return IGNORED_DIRS.has(name);
  return IGNORED_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export class FileTree {
  constructor(rpc, rootEl, onOpenFile) {
    this.rpc = rpc;
    this.rootEl = rootEl;
    this.onOpenFile = onOpenFile || (() => {});
    this._loadedDirs = new Set();
    this._loadingDirs = new Set();
  }

  async init() {
    this.rootEl.innerHTML = "";
    const rootRow = this._renderDirRow(".", "工作区", 0);
    this.rootEl.appendChild(rootRow);
    const childrenEl = this._ensureChildrenContainer(rootRow, 0);
    await this._expandDir(".", childrenEl, 0);
  }

  _renderDirRow(path, label, depth) {
    const row = document.createElement("div");
    row.className = "tree-row tree-dir collapsed";
    row.dataset.path = path;
    row.style.paddingLeft = `${depth * 14 + 8}px`;
    row.innerHTML = `
      <span class="tree-arrow">▶</span>
      <span class="tree-icon">📁</span>
      <span class="tree-name">${this._escape(label)}</span>
    `;
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      const childrenEl = this._ensureChildrenContainer(row, depth);
      if (row.classList.contains("collapsed")) {
        row.classList.remove("collapsed");
        row.classList.add("expanded");
        row.querySelector(".tree-arrow").textContent = "▼";
        await this._expandDir(path, childrenEl, depth);
      } else {
        row.classList.add("collapsed");
        row.classList.remove("expanded");
        row.querySelector(".tree-arrow").textContent = "▶";
        childrenEl.style.display = "none";
      }
    });
    return row;
  }

  _ensureChildrenContainer(parentRow, depth) {
    let next = parentRow.nextElementSibling;
    let container = next?.classList?.contains("tree-children") ? next : null;
    if (!container) {
      container = document.createElement("div");
      container.className = "tree-children";
      container.dataset.depth = depth;
      parentRow.after(container);
    } else {
      container.style.display = "";
    }
    return container;
  }

  async _expandDir(path, container, depth) {
    if (this._loadedDirs.has(path)) {
      container.style.display = "";
      return;
    }
    if (this._loadingDirs.has(path)) return;
    this._loadingDirs.add(path);
    container.innerHTML = `<div class="tree-loading" style="padding-left:${depth * 14 + 22}px">加载中...</div>`;
    try {
      const result = await this.rpc.call("fs.list_dir", { path });
      container.innerHTML = "";
      const childDepth = depth + 1;
      for (const entry of result.entries || []) {
        if (shouldIgnore(entry.name, entry.is_dir)) continue;
        if (entry.is_dir) {
          container.appendChild(this._renderDirRow(entry.path, entry.name, childDepth));
        } else {
          container.appendChild(this._renderFileRow(entry, childDepth));
        }
      }
      if (container.children.length === 0) {
        container.innerHTML = `<div class="tree-empty" style="padding-left:${childDepth * 14 + 22}px">空目录</div>`;
      }
      this._loadedDirs.add(path);
    } catch (e) {
      container.innerHTML = `<div class="tree-error" style="padding-left:${depth * 14 + 22}px">❌ ${this._escape(e.message)}</div>`;
    } finally {
      this._loadingDirs.delete(path);
    }
  }

  _renderFileRow(entry, depth) {
    const row = document.createElement("div");
    row.className = "tree-row tree-file";
    row.dataset.path = entry.path;
    row.style.paddingLeft = `${depth * 14 + 22}px`;
    const sizeText = entry.size > 0 ? formatSize(entry.size) : "";
    row.innerHTML = `
      <span class="tree-icon">${getFileIcon(entry.name)}</span>
      <span class="tree-name">${this._escape(entry.name)}</span>
      <span class="tree-meta">${sizeText}</span>
    `;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.rootEl.querySelectorAll(".tree-file.selected").forEach((el) => el.classList.remove("selected"));
      row.classList.add("selected");
      this.onOpenFile(entry.path, entry);
    });
    return row;
  }

  refresh() {
    this._loadedDirs.clear();
    this._loadingDirs.clear();
    return this.init();
  }

  _escape(s) {
    const div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }
}
