// The variable bar: one field per #variable#, shown above the site's text box.
// Keys: tab next · ↵ next / done · esc keep as is · ← → change a choice
// Events: onChange(text) after each edit, onDone(text)
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.FillBar) return;
  const h = PM.h;
  const k = (t) => h('span', { class: 'pm-k' }, t);
  let seq = 0;

  class FillBar {
    constructor(o) {
      this.o = o;
      const p = o.prompt;
      this.defs = PM.tpl.parse(p.text).defs;
      this.values = {};
      const defaults = p.defaults || {};
      this.defs.forEach((d) => {
        const dv = defaults[d.name];
        this.values[d.name] = d.options ? (d.options.indexOf(dv) >= 0 ? dv : d.options[0]) : typeof dv === 'string' ? dv : '';
      });
      this.active = this.defs.length ? this.defs[0].name : null;
      this.finished = false;
      this.build();
      this.update();
    }

    build() {
      const p = this.o.prompt;
      this.countEl = h('span');
      const head = h('div', { class: 'pm-fill-head' },
        h('span', { class: 'pm-badge' }, '#'),
        h('span', { class: 'pm-fill-title' }, p.title || 'Prompt'),
        this.countEl,
        h('span', { class: 'pm-push' }, k('tab'), ' next  ·  ', k('↵'), ' done  ·  ', k('esc'), ' keep as is'));
      this.fields = {};
      const grid = h('div', { class: 'pm-fill-grid' }, this.defs.map((d) => this.fieldEl(d)));
      this.previewEl = this.o.showPreview ? h('div', { class: 'pm-preview', 'aria-label': 'Preview of the prompt' }) : null;
      this.el = h('div', { class: 'pm-panel pm-fill', role: 'group', tabIndex: -1, 'aria-label': 'Fill prompt variables' }, head, grid, this.previewEl);
      this.el.addEventListener('focusin', (e) => {
        const n = e.target && e.target.closest && e.target.closest('[data-var]');
        if (n && n.getAttribute('data-var') !== this.active) {
          this.active = n.getAttribute('data-var');
          this.update();
        }
      });
      if (this.o.ownKeys) this.el.addEventListener('keydown', (e) => this.handleKey(e));
    }

    fieldEl(d) {
      const id = 'pm-var-' + ++seq;
      let ctl;
      if (d.options) {
        const btns = d.options.map((opt, j) =>
          h('button', {
            type: 'button', role: 'radio', 'data-var': d.name, id: j === 0 ? id : null,
            onclick: () => {
              this.set(d.name, opt);
              btns[j].focus();
            }
          }, opt));
        ctl = h('div', { class: 'pm-seg', role: 'radiogroup', 'aria-label': d.name }, btns);
        this.fields[d.name] = {
          kind: 'choice', btns,
          focus: () => btns[Math.max(0, d.options.indexOf(this.values[d.name]))].focus({ preventScroll: true })
        };
      } else {
        ctl = h('input', { class: 'pm-input', type: 'text', id, value: this.values[d.name], 'data-var': d.name, autocomplete: 'off', spellcheck: 'false', placeholder: d.name.replace(/_/g, ' ') });
        ctl.addEventListener('input', () => this.set(d.name, ctl.value));
        this.fields[d.name] = {
          kind: 'text', input: ctl,
          focus: () => {
            ctl.focus({ preventScroll: true });
            ctl.select();
          }
        };
      }
      const label = h('label', { class: 'pm-field-label', for: d.options ? null : id },
        '#' + d.name + '#',
        d.uses > 1 ? h('span', { class: 'pm-faint' }, '×' + d.uses) : null,
        d.options ? h('span', { class: 'pm-faint pm-push' }, '← → choose') : null);
      const wide = d.options && d.options.join('').length > 22 && this.defs.length > 1;
      return h('div', { class: 'pm-field' + (wide ? ' is-wide' : ''), 'data-var': d.name }, label, ctl);
    }

    text() {
      return PM.tpl.render(this.o.prompt.text, this.values);
    }

    set(name, v) {
      this.values[name] = v;
      this.active = name;
      this.update();
      if (this.o.onChange) this.o.onChange(this.text());
    }

    update() {
      const filled = this.defs.filter((d) => !!this.values[d.name]).length;
      this.countEl.textContent = '· ' + filled + ' of ' + this.defs.length + ' filled';
      this.defs.forEach((d) => {
        const f = this.fields[d.name];
        if (f.kind !== 'choice') return;
        f.btns.forEach((b, j) => {
          const on = d.options[j] === this.values[d.name];
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        });
      });
      if (this.previewEl) {
        this.previewEl.replaceChildren(
          ...PM.tpl.segments(this.o.prompt.text).map((s) => {
            if (s.text != null) return document.createTextNode(s.text);
            const v = this.values[s.name];
            const act = s.name === this.active ? ' is-active' : '';
            return v ? h('span', { class: 'pm-hl' + act }, v) : h('span', { class: 'pm-hl-empty' + act }, '#' + s.name + '#');
          }));
      }
    }

    focusField(i) {
      const d = this.defs[i];
      if (d) this.fields[d.name].focus();
    }
    focusFirst() {
      this.focusField(0);
    }

    currentIndex() {
      const a = this.el.getRootNode().activeElement;
      const n = a && a.closest && a.closest('[data-var]');
      return n ? this.defs.findIndex((d) => d.name === n.getAttribute('data-var')) : -1;
    }

    handleKey(e) {
      if (e.isComposing) return false;
      const i = this.currentIndex();
      const d = this.defs[i];
      const f = d && this.fields[d.name];
      if (e.key === 'Enter' && !e.shiftKey) {
        if (i >= 0 && i < this.defs.length - 1) this.focusField(i + 1);
        else this.done();
      } else if (e.key === 'Escape') {
        this.done();
      } else if (e.key === 'Tab') {
        const n = this.defs.length;
        this.focusField(i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + n) % n);
      } else if (f && f.kind === 'choice' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const cur = Math.max(0, d.options.indexOf(this.values[d.name]));
        const nx = (cur + step + d.options.length) % d.options.length;
        this.set(d.name, d.options[nx]);
        f.btns[nx].focus();
      } else return false;
      e.preventDefault();
      return true;
    }

    done() {
      if (this.finished) return;
      this.finished = true;
      if (this.o.onDone) this.o.onDone(this.text(), this.values);
    }
  }

  PM.FillBar = FillBar;
})();
