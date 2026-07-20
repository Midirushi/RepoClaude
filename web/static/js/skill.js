// web/static/js/skill.js
// 斜杠命令自动补全：输入 / 时弹出技能列表，支持键盘筛选和选中。

export class SkillCompleter {
  constructor(rpc, inputEl) {
    this.rpc = rpc;
    this.inputEl = inputEl;
    this.skills = [];
    this._loaded = false;
    this._popup = null;
    this._items = [];
    this._selectedIdx = -1;
    this._query = "";

    inputEl.addEventListener("input", () => this._onInput());
    inputEl.addEventListener("keydown", (e) => this._onKeydown(e));
    document.addEventListener("click", (e) => {
      if (this._popup && !this._popup.contains(e.target) && e.target !== inputEl) {
        this.hide();
      }
    });
  }

  async loadSkills() {
    if (this._loaded) return;
    try {
      const result = await this.rpc.call("skill.list", {});
      this.skills = result.skills || [];
      this._loaded = true;
    } catch (e) {
      console.error("failed to load skills:", e);
    }
  }

  _onInput() {
    const text = this.inputEl.value;
    if (text.startsWith("/") && !text.includes(" ")) {
      this._query = text.slice(1).toLowerCase();
      this._show();
    } else {
      this.hide();
    }
  }

  _onKeydown(e) {
    if (!this._popup) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this._moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this._moveSelection(-1);
    } else if (e.key === "Tab" || (e.key === "Enter" && this._popup)) {
      if (this._selectedIdx >= 0) {
        e.preventDefault();
        this._select(this._filtered()[this._selectedIdx]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
    }
  }

  _filtered() {
    if (!this._query) return this.skills;
    return this.skills.filter(
      (s) =>
        s.name.toLowerCase().includes(this._query) ||
        (s.description || "").toLowerCase().includes(this._query),
    );
  }

  _moveSelection(delta) {
    const items = this._filtered();
    if (items.length === 0) return;
    this._selectedIdx = (this._selectedIdx + delta + items.length) % items.length;
    this._render();
  }

  _show() {
    const filtered = this._filtered();
    if (filtered.length === 0) {
      this.hide();
      return;
    }
    if (this._selectedIdx >= filtered.length) this._selectedIdx = -1;
    if (!this._popup) {
      this._popup = document.createElement("div");
      this._popup.className = "skill-popup";
      this.inputEl.parentElement.insertBefore(this._popup, this.inputEl.nextSibling);
    }
    this._render();
  }

  _render() {
    if (!this._popup) return;
    const items = this._filtered();
    this._popup.innerHTML = "";
    this._items = [];
    items.forEach((skill, i) => {
      const el = document.createElement("div");
      el.className = "skill-item" + (i === this._selectedIdx ? " selected" : "");
      const name = document.createElement("span");
      name.className = "skill-name";
      name.textContent = "/" + skill.name;
      const desc = document.createElement("span");
      desc.className = "skill-desc";
      desc.textContent = (skill.description || "").split("\n")[0].slice(0, 80);
      el.appendChild(name);
      el.appendChild(desc);
      el.onmousedown = (e) => {
        e.preventDefault();
        this._select(skill);
      };
      el.onmouseenter = () => {
        this._selectedIdx = i;
        this._render();
      };
      this._popup.appendChild(el);
      this._items.push(el);
    });
  }

  _select(skill) {
    this.inputEl.value = "/" + skill.name + " ";
    this.inputEl.focus();
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
    this.hide();
  }

  hide() {
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }
    this._selectedIdx = -1;
  }
}
