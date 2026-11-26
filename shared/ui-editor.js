// Create / edit a prompt: title, folder, tags, text with #variables#, defaults per variable.
// Keys: Ctrl/⌘ + ↵ save · esc cancel · ↵ adds a tag
// Events: onSave(data) -> Promise, onCancel(), onDelete(id) -> Promise
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.Editor) return;
  const h = PM.h;
  const k = (t) => h('span', { class: 'pm-k' }, t);
  let seq = 0;

  class Editor {
    constructor(o) {
      this.o = o;
      const p = o.prompt || {};
      const pre = o.preset || {};
      this.isNew = !p.id;
      this.data = {
        id: p.id || null,
        title: p.title || pre.title || '',
        text: p.text || '',
        folder: PM.normFolder(p.folder || pre.folder || ''),
        tags: (p.tags || pre.tags || []).slice(),
        defaults: Object.assign({}, p.defaults || {})
      };
      this.tagCounts = {};
      (o.prompts || []).forEach((x) => (x.tags || []).forEach((t) => (this.tagCounts[t] = (this.tagCounts[t] || 0) + 1)));
      this.folders = PM.folderIndex ? PM.folderIndex(o.prompts || []).map((f) => PM.folderLabel(f.id)) : [];
      this.confirmDelete = false;
      this.saving = false;
      this.build();
      this.renderTags();
      this.renderVars();
      this.syncBack();
    }

    build() {
      const n = ++seq;
      const ids = { title: 'pm-ed-title-' + n, folder: 'pm-ed-folder-' + n, tags: 'pm-ed-tags-' + n, text: 'pm-ed-text-' + n, list: 'pm-ed-folders-' + n };

      this.titleInput = h('input', { class: 'pm-input pm-ed-input', id: ids.title, type: 'text', value: this.data.title, placeholder: 'e.g. Code review', autocomplete: 'off' });
      this.titleInput.addEventListener('input', () => (this.data.title = this.titleInput.value));

      this.folderInput = h('input', { class: 'pm-input pm-ed-input', id: ids.folder, type: 'text', value: PM.folderLabel(this.data.folder), placeholder: 'No folder', list: ids.list, autocomplete: 'off' });
      this.folderInput.addEventListener('input', () => (this.data.folder = PM.normFolder(this.folderInput.value)));
      const datalist = h('datalist', { id: ids.list }, this.folders.map((f) => h('option', { value: f })));

      this.tagInput = h('input', { id: ids.tags, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Add a tag' });
      this.tagInput.addEventListener('input', () => this.renderGhost());
      // Faded completion of the most used matching tag; ↵ adds it.
      this.ghostTyped = h('span', { class: 'pm-ghost-typed' });
      this.ghostRest = h('span', { class: 'pm-ghost-rest' });
      this.tagGhost = h('span', { class: 'pm-ghost', 'aria-hidden': 'true' }, this.ghostTyped, this.ghostRest);
      this.tagChips = h('span', { class: 'pm-tagchips' });
      this.tagBox = h('div', { class: 'pm-tags', onclick: (e) => { if (e.target === this.tagBox || e.target === this.tagChips) this.tagInput.focus(); } },
        this.tagChips, h('span', { class: 'pm-tag-wrap' }, this.tagGhost, this.tagInput));

      this.ta = h('textarea', { class: 'pm-ta', id: ids.text, rows: 6, spellcheck: 'true', placeholder: 'Write the prompt. Use #name# for a value you fill in each time, or #name:a|b|c# for fixed choices.' });
      this.ta.value = this.data.text;
      this.back = h('div', { class: 'pm-ta-back', 'aria-hidden': 'true' });
      this.ta.addEventListener('input', () => {
        this.data.text = this.ta.value;
        this.syncBack();
        this.renderVars();
      });
      this.ta.addEventListener('scroll', () => (this.back.scrollTop = this.ta.scrollTop));

      this.varsBox = h('div');
      this.err = h('div', { class: 'pm-err', role: 'alert', hidden: true });

      this.saveBtn = h('button', { type: 'button', class: 'pm-btn is-primary', onclick: () => this.save() }, 'Save prompt', k(PM.isMac ? '⌘↵' : 'Ctrl ↵'));
      this.deleteBtn = this.isNew ? null : h('button', { type: 'button', class: 'pm-btn is-danger', onclick: () => this.del() }, PM.icon('trash', 15), 'Delete');

      this.panel = h('div', { class: 'pm-panel pm-editor', role: 'dialog', tabIndex: -1, 'aria-modal': 'true', 'aria-label': this.isNew ? 'New prompt' : 'Edit prompt' },
        h('div', { class: 'pm-ed-head' },
          h('span', { class: 'pm-logo' }, '#'),
          h('span', { class: 'pm-crumb' }, 'Prolly /'),
          h('span', { class: 'pm-ed-title' }, this.isNew ? 'New prompt' : 'Edit prompt'),
          h('span', { class: 'pm-push pm-kbd-chip' }, 'esc')),
        h('div', { class: 'pm-ed-body' },
          h('div', { class: 'pm-fl' }, h('label', { class: 'pm-lbl', for: ids.title }, 'Title'), this.titleInput),
          h('div', { class: 'pm-grid2' },
            h('div', { class: 'pm-fl' },
              h('label', { class: 'pm-lbl', for: ids.folder }, 'Folder'),
              h('div', { class: 'pm-iconfield' }, this.folderInput, PM.icon('folder', 16), datalist)),
            h('div', { class: 'pm-fl' },
              h('label', { class: 'pm-lbl', for: ids.tags }, 'Tags'),
              this.tagBox)),
          h('div', { class: 'pm-fl' },
            h('div', { class: 'pm-labelrow' },
              h('label', { class: 'pm-lbl', for: ids.text }, 'Prompt'),
              h('span', { class: 'pm-syntax' }, 'Free text ', h('span', { class: 'pm-code' }, '#name#'), '  ·  Fixed choices ', h('span', { class: 'pm-code' }, '#name:a|b|c#'))),
            h('div', { class: 'pm-ta-wrap' }, this.back, this.ta)),
          this.varsBox,
          this.err),
        h('div', { class: 'pm-ed-foot' },
          h('span', { class: 'pm-help' }, k('tab'), ' next field'),
          this.deleteBtn,
          h('span', { style: { flex: '1' } }),
          h('button', { type: 'button', class: 'pm-btn', onclick: () => this.cancel() }, 'Cancel'),
          this.saveBtn));

      this.el = h('div', { class: 'pm-backdrop', tabIndex: -1 }, this.panel);
      if (this.o.ownKeys) this.el.addEventListener('keydown', (e) => this.handleKey(e));
    }

    focus() {
      const target = this.isNew && this.data.title ? this.ta : this.titleInput;
      target.focus({ preventScroll: true });
      if (target === this.ta) this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);
      this.autosize();
    }

    // ---- Tags ----
    suggestion() {
      const q = PM.normTag(this.tagInput.value);
      if (!q) return null;
      return Object.keys(this.tagCounts)
        .filter((t) => t.indexOf(q) === 0 && t !== q && this.data.tags.indexOf(t) < 0)
        .sort((a, b) => this.tagCounts[b] - this.tagCounts[a] || a.localeCompare(b))[0] || null;
    }
    addTag(t) {
      t = PM.normTag(t);
      if (t && this.data.tags.indexOf(t) < 0) this.data.tags.push(t);
      this.renderTags();
    }
    renderTags() {
      this.tagChips.replaceChildren(
        ...this.data.tags.map((t) =>
          h('span', { class: 'pm-tagchip' }, t,
            h('button', {
              type: 'button', 'aria-label': 'Remove tag ' + t, tabIndex: -1,
              onclick: () => {
                this.data.tags = this.data.tags.filter((x) => x !== t);
                this.renderTags();
                this.tagInput.focus();
              }
            }, '×'))));
      this.renderGhost();
    }
    renderGhost() {
      const raw = this.tagInput.value;
      const s = this.suggestion();
      const typed = raw.replace(/^\s*#*/, '').toLowerCase();
      const show = s && typed && s.indexOf(typed) === 0;
      this.ghostTyped.textContent = show ? raw : '';
      this.ghostRest.textContent = show ? s.slice(typed.length) : '';
      this.tagInput.setAttribute('aria-description', show ? 'Enter adds ' + s : '');
    }

    // ---- Text + variables ----
    syncBack() {
      this.back.replaceChildren(
        ...PM.tpl.segments(this.data.text).map((s) => (s.text != null ? document.createTextNode(s.text) : h('mark', null, s.raw))),
        document.createTextNode('\n'));
      this.autosize();
    }
    autosize() {
      this.ta.style.height = 'auto';
      this.ta.style.height = Math.min(Math.max(this.ta.scrollHeight + 2, 150), 340) + 'px';
      this.back.scrollTop = this.ta.scrollTop;
    }

    renderVars() {
      const defs = PM.tpl.parse(this.data.text).defs;
      if (!defs.length) {
        this.varsBox.replaceChildren(h('div', { class: 'pm-novars' }, 'No variables yet. Write ', h('span', { class: 'pm-code' }, '#name#'), ' in the prompt and it will show up here.'));
        return;
      }
      const rows = defs.map((d) => {
        let cell;
        if (d.options) {
          const cur = d.options.indexOf(this.data.defaults[d.name]) >= 0 ? this.data.defaults[d.name] : d.options[0];
          const chips = d.options.map((opt) =>
            h('button', {
              type: 'button', class: 'pm-choice' + (opt === cur ? ' is-on' : ''), 'aria-pressed': String(opt === cur), title: 'Make this the default',
              onclick: () => {
                this.data.defaults[d.name] = opt;
                this.renderVars();
              }
            }, opt));
          const add = h('button', { type: 'button', class: 'pm-choice is-add', onclick: () => this.startAddChoice(d, add) }, '+ add');
          cell = h('span', { class: 'pm-choices' }, chips, add);
        } else {
          const inp = h('input', { class: 'pm-input pm-sm-input', type: 'text', 'aria-label': 'Default for ' + d.name, value: this.data.defaults[d.name] || '', placeholder: 'No default' });
          inp.addEventListener('input', () => (this.data.defaults[d.name] = inp.value));
          cell = inp;
        }
        return h('div', { class: 'pm-vrow' },
          h('span', { class: 'pm-vname', title: '#' + d.name + '#' }, '#' + d.name + '#'),
          h('span', { class: 'pm-vmeta' }, d.uses + '×'),
          h('span', { class: 'pm-vmeta' }, d.options ? 'Choice' : 'Text'),
          cell);
      });
      this.varsBox.replaceChildren(
        h('div', { class: 'pm-fl', style: { gap: '8px' } },
          h('div', { class: 'pm-labelrow' },
            h('span', { class: 'pm-lbl' }, 'Variables · detected automatically'),
            h('span', { class: 'pm-syntax' }, 'The first choice is picked by default')),
          h('div', { class: 'pm-vtable' },
            h('div', { class: 'pm-vrow is-head' }, h('span', null, 'Name'), h('span', null, 'Used'), h('span', null, 'Type'), h('span', null, 'Default / choices')),
            rows)));
    }

    startAddChoice(d, addBtn) {
      const inp = h('input', { class: 'pm-input pm-choice-input', type: 'text', 'aria-label': 'New choice for ' + d.name, placeholder: 'New choice' });
      this.choiceCtx = { d, inp };
      addBtn.replaceWith(inp);
      inp.focus();
      inp.addEventListener('blur', () => setTimeout(() => this.commitChoice(), 0));
    }
    commitChoice() {
      const c = this.choiceCtx;
      if (!c) return;
      this.choiceCtx = null;
      const v = c.inp.value.replace(/[#|\n]/g, '').trim();
      if (v && c.d.options.indexOf(v) < 0) {
        this.data.text = PM.tpl.setChoices(this.data.text, c.d.name, c.d.options.concat(v));
        this.ta.value = this.data.text;
        this.syncBack();
      }
      this.renderVars();
    }

    // ---- Actions ----
    showError(msg) {
      this.err.textContent = msg || '';
      this.err.hidden = !msg;
    }

    collect() {
      const text = this.ta.value;
      const defs = PM.tpl.parse(text).defs;
      const defaults = {};
      defs.forEach((d) => {
        const v = this.data.defaults[d.name];
        if (typeof v !== 'string' || !v) return;
        if (d.options && d.options.indexOf(v) < 0) return;
        if (d.options && v === d.options[0]) return;
        defaults[d.name] = v;
      });
      let title = this.titleInput.value.trim();
      if (!title) title = PM.tpl.plain(text).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
      if (this.tagInput.value.trim()) this.addTag(this.tagInput.value);
      return { id: this.data.id || undefined, title, text, folder: PM.normFolder(this.folderInput.value), tags: this.data.tags.slice(), defaults };
    }

    async save() {
      if (this.saving) return;
      if (!this.ta.value.trim()) {
        this.showError('Write the prompt first.');
        this.ta.focus();
        return;
      }
      this.saving = true;
      this.saveBtn.disabled = true;
      this.showError('');
      try {
        await this.o.onSave(this.collect());
      } catch (e) {
        this.showError((e && e.message) || 'Could not save the prompt.');
      } finally {
        this.saving = false;
        this.saveBtn.disabled = false;
      }
    }

    async del() {
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        this.deleteBtn.replaceChildren(PM.icon('trash', 15), 'Click again to delete');
        return;
      }
      try {
        await this.o.onDelete(this.data.id);
      } catch (e) {
        this.showError((e && e.message) || 'Could not delete the prompt.');
      }
    }

    cancel() {
      if (this.o.onCancel) this.o.onCancel();
    }

    handleKey(e) {
      if (e.isComposing) return false;
      const a = this.el.getRootNode().activeElement;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        this.save();
      } else if (e.key === 'Escape') {
        if (this.choiceCtx && a === this.choiceCtx.inp) {
          this.choiceCtx.inp.value = '';
          this.ta.focus();
        } else this.cancel();
      } else if (a === this.tagInput && e.key === 'Enter') {
        const s = this.suggestion();
        if (s || this.tagInput.value.trim()) {
          this.addTag(s || this.tagInput.value);
          this.tagInput.value = '';
          this.renderGhost();
        }
      } else if (a === this.tagInput && e.key === 'Backspace' && !this.tagInput.value && this.data.tags.length) {
        this.data.tags.pop();
        this.renderTags();
        this.tagInput.focus();
      } else if (this.choiceCtx && a === this.choiceCtx.inp && e.key === 'Enter') {
        this.ta.focus();
      } else if ((a === this.titleInput || a === this.folderInput) && e.key === 'Enter') {
        (a === this.titleInput ? this.folderInput : this.tagInput).focus();
      } else if (e.key === 'Tab') {
        const f = [...this.panel.querySelectorAll('input, textarea, button')].filter((x) => !x.disabled && x.offsetParent !== null);
        const i = f.indexOf(a);
        if (!e.shiftKey && i === f.length - 1) f[0].focus();
        else if (e.shiftKey && i <= 0) f[f.length - 1].focus();
        else return false;
      } else return false;
      e.preventDefault();
      return true;
    }
  }

  PM.Editor = Editor;
})();
