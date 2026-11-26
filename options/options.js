(function () {
  'use strict';
  const PM = globalThis.PM;
  const h = PM.h;
  const main = document.getElementById('main');
  const layer = document.getElementById('pmLayer');
  PM.adoptCSS(document);

  const SWATCHES = [
    { name: 'Blue', hex: '#2563EB' }, { name: 'Indigo', hex: '#4F46E5' }, { name: 'Sky', hex: '#0284C7' },
    { name: 'Teal', hex: '#0D9488' }, { name: 'Violet', hex: '#7C3AED' }, { name: 'Graphite', hex: '#3F3F46' }
  ];
  const SAMPLE = [
    { id: 's1', title: 'Code review', folder: 'Dev', tags: ['review'], text: 'Review this #language# code for bugs, security issues and readability. Pay special attention to #focus#. Return the findings as a #format:numbered list|table|checklist#.' },
    { id: 's2', title: 'Translate & localize', folder: 'Writing', tags: ['translation'], text: 'Translate the text below into #language#, keeping a #tone:formal|friendly|playful# tone.' },
    { id: 's3', title: 'Meeting notes → action items', folder: 'Ops', tags: ['meetings'], text: 'Turn the notes below into action items with an owner each.' }
  ];

  const state = { settings: null, prompts: [], section: 'library', query: '', usage: null, sync: true, flash: null };
  let editor = null;
  let recording = null; // { siteHost | null, cleanup }

  const switchEl = (on, label, onToggle, small) =>
    h('button', { type: 'button', role: 'switch', class: 'switch' + (small ? ' sm' : ''), 'aria-checked': String(!!on), 'aria-label': label, onclick: onToggle });
  const keycaps = (sc) => {
    const parts = PM.shortcutParts(sc);
    const out = [];
    parts.forEach((p, i) => {
      if (i) out.push(h('span', { class: 'plus' }, '+'));
      out.push(h('span', { class: 'keycap' }, p));
    });
    return h('div', { class: 'keys' }, out);
  };

  async function load() {
    const [settings, prompts, usage, sync] = await Promise.all([PM.store.getSettings(), PM.store.loadPrompts(), PM.store.usage(), PM.store.syncOn()]);
    Object.assign(state, { settings, prompts, usage, sync });
    document.getElementById('libCount').textContent = '· ' + prompts.length;
    document.documentElement.style.setProperty('--acc', settings.accent);
    PM.applyTheme(layer, settings);
  }

  function setSection() {
    const s = (location.hash || '#library').slice(1);
    state.section = ['library', 'appearance', 'sites', 'sync'].indexOf(s) >= 0 ? s : 'library';
    document.querySelectorAll('.side a').forEach((a) => {
      const on = a.getAttribute('data-sec') === state.section;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function render() {
    stopRecording();
    const f = { library: renderLibrary, appearance: renderAppearance, sites: renderSites, sync: renderSync }[state.section];
    main.replaceChildren();
    PM.append(main, f());
  }

  async function saveSettings(patch) {
    state.settings = await PM.store.saveSettings(patch);
    PM.applyTheme(layer, state.settings);
    document.documentElement.style.setProperty('--acc', state.settings.accent);
  }

  // ---------- Editor (shared with the in-page one) ----------
  function openEditor(p, preset) {
    closeEditor();
    editor = new PM.Editor({
      prompt: p, preset, prompts: state.prompts, ownKeys: true,
      onSave: async (data) => {
        await PM.store.savePrompt(Object.assign({}, p || {}, data));
        closeEditor();
        await refresh();
      },
      onDelete: async (id) => {
        await PM.store.deletePrompt(id);
        closeEditor();
        await refresh();
      },
      onCancel: closeEditor
    });
    layer.appendChild(editor.el);
    editor.focus();
  }
  function closeEditor() {
    if (editor) editor.el.remove();
    editor = null;
  }

  // ---------- Library ----------
  function renderLibrary() {
    const q = state.query.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const hay = (p) => (p.title + ' ' + p.text + ' ' + p.tags.join(' ') + ' ' + p.folder).toLowerCase();
    const list = state.prompts.filter((p) => words.every((w) => hay(p).indexOf(w) >= 0));
    const search = h('input', { class: 'input lib-search', type: 'search', placeholder: 'Search prompts', 'aria-label': 'Search prompts', value: state.query });
    search.addEventListener('input', () => {
      state.query = search.value;
      const pos = search.selectionStart;
      render();
      const s = main.querySelector('.lib-search');
      s.focus();
      s.setSelectionRange(pos, pos);
    });
    const groups = new Map();
    list.forEach((p) => {
      const g = p.folder || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    });
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const row = (p) => {
      const vars = PM.tpl.parse(p.text).defs.length;
      return h('button', { type: 'button', class: 'lib-row', onclick: () => openEditor(p) },
        h('span', { class: 'lib-ico' }, (p.title.charAt(0) || '#').toUpperCase()),
        h('span', { class: 'lib-main' }, h('span', { class: 'lib-title' }, p.title || 'Untitled'), h('span', { class: 'lib-snip' }, PM.tpl.plain(p.text).replace(/\s+/g, ' '))),
        h('span', { class: 'lib-side' }, p.tags.slice(0, 3).map((t) => h('span', { class: 'tagpill' }, t)), vars ? h('span', { class: 'varpill' }, vars + (vars === 1 ? ' var' : ' vars')) : null));
    };
    const sc = PM.shortcutLabel(state.settings.shortcut);
    let body;
    if (!state.prompts.length) {
      body = h('div', { class: 'empty' }, h('p', null, 'No prompts yet.'), h('p', { class: 'small', style: { 'margin-top': '6px' } }, 'Create one, and write #name# wherever a value changes each time.'));
    } else if (!list.length) {
      body = h('div', { class: 'empty' }, 'No prompt matches “' + state.query + '”.');
    } else {
      body = keys.map((g) =>
        h('div', { class: 'group' },
          h('div', { class: 'group-title' }, h('span', null, g ? PM.folderLabel(g) : 'Not in a folder'), h('span', null, String(groups.get(g).length))),
          h('div', { class: 'lib-list' }, groups.get(g).map(row))));
    }
    return [
      h('div', { class: 'toolbar' },
        h('h1', null, 'Library'),
        h('span', { style: { flex: '1' } }),
        search,
        h('button', { type: 'button', class: 'btn dark', onclick: () => openEditor(null, { title: state.query.trim() }) }, '+ New prompt')),
      h('div', { class: 'note' }, h('b', null, 'Tip'), h('span', null, 'In ChatGPT, Claude, Gemini or any site you add, click into the message box and press ' + sc + (state.settings.typedTrigger ? ' (or type ;;)' : '') + ' to open your prompts.')),
      body
    ];
  }

  // ---------- Appearance ----------
  let previewScreen = 'picker';
  function renderAppearance() {
    const s = state.settings;
    const sw = SWATCHES.find((x) => x.hex.toLowerCase() === String(s.accent).toLowerCase());
    const themeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' },
      [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([id, label]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.theme === id), onclick: async () => { await saveSettings({ theme: id }); render(); } }, label)));
    const hex = h('input', { class: 'input mono', id: 'custom-hex', type: 'text', value: s.accent, maxLength: 7, style: { flex: '1', width: '100%' } });
    hex.addEventListener('change', async () => {
      let v = hex.value.trim();
      if (v && v.charAt(0) !== '#') v = '#' + v;
      if (PM.validHex(v)) {
        await saveSettings({ accent: v.toUpperCase() });
        render();
      } else hex.value = s.accent;
    });
    const resolved = PM.resolveTheme(s.theme);
    const stage = h('div', { class: 'stage pm-ui', 'data-dark': resolved === 'dark' ? '' : null });
    PM.applyTheme(stage, s);
    const prompts = state.prompts.length ? state.prompts : SAMPLE;
    const mountPreview = () => {
      let comp;
      if (previewScreen === 'picker') {
        comp = new PM.Picker({ prompts, recent: prompts.slice(0, 3).map((p) => p.id), ownKeys: true, shortcutLabel: PM.shortcutLabel(s.shortcut, true),
          onInsert: (p) => { previewScreen = 'fill'; previewPrompt = p; mountPreview(); syncScreenSeg(); },
          onEdit: () => {}, onClose: () => {} });
      } else {
        const p = previewPrompt || prompts.find((x) => PM.tpl.parse(x.text).defs.length) || SAMPLE[0];
        comp = new PM.FillBar({ prompt: p, showPreview: true, ownKeys: true, onDone: () => { previewScreen = 'picker'; mountPreview(); syncScreenSeg(); } });
      }
      stage.replaceChildren(comp.el, h('div', { class: 'stage-composer' }, 'Message Assistant…'));
    };
    let previewPrompt = null;
    const screenSeg = h('div', { class: 'seg inline', role: 'radiogroup', 'aria-label': 'Preview screen', style: { 'margin-left': 'auto' } });
    const syncScreenSeg = () =>
      screenSeg.replaceChildren(...[['picker', 'Picker'], ['fill', 'Variables']].map(([id, label]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(previewScreen === id), onclick: () => { previewScreen = id; mountPreview(); syncScreenSeg(); } }, label)));
    syncScreenSeg();
    mountPreview();

    return [
      h('h1', null, 'Appearance'),
      h('div', { class: 'ap' },
        h('section', { class: 'card ap-controls' },
          h('div', { class: 'grow', style: { gap: '8px' } },
            h('h2', { style: { 'font-size': '14px' } }, 'Theme'),
            themeSeg,
            h('p', { class: 'small' }, 'System follows your computer\'s light or dark setting.')),
          h('div', { class: 'grow', style: { gap: '10px' } },
            h('h2', { style: { 'font-size': '14px' } }, 'Accent color'),
            h('div', { class: 'swatches' }, SWATCHES.map((x) =>
              h('button', { type: 'button', class: 'swatch', 'aria-label': x.name, 'aria-pressed': String(!!sw && sw.hex === x.hex), style: { background: x.hex }, onclick: async () => { await saveSettings({ accent: x.hex }); render(); } }))),
            h('div', { class: 'small' }, sw ? sw.name + ' · ' + sw.hex : 'Custom · ' + String(s.accent).toUpperCase()),
            h('div', { class: 'row', style: { gap: '8px' } }, h('label', { for: 'custom-hex', class: 'small', style: { color: '#3a3a3c' } }, 'Custom'), hex)),
          h('p', { class: 'small', style: { 'padding-top': '14px', 'border-top': '1px solid #eceae6' } }, 'Applies to the picker, the variable bar and the editor on every site.')),
        h('section', { class: 'ap-preview' },
          h('div', { class: 'row', style: { gap: '12px' } }, h('h2', { style: { 'font-size': '14px' } }, 'Preview'),
            h('span', { class: 'small' }, s.theme === 'system' ? 'System is ' + resolved + ' right now' : 'Try it: type, use ↑ ↓ and ↵'),
            screenSeg),
          stage))
    ];
  }

  // ---------- Shortcut & sites ----------
  function stopRecording() {
    if (recording) recording.cleanup();
    recording = null;
  }
  function record(onDone, el) {
    stopRecording();
    const key = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop(null);
      if (PM.isModifierKey(e.key)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (el) el.setAttribute('data-hint', 'Use Ctrl, Alt or ' + (PM.isMac ? '⌘' : 'Win') + ' with a key');
        return;
      }
      stop(PM.shortcutFromEvent(e));
    };
    const stop = (sc) => {
      stopRecording();
      onDone(sc);
    };
    window.addEventListener('keydown', key, true);
    recording = { cleanup: () => window.removeEventListener('keydown', key, true) };
  }

  function renderSites() {
    const s = state.settings;
    const scBox = h('div', { class: 'keys-wrap' }, keycaps(s.shortcut));
    const recBtn = h('button', { type: 'button', class: 'btn' }, 'Record new shortcut');
    const recHint = h('p', { class: 'small', hidden: true }, 'Press the new shortcut… (esc cancels)');
    recBtn.addEventListener('click', () => {
      scBox.classList.add('recording');
      recBtn.textContent = 'Listening…';
      recHint.hidden = false;
      record(async (sc) => {
        if (sc) await saveSettings({ shortcut: sc });
        render();
      }, recHint);
    });
    const isDefault = PM.sameShortcut(s.shortcut, PM.DEFAULT_SHORTCUT);

    const siteRow = (site, idx) => {
      const eff = site.shortcut || s.shortcut;
      const conflict = PM.KNOWN_CONFLICTS[site.host];
      const hasConflict = !!conflict && PM.sameShortcut(eff, PM.DEFAULT_SHORTCUT);
      const scBtn = h('button', { type: 'button', class: 'sc-btn' + (hasConflict || (conflict && site.shortcut) ? ' conflict' : ''), title: 'Click to set a shortcut for this site only' },
        PM.shortcutLabel(eff, true) + (conflict ? '  ⚠' : ''));
      scBtn.addEventListener('click', () => {
        scBtn.classList.add('rec');
        scBtn.textContent = 'Press keys…';
        record(async (sc) => {
          if (sc) await updateSite(idx, { shortcut: PM.sameShortcut(sc, s.shortcut) ? null : sc });
          render();
        });
      });
      const reset = site.shortcut ? h('button', { type: 'button', class: 'btn quiet', style: { height: '24px', 'font-size': '12px' }, onclick: async () => { await updateSite(idx, { shortcut: null }); render(); } }, 'reset') : null;
      return h('div', { class: 'tr' + (conflict ? ' warn' : '') },
        h('span', { class: 'site', title: site.host }, site.host),
        site.target ? h('span', { class: 'target mono', title: site.target }, site.target) : h('span', { class: 'target' + (site.builtin ? '' : ' mono') }, site.builtin ? 'Message composer' : 'any text field'),
        h('span', { class: site.builtin ? 'target' : 'custom' }, site.builtin ? 'Built-in' : 'Custom'),
        h('span', { style: { display: 'flex', 'align-items': 'center', gap: '2px' } }, scBtn, reset),
        switchEl(site.enabled !== false, 'Use Prolly on ' + site.host, async () => {
          const on = site.enabled === false;
          if (on && !site.builtin) {
            const origins = PM.sitePatterns(site.host);
            // Called straight from the click (Firefox requires it); resolves true at once if access is already there.
            if (!(await ext.permissions.request({ origins }).catch(() => false))) return;
          }
          await updateSite(idx, { enabled: on });
          render();
        }, true),
        site.builtin ? h('span') : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + site.host, title: 'Remove', onclick: async () => {
          const sites = state.settings.sites.filter((x, i) => i !== idx);
          await saveSettings({ sites });
          ext.permissions.remove({ origins: PM.sitePatterns(site.host) }).catch(() => {});
          render();
        } }, PM.icon('trash', 16)));
    };

    const conflicts = s.sites.filter((x) => PM.KNOWN_CONFLICTS[x.host]);
    const addWrap = h('div');
    const showAdd = () => {
      const inp = h('input', { class: 'input', type: 'text', placeholder: 'example.com or a page address', 'aria-label': 'Site to add' });
      const msg = h('span', { class: 'err', role: 'alert' });
      const go = async () => {
        const host = PM.normHost(inp.value);
        if (!host) {
          msg.textContent = 'Enter a site like linear.app';
          return;
        }
        if (s.sites.some((x) => x.host === host)) {
          msg.textContent = host + ' is already in the list.';
          return;
        }
        const origins = PM.sitePatterns(host);
        // Nothing is awaited before permissions.request(): Firefox only prompts straight from the click.
        // The background script finishes this in permissions.onAdded (the page may lose focus to the dialog).
        const had = ext.permissions.contains({ origins }).catch(() => false);
        const pending = ext.storage.local.set({ _pendingSite: { host, openTab: true, at: Date.now() } });
        const ok = await ext.permissions.request({ origins }).catch(() => false);
        await pending;
        if (!ok) {
          await ext.storage.local.remove('_pendingSite');
          msg.textContent = 'Prolly needs access to ' + host + ' to work there.';
          return;
        }
        // Access was already there, so permissions.onAdded will not fire: finish here.
        if (await had) await ext.runtime.sendMessage({ type: 'pm:enableSite', host, openTab: true });
        state.flash = 'Added ' + host + '. A tab opened there — click the text area you want to use.';
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') addWrap.replaceChildren(); });
      addWrap.replaceChildren(h('div', { class: 'addform' }, inp,
        h('button', { type: 'button', class: 'btn dark', onclick: go }, 'Add and pick text area'),
        h('button', { type: 'button', class: 'btn quiet', onclick: () => addWrap.replaceChildren() }, 'Cancel'), msg));
      inp.focus();
    };

    const flash = state.flash ? h('p', { class: 'okmsg', role: 'status' }, state.flash) : null;
    state.flash = null;

    return [
      h('h1', null, 'Shortcut & sites'),
      h('section', { class: 'card' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h2', null, 'Open the prompt picker'), h('p', { class: 'sub' }, 'Works while the cursor is in any supported text area.')),
          scBox,
          recBtn,
          isDefault ? null : h('button', { type: 'button', class: 'btn quiet', onclick: async () => { await saveSettings({ shortcut: PM.DEFAULT_SHORTCUT }); render(); } }, 'Reset')),
        recHint,
        h('div', { class: 'note' }, h('b', null, 'Why ' + PM.shortcutLabel(PM.DEFAULT_SHORTCUT)),
          h('span', null, 'One hand, no Shift, nothing typed into the text area, and ' + PM.BROWSER + ' leaves it free. Most AI chats keep their shortcuts on ⌘/Ctrl + K, /, Shift and Enter. Mac users get Control + ; rather than ⌘ + ;, because ⌘ shortcuts are the ones apps tend to claim.')),
        h('div', { class: 'row', style: { 'padding-top': '2px' } },
          h('div', { class: 'grow' },
            h('span', { style: { 'font-size': '14px', 'font-weight': '500' } }, 'Also open when I type ', h('span', { class: 'mono', style: { background: '#f1f0ed', 'border-radius': '4px', padding: '1px 5px' } }, ';;')),
            h('span', { class: 'small' }, 'For sites that eat the shortcut. The two characters are removed when the picker opens.')),
          switchEl(s.typedTrigger, 'Typed trigger', async () => { await saveSettings({ typedTrigger: !s.typedTrigger }); render(); }))),
      h('section', { class: 'card' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h2', null, 'Sites'),
            h('p', { class: 'sub' }, 'Built-in sites work out of the box. Add any other page: click ', h('b', null, 'Add a site'), ', then click the text area you want to use. Click a shortcut to change it for one site.')),
          h('button', { type: 'button', class: 'btn dark', onclick: showAdd }, '+ Add a site')),
        addWrap,
        flash,
        h('div', { class: 'table' },
          h('div', { class: 'tr th' }, h('span', null, 'Site'), h('span', null, 'Text area'), h('span', null, 'Source'), h('span', null, 'Shortcut'), h('span', null, 'On'), h('span')),
          s.sites.map(siteRow)),
        conflicts.map((x) => h('p', { class: 'warn-text' }, '⚠ ' + PM.KNOWN_CONFLICTS[x.host] + ', so ' + x.host + ' gets its own shortcut here.')),
        h('p', { class: 'small' }, 'Tip: on any page, click the Prolly button in the toolbar to turn it on for that site or choose a different text area.'))
    ];
  }
  async function updateSite(idx, patch) {
    const sites = state.settings.sites.map((x, i) => (i === idx ? Object.assign({}, x, patch) : x));
    await saveSettings({ sites });
  }

  // ---------- Sync & backup ----------
  function renderSync() {
    const u = state.usage || { bytes: 0, quota: PM.store.SYNC_QUOTA };
    const pct = Math.min(100, Math.round((u.bytes / u.quota) * 100));
    const lastEdit = state.prompts.reduce((m, p) => Math.max(m, p.u || 0), 0);
    const msg = h('p', { class: 'small', role: 'status' });
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const res = await PM.store.importData(JSON.parse(await f.text()));
        state.flash = 'Imported: ' + res.added + ' new, ' + res.updated + ' updated, ' + res.skipped + ' already there.';
        await refresh();
      } catch (e) {
        msg.className = 'err';
        msg.textContent = (e && e.message) || 'Could not read that file.';
      }
      file.value = '';
    });
    const exportJson = async () => {
      const data = await PM.store.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'prolly-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const toggleSync = async () => {
      try {
        await PM.store.setSyncOn(!state.sync);
        await refresh();
      } catch (e) {
        msg.className = 'err';
        msg.textContent = (e && e.message) || String(e);
      }
    };
    if (state.flash) {
      msg.className = 'okmsg';
      msg.textContent = state.flash;
      state.flash = null;
    }
    const n = state.prompts.length;
    return [
      h('h1', null, 'Sync & backup'),
      h('section', { class: 'card' },
        h('div', { class: 'row', style: { 'align-items': 'flex-start' } },
          h('div', { class: 'grow', style: { gap: '4px' } },
            h('div', { class: 'row', style: { gap: '8px' } }, h('h2', null, 'Sync with ' + PM.BROWSER), h('span', { class: 'pill free' }, 'Free')),
            h('p', { class: 'sub', style: { 'max-width': '620px' } }, PM.isFirefox
              ? 'Your prompts follow your Mozilla account to every computer where you\'re signed in to Firefox with Add-ons turned on in Sync. Nothing to set up.'
              : 'Your prompts follow your Chrome profile to every computer where you\'re signed in to Chrome with sync on. Nothing to set up.')),
          switchEl(state.sync, 'Sync with ' + PM.BROWSER, toggleSync)),
        h('div', { class: 'grow', style: { gap: '8px' } },
          h('div', { class: 'row', style: { 'justify-content': 'space-between', 'font-size': '13px' } },
            h('span', null, h('b', null, n + (n === 1 ? ' prompt' : ' prompts')), ' · ' + PM.formatBytes(u.bytes) + ' of ' + PM.formatBytes(u.quota) + (state.sync ? '' : ' (this computer only)')),
            h('span', { style: { color: 'var(--ok)' } }, lastEdit ? '✓ Saved · last edit ' + PM.timeAgo(lastEdit) : '')),
          h('div', { class: 'meter' + (pct > 90 ? ' full' : '') }, h('div', { style: { width: pct + '%' } })),
          h('p', { class: 'small' }, state.sync
            ? PM.BROWSER + ' gives each extension 100 KB of synced space — a few hundred typical prompts. Long prompts are split into pieces automatically.'
            : 'Sync is off: prompts are kept on this computer only. Turn it on to copy them into ' + PM.SYNC_NAME + '.')),
        h('div', { class: 'note' }, h('b', null, 'Edited on two computers?'), h('span', null, 'The latest edit wins, and the other version is kept as “Title (copy)” so nothing is lost.'))),
      h('section', { class: 'card' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h2', null, 'Backup'), h('p', { class: 'sub' }, 'Save all prompts as one JSON file, or load a file to merge it into your library.')),
          h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Import…'),
          h('button', { type: 'button', class: 'btn dark', onclick: exportJson }, 'Export JSON'),
          file),
        msg),
      h('section', { class: 'card dashed' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' },
            h('div', { class: 'row', style: { gap: '8px' } }, h('h2', { style: { 'font-size': '14px' } }, 'Need more room?'), h('span', { class: 'pill later' }, 'Later')),
            h('p', { class: 'sub' }, 'Sync through a hidden folder in your own Google Drive. Still free, far more space.')),
          h('button', { type: 'button', class: 'btn', disabled: true }, 'Connect Google Drive')))
    ];
  }

  // ---------- Boot ----------
  async function refresh() {
    await load();
    const a = document.activeElement;
    const typing = a && main.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && state.section !== 'library';
    if (!typing && !recording) render();
  }

  window.addEventListener('hashchange', () => {
    setSection();
    render();
    main.focus({ preventScroll: true });
  });
  let pending = 0;
  PM.store.onChanged(() => {
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    PM.applyTheme(layer, state.settings);
    if (state.section === 'appearance') render();
  });

  (async () => {
    setSection();
    await load();
    render();
  })();
})();
