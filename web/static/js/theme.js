// web/static/js/theme.js
// 双主题切换：light / dark，偏好持久化到 localStorage

const STORAGE_KEY = "repo-claude-theme";

export class Theme {
  constructor() {
    this.current = "light";
  }

  init() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* localStorage 不可用 */ }
    if (saved !== "light" && saved !== "dark") {
      saved = (typeof window !== "undefined"
        && window.matchMedia
        && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    this.apply(saved);
  }

  toggle() {
    const next = this.current === "light" ? "dark" : "light";
    this.apply(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* noop */ }
    return next;
  }

  apply(theme) {
    this.current = theme;
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "light" ? "☀" : "🌙";
  }
}
