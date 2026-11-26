// The prompt picker: search, Recent / All / Folders views, folders (2 levels) and tags.
//
// Keys: ↑↓ move · ↵ insert/open · → into folder or tag · ⌫/← back · Ctrl+↵ edit · Tab switch view · esc close
// Events: onInsert(prompt), onEdit(prompt | null, preset), onClose()
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.Picker) return;
  const h = PM.h;

  const within = (fid, pf) => !!pf && (pf === fid || pf.indexOf(fid + '/') === 0);
  const nameOf = (fid) => fid.slice(fid.lastIndexOf('/') + 1);
  const parentOf = (fid) => {
    const i = fid.lastIndexOf('/');
    return i < 0 ? null : fid.slice(0, i);
  };
  const k = (t) => h('span', { class: 'pm-k' }, t);
  const ki = (name) => h('span', { class: 'pm-k pm-ki' }, PM.icon(name, 15, 2));

  function folderIndex(prompts) {
    const map = new Map();
    prompts.forEach((p) => {
      const f = PM.normFolder(p.folder);
      if (!f) return;
      const segs = f.split('/');
      if (!map.has(segs[0])) map.set(segs[0], { id: segs[0], name: segs[0], parent: null });
      if (segs[1] && !map.has(f)) map.set(f, { id: f, name: segs[1], parent: segs[0] });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  class Picker {
    constructor(o) {
      this.o = o;
      this.prompts = (o.prompts || []).slice().sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      this.folders = folderIndex(this.prompts);
      this.recent = (o.recent || []).filter((id) => this.prompts.some((p) => p.id === id)).slice(0, 6);
      this.st = { tab: this.recent.length ? 'recent' : 'all', folder: null, tag: null, query: '', sel: 0 };
      if (o.selectId) this.st.tab = 'all';
      this.build();
      this.render();
      if (o.selectId) {
        const i = this.selectable.findIndex((r) => r.p && r.p.id === o.selectId);
        if (i >= 0) {
          this.st.sel = i;
          this.updateSel(true);
        }
      }
    }

    build() {
      this.input = h('input', { class: 'pm-search-input', type: 'text', 'aria-label': 'Search prompts, folders and tags', autocomplete: 'off', spellcheck: 'false' });
      this.input.addEventListener('input', () => this.go({ query: this.input.value }));
      this.folderChip = h('span', { class: 'pm-chip-folder', hidden: true });
      this.tagChip = h('button', { type: 'button', class: 'pm-chip-tag', 'aria-label': 'Remove tag filter', hidden: true, tabIndex: -1, onmousedown: (e) => e.preventDefault(), onclick: () => this.go({ tag: null }) });
      this.placeholder = h('span', { class: 'pm-placeholder' });
      this.tabsEl = h('div', { class: 'pm-tabs', role: 'tablist', 'aria-label': 'Views' });
      this.list = h('div', { class: 'pm-list', role: 'listbox', 'aria-label': 'Prompts' });
      this.enterHint = h('span');
      this.footer = h('div', { class: 'pm-footer' },
        h('span', null, ki('enter'), this.enterHint),
        h('span', null, ki('right'), 'into'),
        h('span', null, ki('backspace'), 'back'),
        h('span', null, k(PM.isMac ? '⌃' : 'Ctrl'), ki('enter'), 'edit'),
        h('span', { class: 'pm-push' }, k('esc'), ' close'));
      this.el = h('div', { class: 'pm-panel pm-picker', role: 'dialog', 'aria-label': 'Prompt picker' },
        h('div', { class: 'pm-searchrow' },
          PM.icon('search', 16),
          this.folderChip,
          this.tagChip,
          h('span', { class: 'pm-search-wrap' }, this.input, this.placeholder),
          this.o.shortcutLabel ? h('span', { class: 'pm-kbd-chip' }, this.o.shortcutLabel) : null),
        this.tabsEl,
        this.list,
        this.footer);
      // Clicking anywhere in the panel keeps the cursor in the search box.
      this.el.addEventListener('mousedown', (e) => {
        if (e.target !== this.input) e.preventDefault();
      });
      if (this.o.ownKeys) this.el.addEventListener('keydown', (e) => this.handleKey(e));
    }

    focus() {
      this.input.focus({ preventScroll: true });
    }

    go(patch) {
      Object.assign(this.st, { sel: 0 }, patch);
      if (this.input.value !== this.st.query) this.input.value = this.st.query;
      this.render();
    }

    allTags() {
      const s = new Set();
      this.prompts.forEach((p) => (p.tags || []).forEach((t) => s.add(t)));
      return [...s].sort();
    }

    buildRows() {
      const st = this.st;
      const P = this.prompts;
      const F = this.folders;
      const q = st.query.trim().toLowerCase();
      const words = q ? q.split(/\s+/) : [];
      const rows = [];
      const promptRow = (p, showFolder) => ({
        kind: 'prompt', p, title: p.title || 'Untitled', sub: PM.tpl.plain(p.text).replace(/\s+/g, ' ').trim(),
        tags: (p.tags || []).slice(0, 2), aside: showFolder ? PM.folderLabel(p.folder) : '', key: '↵'
      });
      const folderRow = (f) => {
        const n = P.filter((p) => within(f.id, p.folder)).length;
        const subs = F.filter((x) => x.parent === f.id).length;
        return {
          kind: 'folder', f, title: f.parent ? PM.folderLabel(f.id) : f.name,
          sub: n + (n === 1 ? ' prompt' : ' prompts') + (subs ? ' · ' + subs + (subs === 1 ? ' subfolder' : ' subfolders') : ''),
          tags: [], aside: '›', key: '→'
        };
      };
      const hay = (p) => (p.title + ' ' + p.text + ' ' + (p.tags || []).join(' ') + ' ' + (p.folder || '')).toLowerCase();
      const matches = (p) => (!st.tag || (p.tags || []).indexOf(st.tag) >= 0) && words.every((w) => hay(p).indexOf(w) >= 0);
      const filtering = !!q || !!st.tag;
      const inScope = (p) => !st.folder || within(st.folder, p.folder);

      if (q) {
        this.allTags()
          .filter((t) => t !== st.tag && t.indexOf(q) === 0)
          .filter((t) => P.some((p) => (p.tags || []).indexOf(t) >= 0 && inScope(p)))
          .slice(0, 2)
          .forEach((t) => {
            const n = P.filter((p) => (p.tags || []).indexOf(t) >= 0 && inScope(p)).length;
            rows.push({ kind: 'tag', tag: t, title: 'Filter by tag “' + t + '”', sub: n + (n === 1 ? ' prompt' : ' prompts') + (st.folder ? ' in ' + PM.folderLabel(st.folder) : ''), tags: [], aside: '', key: '→' });
          });
        if (!st.folder) F.filter((f) => f.name.toLowerCase().indexOf(q) === 0).forEach((f) => rows.push(folderRow(f)));
      }

      if (st.folder) {
        if (!filtering) {
          F.filter((f) => f.parent === st.folder).forEach((f) => rows.push(folderRow(f)));
          P.filter((p) => PM.normFolder(p.folder) === st.folder).forEach((p) => rows.push(promptRow(p, false)));
        } else {
          const inF = P.filter((p) => within(st.folder, p.folder) && matches(p));
          if (inF.length) rows.push({ kind: 'section', label: 'In ' + PM.folderLabel(st.folder), aside: String(inF.length) });
          inF.forEach((p) => rows.push(promptRow(p, PM.normFolder(p.folder) !== st.folder)));
          const out = P.filter((p) => !within(st.folder, p.folder) && matches(p));
          if (out.length) {
            rows.push({ kind: 'more', title: out.length + ' more in other folders', sub: out.map((p) => p.title).join(' · '), tags: [], aside: 'show all', key: '↵' });
          }
        }
      } else if (filtering) {
        const hits = P.filter(matches);
        if (hits.length) rows.push({ kind: 'section', label: st.tag ? 'Tagged “' + st.tag + '”' : 'Prompts', aside: String(hits.length) });
        hits.forEach((p) => rows.push(promptRow(p, true)));
      } else if (st.tab === 'recent') {
        if (this.recent.length) {
          rows.push({ kind: 'section', label: 'Recent on this computer', aside: '' });
          this.recent.forEach((id) => rows.push(promptRow(P.find((p) => p.id === id), true)));
        }
        const top = F.filter((f) => !f.parent);
        if (top.length) {
          rows.push({ kind: 'section', label: 'Folders', aside: '' });
          top.forEach((f) => rows.push(folderRow(f)));
        }
        const loose = P.filter((p) => !p.folder && this.recent.indexOf(p.id) < 0);
        if (loose.length) {
          rows.push({ kind: 'section', label: top.length ? 'Not in a folder' : 'All prompts', aside: '' });
          loose.forEach((p) => rows.push(promptRow(p, false)));
        }
      } else if (st.tab === 'folders') {
        F.filter((f) => !f.parent).forEach((f) => rows.push(folderRow(f)));
        const loose = P.filter((p) => !p.folder);
        if (loose.length) {
          rows.push({ kind: 'section', label: 'Not in a folder', aside: String(loose.length) });
          loose.forEach((p) => rows.push(promptRow(p, false)));
        }
      } else {
        P.forEach((p) => rows.push(promptRow(p, true)));
      }

      rows.push({
        kind: 'new', title: q ? 'Create “' + st.query.trim() + '”' : 'New prompt',
        sub: st.folder ? 'In ' + PM.folderLabel(st.folder) : st.tag ? 'Tagged ' + st.tag : '', tags: [], aside: '', key: '↵'
      });
      return rows;
    }

    preset() {
      return { title: this.st.query.trim(), folder: this.st.folder || '', tags: this.st.tag ? [this.st.tag] : [] };
    }

    activate(r, dir) {
      if (!r) return;
      if (r.kind === 'folder') this.go({ folder: r.f.id, tab: 'folders', query: '' });
      else if (r.kind === 'tag') this.go({ tag: r.tag, query: '' });
      else if (r.kind === 'more') {
        if (dir !== 'right') this.go({ folder: null, tab: 'all' });
      } else if (r.kind === 'prompt') {
        if (dir !== 'right' && this.o.onInsert) this.o.onInsert(r.p);
      } else if (r.kind === 'new' && this.o.onEdit) this.o.onEdit(null, this.preset());
      if (r.kind !== 'prompt' && r.kind !== 'new') this.focus();
    }

    back() {
      const st = this.st;
      if (st.tag) this.go({ tag: null });
      else if (st.folder) this.go({ folder: parentOf(st.folder), tab: 'folders' });
    }

    current() {
      return this.selectable[this.st.sel];
    }

    handleKey(e) {
      if (e.isComposing) return false;
      const key = e.key;
      const st = this.st;
      const cur = this.current();
      const n = this.selectable.length;
      if (key === 'ArrowDown') {
        st.sel = Math.min(st.sel + 1, n - 1);
        this.updateSel(true);
      } else if (key === 'ArrowUp') {
        st.sel = Math.max(st.sel - 1, 0);
        this.updateSel(true);
      } else if (key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (cur && cur.kind === 'prompt' && this.o.onEdit) this.o.onEdit(cur.p, null);
        else if (cur && cur.kind === 'new' && this.o.onEdit) this.o.onEdit(null, this.preset());
      } else if (key === 'Enter') {
        this.activate(cur, 'enter');
      } else if (key === 'ArrowRight' && cur && (cur.kind === 'folder' || cur.kind === 'tag') && this.input.selectionStart === this.input.value.length) {
        this.activate(cur, 'right');
      } else if ((key === 'Backspace' || key === 'ArrowLeft') && st.query === '' && (st.tag || st.folder)) {
        this.back();
      } else if (key === 'Tab') {
        const order = ['all', 'recent', 'folders'];
        const i = order.indexOf(st.folder ? 'folders' : st.tab);
        const next = order[(i + (e.shiftKey ? -1 : 1) + 3) % 3];
        this.go({ tab: next, folder: null, tag: null, query: '' });
      } else if (key === 'Escape') {
        if (st.query) this.go({ query: '' });
        else if (this.o.onClose) this.o.onClose();
      } else if (key === 'PageDown' || key === 'PageUp') {
        st.sel = key === 'PageDown' ? Math.min(st.sel + 6, n - 1) : Math.max(st.sel - 6, 0);
        this.updateSel(true);
      } else return false;
      e.preventDefault();
      return true;
    }

    render() {
      const st = this.st;
      this.folderChip.hidden = !st.folder;
      if (st.folder) this.folderChip.replaceChildren(PM.icon('folder', 13, 2.2), PM.folderLabel(st.folder));
      this.tagChip.hidden = !st.tag;
      if (st.tag) this.tagChip.replaceChildren(PM.icon('tag', 12, 2.2), st.tag, h('span', { class: 'pm-x' }, '×'));
      this.placeholder.hidden = !!st.query;
      this.placeholder.textContent = st.folder ? 'Search in ' + nameOf(st.folder) + '…' : 'Search prompts, folders, tags…';

      const inTab = st.folder ? 'folders' : st.tab;
      const lineOn = (id) => (!st.query && !st.tag && inTab === id) || ((!!st.query || !!st.tag) && !st.folder && id === 'all') || (!!st.folder && id === 'folders');
      const tabs = [
        { id: 'all', label: 'All', count: String(this.prompts.length) },
        { id: 'recent', label: 'Recent', count: '' },
        { id: 'folders', label: 'Folders', count: String(this.folders.filter((f) => !f.parent).length) }
      ];
      this.tabsEl.replaceChildren(
        ...tabs.map((d) =>
          h('button', {
            type: 'button', role: 'tab', tabIndex: -1, 'aria-selected': String(inTab === d.id),
            class: 'pm-tab' + (inTab === d.id ? ' is-on' : '') + (lineOn(d.id) ? ' is-line' : ''),
            onmousedown: (e) => e.preventDefault(),
            onclick: () => {
              this.go({ tab: d.id, folder: null, tag: null, query: '' });
              this.focus();
            }
          }, d.label, d.count ? h('span', { class: 'pm-count' }, d.count) : null)),
        h('span', { class: 'pm-tabs-hint' }, k('tab'), ' switch view'));

      const rows = this.buildRows();
      this.selectable = rows.filter((r) => r.kind !== 'section');
      if (st.sel >= this.selectable.length) st.sel = Math.max(0, this.selectable.length - 1);
      const out = [];
      const onlyNew = this.selectable.length === 1;
      if (onlyNew && st.query) out.push(h('div', { class: 'pm-empty' }, 'Nothing matches. ↵ creates a prompt called “' + st.query.trim() + '”.'));
      else if (onlyNew && !this.prompts.length) out.push(h('div', { class: 'pm-empty' }, 'No prompts yet. Create one — write #name# where a value changes each time.'));
      else if (onlyNew && st.folder) out.push(h('div', { class: 'pm-empty' }, 'This folder is empty.'));
      rows.forEach((r) => out.push(r.kind === 'section' ? this.sectionEl(r) : this.rowEl(r, this.selectable.indexOf(r))));
      this.list.replaceChildren(...out);
      this.list.scrollTop = 0;
      this.updateSel(true);
    }

    sectionEl(r) {
      return h('div', { class: 'pm-section' }, h('span', null, r.label), h('span', null, r.aside));
    }

    rowEl(r, idx) {
      const ico = r.kind === 'prompt'
        ? (r.title.trim().charAt(0) || '#').toUpperCase()
        : PM.icon(r.kind === 'folder' ? 'folder' : r.kind === 'tag' ? 'tag' : r.kind === 'more' ? 'more' : 'plus', 15);
      const el = h('button', {
        type: 'button', class: 'pm-row is-' + r.kind, tabIndex: -1, role: 'option',
        onmousedown: (e) => e.preventDefault(),
        onmousemove: () => {
          if (this.st.sel !== idx) {
            this.st.sel = idx;
            this.updateSel(false);
          }
        },
        onclick: (e) => {
          if ((e.ctrlKey || e.metaKey) && r.kind === 'prompt' && this.o.onEdit) this.o.onEdit(r.p, null);
          else this.activate(r, 'enter');
        }
      },
        h('span', { class: 'pm-ico is-' + r.kind }, ico),
        h('span', { class: 'pm-row-main' }, h('span', { class: 'pm-row-title' }, r.title), r.sub ? h('span', { class: 'pm-row-sub' }, r.sub) : null),
        h('span', { class: 'pm-row-side' },
          (r.tags || []).map((t) => h('span', { class: 'pm-tagpill' }, t)),
          r.aside ? h('span', { class: 'pm-aside' }, r.aside) : null,
          h('span', { class: 'pm-rowkey' }, r.key)));
      r.el = el;
      return el;
    }

    updateSel(scroll) {
      this.selectable.forEach((r, i) => {
        if (!r.el) return;
        r.el.classList.toggle('is-sel', i === this.st.sel);
        r.el.setAttribute('aria-selected', String(i === this.st.sel));
      });
      const cur = this.current();
      if (cur && cur.el && scroll) {
        const L = this.list;
        const top = cur.el.offsetTop;
        const bottom = top + cur.el.offsetHeight;
        if (top < L.scrollTop + 4) L.scrollTop = Math.max(0, top - 28);
        else if (bottom > L.scrollTop + L.clientHeight - 4) L.scrollTop = bottom - L.clientHeight + 6;
      }
      const hint = !cur ? 'insert' : cur.kind === 'folder' ? 'open' : cur.kind === 'tag' ? 'filter' : cur.kind === 'more' ? 'show all' : cur.kind === 'new' ? 'create' : 'insert';
      this.enterHint.textContent = hint;
    }
  }

  PM.Picker = Picker;
  PM.folderIndex = folderIndex;
})();
