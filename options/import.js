// Settings › Library › Import from AI: read the import block from an AI reply (pasted here, or sent by
// the "Review & import" bar on a chat page), review what was read, fix or remove entries, pick what to
// import, then add it to the library, with undo. Parsing and checks are in shared/importer.js.
(function () {
  'use strict';
  const PM = globalThis.PM;
  const h = PM.h;
  const I = PM.importer;
  const PENDING_MAX_AGE = 30 * 60 * 1000;

  const fresh = () => ({
    session: I.emptySession(),
    edits: new Map(), // key -> edited entry
    removed: new Set(),
    checked: new Map(), // key -> bool (only when the user changed it)
    decisions: {}, // key -> 'copy' | 'replace'
    defaults: {}, // key -> variable defaults set in the editor
    filter: 'all',
    error: '',
    source: '',
    result: null, // { plan, created, replaced, recentBefore, entries, startHere }
    busy: false,
    saveError: ''
  });
  let st = fresh();
  let ctx = null; // { prompts, layer, settings, refresh }
  let root = null;
  let editor = null;
  let view = [];
  let removedView = [];
  let library = null;

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const folderOf = (e) => PM.normFolder(e.folder) || 'Imported';
  const snippet = (s) => s.replace(/\s+/g, ' ').trim();
  const initial = (t) => (t.trim().charAt(0) || '#').toUpperCase();
  const attention = (e) => e.issues.filter((i) => i.attention);
  const isBlocked = (e) => e.status === 'invalid';
  const isReady = (e) => e.status === 'ok' && !attention(e).length;
  const needsLook = (e) => !isBlocked(e) && !isReady(e);
  const isChecked = (e) => !isBlocked(e) && (st.checked.has(e.key) ? st.checked.get(e.key) : e.defaultChecked);
  const selected = () => view.filter(isChecked);

  function compute() {
    library = I.createLibraryIndex(
      ctx.prompts.map((p) => ({ id: p.id, title: p.title, body: p.text, folder: p.folder })),
      [...new Set(ctx.prompts.map((p) => p.folder).filter(Boolean))]);
    const base = I.sessionEntries(st.session).map((e) => st.edits.get(e.key) || e);
    view = I.evaluate(base.filter((e) => !st.removed.has(e.key)), library);
    removedView = base.filter((e) => st.removed.has(e.key));
  }
  const plan = () => I.buildImportPlan(view, { selected: selected().map((e) => e.key), decisions: st.decisions, library });
  const find = (key) => view.find((e) => e.key === key);

  function rerender(focusSel) {
    if (!root || !root.isConnected) return;
    root.replaceChildren(...build());
    if (focusSel) {
      const el = root.querySelector(focusSel);
      if (el) el.focus({ preventScroll: true });
    }
  }

  // ---------- Reading text ----------
  function addTexts(texts, opts) {
    let session = st.session;
    let lastError = '';
    let found = 0;
    for (const t of texts) {
      const r = I.addText(session, t, opts);
      if (r.result.ok) {
        session = r.session;
        found++;
      } else lastError = (r.result.issues[0] && r.result.issues[0].message) || "We couldn't read that text.";
    }
    if (!found) {
      st.error = lastError;
      return false;
    }
    st.session = session;
    st.error = '';
    st.filter = 'all';
    st.result = null;
    return true;
  }

  // An import block sent from a chat page (background.js keeps it in storage.local until read here).
  async function takePending() {
    const r = await ext.storage.local.get('_pendingImport');
    const p = r._pendingImport;
    if (!p) return false;
    await ext.storage.local.remove('_pendingImport');
    if (!Array.isArray(p.texts) || Date.now() - (p.at || 0) > PENDING_MAX_AGE) return false;
    if (st.result) st = fresh();
    const ok = addTexts(p.texts, { wholeTextIsBlock: true });
    if (ok) st.source = p.host || '';
    rerender();
    return ok;
  }

  // ---------- Import and undo ----------
  async function runImport() {
    const p = plan();
    if (!p.create.length && !p.replace.length) return;
    st.busy = true;
    st.saveError = '';
    rerender();
    const byId = new Map(ctx.prompts.map((x) => [x.id, x]));
    const entries = view.slice();
    try {
      const recentBefore = await PM.store.getRecent();
      const createRecs = p.create.map((c) => ({
        title: c.title, text: c.body, folder: PM.normFolder(c.folder), tags: c.tags, defaults: st.defaults[c.entryKey] || {}
      }));
      const replaced = p.replace.map((r) => {
        const before = byId.get(r.libraryId);
        const tags = Array.from(new Set(before.tags.concat(r.addTags)));
        const defaults = Object.assign({}, before.defaults, st.defaults[r.entryKey] || {});
        return { before, next: Object.assign({}, before, { text: r.body, tags, defaults }) };
      });
      const saved = await PM.store.savePrompts(createRecs.concat(replaced.map((x) => x.next)));
      const created = saved.slice(0, createRecs.length);
      // "Start here" prompts go to the top of the picker (its Recent list), best first.
      const idOf = new Map();
      p.create.forEach((c, i) => idOf.set(c.entryKey, created[i].id));
      p.replace.forEach((r) => idOf.set(r.entryKey, r.libraryId));
      const startIds = entries.filter((e) => e.startHere && idOf.has(e.key)).map((e) => idOf.get(e.key));
      if (startIds.length) await PM.store.setRecent(startIds.concat(recentBefore.filter((x) => startIds.indexOf(x) < 0)));
      st.result = { plan: p, created, replaced, recentBefore, entries, startHere: startIds.length };
    } catch (e) {
      st.saveError = (e && e.message) || String(e);
    }
    st.busy = false;
    await ctx.refresh();
    rerender(st.result ? '.imp-result h2' : null);
    window.scrollTo({ top: 0 });
  }

  async function undo() {
    const r = st.result;
    if (!r) return;
    st.busy = true;
    rerender();
    try {
      for (const c of r.created) await PM.store.deletePrompt(c.id);
      if (r.replaced.length) await PM.store.savePrompts(r.replaced.map((x) => x.before));
      await PM.store.setRecent(r.recentBefore);
      st.result = null;
    } catch (e) {
      st.saveError = (e && e.message) || String(e);
    }
    st.busy = false;
    await ctx.refresh();
  }

  // ---------- Editor (the extension's own prompt editor) ----------
  function openEditor(key) {
    const e = find(key);
    if (!e) return;
    closeEditor();
    const others = view.filter((x) => x.key !== key).map((x) => ({ title: x.title, folder: PM.normFolder(x.folder), tags: x.tags }));
    editor = new PM.Editor({
      prompt: { id: key, title: e.title, text: e.body, folder: PM.normFolder(e.folder), tags: e.tags, defaults: st.defaults[key] || {} },
      prompts: ctx.prompts.concat(others),
      ownKeys: true,
      labels: { heading: 'Edit before import', save: 'Save', del: 'Remove from import', delConfirm: 'Click again to remove' },
      onSave: async (data) => {
        const patch = {};
        if (data.title !== e.title) patch.title = data.title;
        if (data.folder !== PM.normFolder(e.folder)) patch.folder = data.folder;
        if (data.tags.join(',') !== e.tags.join(',')) patch.tags = data.tags;
        if (data.text !== e.body || e.incomplete) patch.body = data.text;
        if (Object.keys(patch).length) st.edits.set(key, I.applyEdit(e, patch));
        st.defaults[key] = data.defaults;
        closeEditor();
        rerender(rowSel(key, 'edit'));
      },
      onDelete: async () => {
        closeEditor();
        remove(key);
      },
      onCancel: () => {
        closeEditor();
        const b = root && root.querySelector(rowSel(key, 'edit'));
        if (b) b.focus({ preventScroll: true });
      }
    });
    ctx.layer.appendChild(editor.el);
    editor.focus();
  }
  function closeEditor() {
    if (editor) editor.el.remove();
    editor = null;
  }
  const rowSel = (key, act) => '[data-key="' + CSS.escape(key) + '"] [data-act="' + act + '"]';

  function edit(key, patch) {
    const e = find(key);
    if (!e) return;
    st.edits.set(key, I.applyEdit(e, patch));
    rerender();
  }
  function remove(key) {
    st.removed.add(key);
    rerender('.imp-removed summary');
  }
  function restore(key) {
    st.removed.delete(key);
    rerender(rowSel(key, 'edit'));
  }
  function setAll(value) {
    view.forEach((e) => {
      if (value === null) st.checked.delete(e.key);
      else if (!isBlocked(e)) st.checked.set(e.key, value);
    });
    rerender();
  }

  // ---------- Building ----------
  function statusPill(e) {
    if (e.status === 'invalid') return h('span', { class: 'pill danger' }, 'Can’t import');
    if (e.status === 'incomplete') return h('span', { class: 'pill warn' }, 'May be cut off');
    if (e.status === 'duplicate') return h('span', { class: 'pill warn' }, e.duplicateOf ? 'In library' : 'Duplicate');
    if (e.maybe) return h('span', { class: 'pill later' }, 'Maybe');
    if (attention(e).length) return h('span', { class: 'pill warn' }, 'Check');
    return null;
  }

  function fixesFor(e) {
    const out = [];
    if (e.issues.some((i) => i.code === 'body_fenced')) {
      out.push(h('button', { type: 'button', class: 'linkbtn', onclick: () => edit(e.key, { body: I.removeCodeFence(e.body) }) }, 'Remove code fence'));
    }
    if (e.incomplete) {
      out.push(h('button', { type: 'button', class: 'linkbtn', onclick: () => edit(e.key, { body: e.body }) }, 'The text is complete'));
    }
    return out;
  }

  function row(e) {
    const checked = isChecked(e);
    const blocked = isBlocked(e);
    const notes = attention(e).filter((i) => !(i.code === 'maybe' && e.status === 'ok'));
    const first = notes[0];
    const vars = e.variables.length;
    const id = 'imp-' + e.key.replace(/[^A-Za-z0-9_-]/g, '_');
    const box = h('input', { type: 'checkbox', class: 'imp-check', id, checked, disabled: blocked, 'aria-label': 'Import ' + (e.title || 'untitled prompt') });
    box.addEventListener('change', () => {
      st.checked.set(e.key, box.checked);
      rerender('#' + CSS.escape(id));
    });
    let decision = null;
    if (e.duplicateOf) {
      decision = h('select', { class: 'input imp-select', 'aria-label': 'If “' + e.title + '” is imported' },
        h('option', { value: 'copy' }, 'Import as copy'),
        h('option', { value: 'replace' }, 'Replace existing'));
      decision.value = st.decisions[e.key] === 'replace' ? 'replace' : 'copy';
      decision.addEventListener('change', () => {
        st.decisions[e.key] = decision.value;
        st.checked.set(e.key, true);
        rerender();
      });
    }
    const meta = [
      e.tags.slice(0, 3).map((t) => h('span', { class: 'tagpill' }, t)),
      vars ? h('span', { class: 'varpill' }, vars + (vars === 1 ? ' var' : ' vars')) : null,
      decision
    ];
    return h('div', { class: 'lib-row imp-row' + (checked ? '' : ' is-off'), 'data-key': e.key },
      box,
      h('span', { class: 'lib-ico', 'aria-hidden': 'true' }, initial(e.title)),
      h('span', { class: 'lib-main' },
        h('span', { class: 'imp-title-line' },
          h('label', { class: 'lib-title', for: id }, e.title || 'Untitled prompt'),
          e.startHere ? h('span', { class: 'pill acc' }, 'Start here') : null,
          e.kind === 'modifier' ? h('span', { class: 'pill later' }, 'Modifier') : null,
          statusPill(e)),
        h('span', { class: 'lib-snip' }, h('span', { class: 'imp-folder' }, PM.folderLabel(folderOf(e))), ' · ', snippet(e.body) || 'No text'),
        first ? h('span', { class: 'imp-issue' + (first.severity === 'error' ? ' danger' : '') }, first.message,
          notes.length > 1 ? h('span', { class: 'imp-more' }, ' +' + (notes.length - 1) + ' more') : null, ' ', fixesFor(e)) : null,
        e.tags.length || vars || decision ? h('span', { class: 'imp-meta' }, meta) : null),
      h('span', { class: 'imp-side' },
        h('button', { type: 'button', class: 'btn quiet sm', 'data-act': 'edit', onclick: () => openEditor(e.key) }, 'Edit'),
        h('button', { type: 'button', class: 'icon-btn', 'data-act': 'remove', title: 'Remove from this import', 'aria-label': 'Remove “' + (e.title || 'untitled prompt') + '” from this import', onclick: () => remove(e.key) }, PM.icon('trash', 16))));
  }

  function pastePanel(hasEntries) {
    const ta = h('textarea', { class: 'input imp-paste', rows: 4, spellcheck: 'false', 'aria-label': 'The AI’s reply', placeholder: 'Paste the whole reply, or just the block that starts with ~~~~prolly' });
    const read = () => {
      if (!ta.value.trim()) {
        st.error = 'Paste the AI’s reply first.';
      } else if (addTexts([ta.value])) {
        st.source = '';
      }
      rerender(st.error ? '.imp-paste' : '.imp-filters [aria-checked="true"]');
    };
    ta.addEventListener('paste', () => setTimeout(read, 0));
    const copyBtn = h('button', { type: 'button', class: 'btn quiet' }, 'Copy the setup prompt');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(PM.SETUP_PROMPT.text);
        copyBtn.textContent = 'Copied ✓';
      } catch (e) {
        copyBtn.textContent = 'Could not copy';
      }
      setTimeout(() => (copyBtn.textContent = 'Copy the setup prompt'), 2000);
    });
    return h('section', { class: 'card' },
      h('div', { class: 'row', style: { 'align-items': 'flex-start' } },
        h('div', { class: 'grow' },
          h('h2', null, hasEntries ? 'Add another part' : 'Paste the AI’s reply'),
          h('p', { class: 'sub' }, hasEntries
            ? 'If the AI split the library into parts, say “continue” in the chat and paste the next reply here.'
            : 'The reply to “Set up my prompt library” ends with a block that starts with ~~~~prolly. Paste the reply here, or click Review & import in the Prolly bar on the chat page.')),
        hasEntries ? h('button', { type: 'button', class: 'btn quiet', onclick: () => { st = fresh(); rerender('.imp-paste'); } }, 'Start over') : null),
      ta,
      h('div', { class: 'row', style: { gap: '8px', 'flex-wrap': 'wrap' } },
        h('button', { type: 'button', class: 'btn dark', onclick: read }, 'Read reply'),
        hasEntries ? null : copyBtn,
        st.error ? h('p', { class: 'err', role: 'alert' }, st.error) : null));
  }

  function banners() {
    const out = [];
    const p = I.sessionProgress(st.session);
    if (p.cutOff.length) {
      out.push(h('div', { class: 'note warn' }, h('b', null, 'Cut off'), h('span', null,
        'The reply stopped before the end' + (p.total > 1 ? ' of part ' + p.cutOff.join(', ') : '') + '. In the chat, say “continue”, then add the next reply here. The last prompt may be incomplete.')));
    }
    if (p.missing.length) {
      out.push(h('div', { class: 'note' }, h('b', null, (p.missing.length === 1 ? 'Part ' + p.missing[0] : 'Parts ' + p.missing.join(', ')) + ' of ' + p.total),
        h('span', null, 'Not here yet. Say “continue” in the chat and add the reply here, or import what’s here now.')));
    }
    st.session.issues.filter((i) => i.attention).forEach((i) => out.push(h('div', { class: 'note' }, h('b', null, 'Note'), h('span', null, i.message))));
    return out;
  }

  function filters() {
    const counts = [
      ['all', 'All', view.length],
      ['attention', 'Needs a look', view.filter(needsLook).length],
      ['ready', 'Ready', view.filter(isReady).length],
      ['blocked', 'Can’t import', view.filter(isBlocked).length],
      ['selected', 'Selected', selected().length]
    ].filter((c) => c[0] !== 'blocked' || c[2] > 0);
    return h('div', { class: 'seg inline imp-filters', role: 'radiogroup', 'aria-label': 'Show' },
      counts.map(([f, label, n]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(st.filter === f),
        onclick: () => { st.filter = f; rerender('.imp-filters [aria-checked="true"]'); }
      }, label, h('span', { class: 'imp-n' }, String(n)))));
  }

  function groups() {
    const names = { attention: 'Needs a look', ready: 'Ready', blocked: 'Can’t import', selected: 'Selected' };
    const tests = { attention: needsLook, ready: isReady, blocked: isBlocked, selected: isChecked };
    const list = st.filter === 'all'
      ? [['Needs a look', view.filter(needsLook)], ['Ready', view.filter(isReady)], ['Can’t import', view.filter(isBlocked)]]
      : [[names[st.filter], view.filter(tests[st.filter])]];
    const out = list.filter((g) => g[1].length).map(([name, items]) =>
      h('div', { class: 'group' },
        h('div', { class: 'group-title' }, h('span', null, name), h('span', null, String(items.length))),
        h('div', { class: 'lib-list' }, items.map(row))));
    return out.length ? out : [h('div', { class: 'empty' }, view.length ? 'Nothing here.' : 'Every prompt was removed from this import.')];
  }

  function removedList() {
    if (!removedView.length) return null;
    return h('details', { class: 'imp-removed' },
      h('summary', null, 'Removed from this import · ' + removedView.length),
      h('div', { class: 'lib-list' }, removedView.map((e) =>
        h('div', { class: 'lib-row imp-row', 'data-key': e.key },
          h('span', { class: 'lib-ico', 'aria-hidden': 'true' }, initial(e.title)),
          h('span', { class: 'lib-main' }, h('span', { class: 'lib-title' }, e.title || 'Untitled prompt')),
          h('button', { type: 'button', class: 'btn sm', onclick: () => restore(e.key) }, 'Restore')))));
  }

  function footer() {
    const sel = selected();
    const p = plan();
    const bits = [h('b', null, plural(sel.length, 'prompt')), ' selected'];
    if (p.foldersToCreate.length) bits.push(' · ' + plural(p.foldersToCreate.length, 'new folder'));
    if (p.replace.length) bits.push(' · ' + p.replace.length + (p.replace.length === 1 ? ' replaces an existing prompt' : ' replace existing prompts'));
    const n = p.create.length + p.replace.length;
    return h('div', { class: 'imp-footer' },
      h('span', { class: 'imp-footer-text' }, bits),
      h('span', { class: 'imp-picks' },
        h('button', { type: 'button', class: 'btn quiet sm', onclick: () => setAll(true) }, 'All'),
        h('button', { type: 'button', class: 'btn quiet sm', onclick: () => setAll(false) }, 'None'),
        h('button', { type: 'button', class: 'btn quiet sm', onclick: () => setAll(null) }, 'Suggested')),
      h('span', { style: { flex: '1' } }),
      st.saveError ? h('p', { class: 'err', role: 'alert' }, st.saveError) : null,
      h('button', { type: 'button', class: 'btn dark', disabled: !n || st.busy, onclick: runImport },
        st.busy ? 'Importing…' : n ? 'Import ' + plural(n, 'prompt') : 'Select prompts to import'));
  }

  function resultView() {
    const r = st.result;
    const p = r.plan;
    const titleOf = (key) => (r.entries.find((e) => e.key === key) || {}).title || '';
    const byFolder = new Map();
    const add = (folder, item) => byFolder.set(folder, (byFolder.get(folder) || []).concat([item]));
    r.created.forEach((c) => add(c.folder || '', { title: c.title, replaced: false }));
    r.replaced.forEach((x, i) => add(x.before.folder || '', { title: titleOf(p.replace[i].entryKey) || x.before.title, replaced: true }));
    const total = r.created.length + r.replaced.length;
    const bits = [plural(r.created.length, 'new prompt')];
    if (r.replaced.length) bits.push(r.replaced.length + ' replaced');
    if (p.foldersToCreate.length) bits.push(plural(p.foldersToCreate.length, 'new folder'));
    if (p.skipped.length) bits.push(p.skipped.length + ' left out');
    const sc = PM.shortcutLabel(ctx.settings.shortcut);
    const keys = [...byFolder.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    return [
      h('section', { class: 'card imp-result' },
        h('div', { class: 'grow' },
          h('h2', { tabIndex: -1 }, 'Imported ' + plural(total, 'prompt')),
          h('p', { class: 'sub' }, bits.join(' · ') + '. ' + (r.startHere
            ? 'Your “Start here” prompts are at the top when you press ' + sc + ' in a chat.'
            : 'Press ' + sc + ' in a chat to use them.'))),
        h('div', { class: 'row', style: { 'flex-wrap': 'wrap', gap: '8px' } },
          h('button', { type: 'button', class: 'btn', disabled: st.busy, onclick: undo }, st.busy ? 'Undoing…' : 'Undo import'),
          h('button', { type: 'button', class: 'btn quiet', onclick: () => { st = fresh(); rerender('.imp-paste'); } }, 'Import another reply'),
          h('a', { class: 'btn dark', href: '#library' }, 'Go to library')),
        st.saveError ? h('p', { class: 'err', role: 'alert' }, st.saveError) : null),
    ].concat(keys.map((f) =>
        h('div', { class: 'group' },
          h('div', { class: 'group-title' }, h('span', null, f ? PM.folderLabel(f) : 'Not in a folder'), h('span', null, String(byFolder.get(f).length))),
          h('div', { class: 'lib-list' }, byFolder.get(f).map((it) =>
            h('div', { class: 'lib-row imp-row' },
              h('span', { class: 'lib-ico', 'aria-hidden': 'true' }, initial(it.title)),
              h('span', { class: 'lib-main' }, h('span', { class: 'lib-title' }, it.title)),
              it.replaced ? h('span', { class: 'pill later' }, 'Replaced existing') : null))))));
  }

  function build() {
    compute();
    const head = h('div', { class: 'toolbar' },
      h('div', { class: 'grow' },
        h('div', { class: 'crumbs' }, h('a', { href: '#library' }, 'Library'), ' › Import from AI'),
        h('h1', null, 'Import from AI')));
    if (st.result) return [head].concat(resultView());
    const hasEntries = I.sessionEntries(st.session).length > 0;
    const out = [head];
    if (!hasEntries) {
      const sc = PM.shortcutLabel(ctx.settings.shortcut);
      out.push(h('div', { class: 'note' }, h('b', null, 'How it works'), h('span', null,
        'In ChatGPT, Claude or Gemini, press ' + sc + ' and pick “Set up my prompt library”. The AI looks at how you prompt and writes your prompts in a block Prolly can read. Then review them here before anything is added.')));
    }
    out.push(pastePanel(hasEntries));
    if (!hasEntries) return out;
    out.push(...banners());
    out.push(h('div', { class: 'toolbar' },
      h('h2', null, plural(view.length, 'prompt') + ' found' + (st.source ? ' on ' + st.source : '')),
      h('span', { style: { flex: '1' } }),
      filters()));
    out.push(...groups());
    const rem = removedList();
    if (rem) out.push(rem);
    out.push(footer());
    return out;
  }

  PM.importScreen = {
    // c: { prompts, settings, layer, refresh }
    render(c) {
      ctx = c;
      root = h('div', { class: 'imp' });
      root.replaceChildren(...build());
      return root;
    },
    takePending,
    busy: () => st.busy || !!editor
  };
})();
