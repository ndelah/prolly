// Runs on supported sites. Opens the picker with the shortcut (or ";;"), inserts prompts into the
// focused text box, shows the variable bar, the editor, and the "pick a text area" mode.
(function () {
  'use strict';
  if (window.__pmPromptsLoaded) return;
  window.__pmPromptsLoaded = true;
  const PM = globalThis.PM;
  const h = PM.h;

  let settings = null;
  let site = null;
  let host = null, shadow = null, layer = null;
  let cur = null; // { kind: 'picker' | 'fill' | 'editor', comp, panel, anchor }
  let ctx = null; // the site's text box we insert into
  let toast = null, toastTimer = 0, toastAnchor = null;
  let pick = null;
  let lastEditable = null;
  let openSeq = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ready = refresh();

  async function refresh() {
    try {
      settings = await PM.store.getSettings();
    } catch (e) {
      return; // extension was reloaded; this copy of the script is orphaned
    }
    site = settings.sites.find((s) => PM.hostMatches(location.hostname, s.host)) || null;
    if (layer) PM.applyTheme(layer, settings);
  }
  try {
    PM.store.onChanged(() => refresh());
  } catch (e) { /* orphaned */ }
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => layer && PM.applyTheme(layer, settings));
  }

  const activeHere = () => !!(settings && site && site.enabled !== false);
  const shortcut = () => (site && site.shortcut) || (settings && settings.shortcut) || PM.DEFAULT_SHORTCUT;

  // ---------- Text boxes ----------
  const TEXT_TYPES = /^(text|search|email|url|tel|)$/;
  const EDITABLE_SEL = 'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  function isTextField(el) {
    return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.test((el.getAttribute('type') || '').toLowerCase()))) && !el.disabled && !el.readOnly;
  }
  function ceRoot(el) {
    let n = el;
    while (n.parentElement && n.parentElement.isContentEditable) n = n.parentElement;
    return n;
  }
  function editableOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || (host && el === host)) return null;
    if (isTextField(el)) return el;
    if (el.isContentEditable) return ceRoot(el);
    return null;
  }
  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function targetOk(el) {
    if (!site || !site.target) return true;
    try {
      return !!(el.matches(site.target) || el.closest(site.target) || el.querySelector(site.target));
    } catch (e) {
      return true;
    }
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 10 && r.bottom > 0 && r.top < innerHeight;
  }
  function findComposer() {
    if (lastEditable && lastEditable.isConnected && visible(lastEditable) && targetOk(lastEditable)) return lastEditable;
    if (site && site.target) {
      try {
        const t = document.querySelector(site.target);
        const el = t && (editableOf(t) || editableOf(t.querySelector(EDITABLE_SEL)));
        if (el && visible(el)) return el;
      } catch (e) { /* bad selector */ }
    }
    let best = null, area = 0;
    document.querySelectorAll(EDITABLE_SEL).forEach((n) => {
      const el = editableOf(n);
      if (!el || !visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > area) {
        area = r.width * r.height;
        best = el;
      }
    });
    return best;
  }

  function captureCtx(el) {
    if (isTextField(el)) {
      const len = el.value.length;
      return { el, kind: 'text', start: el.selectionStart == null ? len : el.selectionStart, end: el.selectionEnd == null ? len : el.selectionEnd };
    }
    const sel = document.getSelection();
    let range = null;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer)) range = r.cloneRange();
    }
    return { el, kind: 'ce', range };
  }
  function restoreFocus(c) {
    if (!c || !c.el || !c.el.isConnected) return;
    c.el.focus({ preventScroll: true });
    if (c.kind === 'text') {
      try {
        c.el.setSelectionRange(c.start, c.end);
      } catch (e) { /* some inputs do not support selection */ }
    } else if (c.range && c.range.startContainer.isConnected && c.el.contains(c.range.startContainer)) {
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(c.range);
    }
  }
  function setNativeValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Insert text where the caret was. Returns { start, len } for plain text fields.
  async function insertText(c, text) {
    restoreFocus(c);
    await sleep(20);
    const el = c.el;
    if (c.kind === 'text') {
      const before = el.value;
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (e) { /* fall back below */ }
      if (!ok || el.value.slice(c.start, c.start + text.length) !== text) {
        setNativeValue(el, before.slice(0, c.start) + text + before.slice(c.end));
        try {
          el.setSelectionRange(c.start + text.length, c.start + text.length);
        } catch (e) { /* ignore */ }
      }
      return { start: c.start, len: text.length, last: text };
    }
    // Rich editors (ProseMirror, Quill, Lexical…) handle paste events best, newlines included.
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    el.dispatchEvent(ev);
    if (!ev.defaultPrevented) {
      try {
        document.execCommand('insertText', false, text);
      } catch (e) { /* nothing else to try */ }
    }
    return null;
  }

  function replaceSpan(el, span, text) {
    if (!span || span.dead) return;
    let start = span.start;
    if (el.value.substr(start, span.len) !== span.last) {
      start = el.value.indexOf(span.last);
      if (start < 0) {
        span.dead = true;
        return;
      }
    }
    setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(start + span.len));
    span.start = start;
    span.len = text.length;
    span.last = text;
  }

  // ---------- Overlay host ----------
  function mount() {
    if (host && host.isConnected) return;
    if (!host) {
      host = document.createElement('prompts-ext-ui');
      const st = host.style;
      [['all', 'initial'], ['position', 'fixed'], ['top', '0'], ['left', '0'], ['width', '0'], ['height', '0'], ['z-index', '2147483647'], ['display', 'block']].forEach(([k, v]) => st.setProperty(k, v, 'important'));
      shadow = host.attachShadow({ mode: 'closed' });
      PM.adoptCSS(shadow);
      layer = document.createElement('div');
      layer.className = 'pm-ui pm-root';
      shadow.appendChild(layer);
      // Keep our clipboard / input / focus events from reaching the page's own handlers.
      ['paste', 'copy', 'cut', 'beforeinput', 'input', 'focusin', 'focusout', 'mousedown', 'mouseup', 'click', 'pointerup', 'wheel'].forEach((t) =>
        host.addEventListener(t, (e) => e.stopPropagation()));
    }
    (document.documentElement || document.body).appendChild(host);
    PM.applyTheme(layer, settings);
  }

  // sheet: centered on the page over a light scrim, wherever the site's text box happens to be.
  function show(kind, comp, anchor, sheet) {
    mount();
    const panel = comp.el;
    let scrim = null;
    if (kind !== 'editor') panel.classList.add('pm-float');
    if (sheet) {
      scrim = h('div', { class: 'pm-scrim' });
      scrim.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (kind === 'picker') comp.o.onClose();
        else if (kind === 'fill') comp.done();
      });
      layer.appendChild(scrim);
    }
    layer.appendChild(panel);
    cur = { kind, comp, panel, anchor, scrim, sheet: !!sheet };
    position();
  }
  function closeUI() {
    if (!cur) return;
    cur.panel.remove();
    if (cur.scrim) cur.scrim.remove();
    cur = null;
  }
  function placeSheet(panel, kind) {
    const vw = innerWidth, vh = innerHeight;
    const width = Math.min(kind === 'picker' ? 600 : 680, vw - 24);
    panel.style.width = width + 'px';
    panel.style.left = Math.round((vw - width) / 2) + 'px';
    panel.style.bottom = 'auto';
    if (kind === 'picker') {
      // Top edge sits where a full-height picker is centered, so the search box stays put while results shrink.
      const top = Math.max(12, Math.round((vh - Math.min(560, vh - 24)) / 2));
      panel.style.top = top + 'px';
      panel.style.maxHeight = vh - top - 12 + 'px';
    } else {
      panel.style.maxHeight = vh - 24 + 'px';
      panel.style.top = Math.max(12, Math.round((vh - panel.offsetHeight) / 2)) + 'px';
    }
  }

  // The visible composer box around the text area: chat sites put the editable inside a larger
  // rounded card with buttons, so center on that card rather than on the editable itself.
  const boxCache = new WeakMap();
  function visualBox(el) {
    const hit = boxCache.get(el);
    if (hit && hit.isConnected) return hit;
    const r0 = el.getBoundingClientRect();
    let best = el;
    let n = el.parentElement;
    for (let i = 0; n && i < 8 && n !== document.body && n !== document.documentElement; i++, n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.width > innerWidth * 0.96 || r.width > r0.width + 420 || r.height > r0.height + 320) break;
      const cs = getComputedStyle(n);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const painted = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        parseFloat(cs.borderTopWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none');
      if (radius >= 8 && painted) best = n;
    }
    boxCache.set(el, best);
    return best;
  }
  function anchorRect(el) {
    const vw = innerWidth, vh = innerHeight;
    const r = el && el.isConnected ? visualBox(el).getBoundingClientRect() : null;
    if (!r || (r.width === 0 && r.height === 0)) return { left: Math.max(12, (vw - 600) / 2), top: vh * 0.6, bottom: vh * 0.6, width: 600 };
    return r;
  }
  const centeredLeft = (r, width) => Math.min(Math.max(r.left + (r.width - width) / 2, 12), innerWidth - width - 12);
  function placeNear(panel, el, mode) {
    const vw = innerWidth, vh = innerHeight;
    const r = anchorRect(el);
    const want = mode === 'bar' ? Math.min(Math.max(r.width, 480), 760) : 600;
    const width = Math.min(want, vw - 24);
    panel.style.width = width + 'px';
    panel.style.left = centeredLeft(r, width) + 'px';
    const above = r.top - 22;
    const below = vh - r.bottom - 22;
    if (above < 240 && below < 240) {
      panel.style.bottom = 'auto';
      panel.style.top = '12px';
      panel.style.maxHeight = vh - 24 + 'px';
    } else if (above >= 240 || above >= below) {
      panel.style.top = 'auto';
      panel.style.bottom = vh - Math.max(r.top, 12) + 10 + 'px';
      panel.style.maxHeight = above + 'px';
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = r.bottom + 10 + 'px';
      panel.style.maxHeight = below + 'px';
    }
  }
  function position() {
    if (cur && cur.sheet) placeSheet(cur.panel, cur.kind);
    else if (cur && cur.kind !== 'editor') placeNear(cur.panel, cur.anchor, cur.kind === 'fill' ? 'bar' : 'picker');
    if (toast) placeToast();
  }
  window.addEventListener('resize', position);
  window.addEventListener('scroll', () => (cur || toast) && position(), true);

  function placeToast() {
    const r = anchorRect(toastAnchor);
    toast.style.left = centeredLeft(r, toast.offsetWidth || 300) + 'px';
    if (r.top > 60) {
      toast.style.top = 'auto';
      toast.style.bottom = innerHeight - r.top + 10 + 'px';
    } else {
      toast.style.bottom = 'auto';
      toast.style.top = r.bottom + 10 + 'px';
    }
  }
  function showToast(anchor, parts, action) {
    hideToast();
    mount();
    toastAnchor = anchor;
    toast = h('div', { class: 'pm-toast', role: 'status' }, h('span', { class: 'pm-ok' }, '✓'), h('span', null, parts), action ? h('button', { type: 'button', onclick: action.run }, action.label) : null);
    layer.appendChild(toast);
    placeToast();
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    if (toast) toast.remove();
    toast = null;
  }
  // ---------- Picker / variables / editor ----------
  async function openPicker(el, opts) {
    opts = opts || {};
    await ready;
    hideToast();
    closeUI();
    if (!(opts.keepCtx && ctx && ctx.el === el)) ctx = captureCtx(el);
    lastEditable = el;
    const my = ++openSeq;
    let prompts = [], recent = [];
    try {
      [prompts, recent] = await Promise.all([PM.store.loadPrompts(), PM.store.getRecent()]);
    } catch (e) {
      return;
    }
    if (my !== openSeq) return;
    const picker = new PM.Picker({
      prompts, recent, selectId: opts.selectId,
      shortcutLabel: PM.shortcutLabel(shortcut(), true),
      onInsert: (p) => startInsert(p),
      onEdit: (p, preset) => openEditor(p, preset),
      onClose: () => {
        closeUI();
        restoreFocus(ctx);
      }
    });
    show('picker', picker, el, true);
    picker.focus();
  }

  async function startInsert(p) {
    PM.store.pushRecent(p.id).catch(() => {});
    closeUI();
    const c = ctx;
    if (!c || !c.el.isConnected) return;
    const defs = PM.tpl.parse(p.text).defs;
    if (!defs.length) {
      await insertText(c, p.text);
      return;
    }
    const inPlace = c.kind === 'text';
    let span = null;
    const bar = new PM.FillBar({
      prompt: p,
      showPreview: !inPlace,
      onChange: (text) => inPlace && replaceSpan(c.el, span, text),
      onDone: async (text) => {
        closeUI();
        if (inPlace) {
          c.el.focus({ preventScroll: true });
          if (span && !span.dead) {
            try {
              c.el.setSelectionRange(span.start + span.len, span.start + span.len);
            } catch (e) { /* ignore */ }
          }
        } else {
          await insertText(c, text);
        }
      }
    });
    if (inPlace) span = await insertText(c, bar.text());
    show('fill', bar, c.el, !inPlace);
    bar.focusFirst();
  }

  async function openEditor(p, preset) {
    closeUI();
    const my = ++openSeq;
    let prompts = [];
    try {
      prompts = await PM.store.loadPrompts();
    } catch (e) { /* use empty suggestions */ }
    if (my !== openSeq) return;
    const back = (selectId) => {
      closeUI();
      const el = ctx && ctx.el && ctx.el.isConnected ? ctx.el : findComposer();
      if (el) openPicker(el, { selectId, keepCtx: true });
    };
    const ed = new PM.Editor({
      prompt: p, preset, prompts,
      onSave: async (data) => {
        const saved = await PM.store.savePrompt(Object.assign({}, p || {}, data));
        back(saved.id);
      },
      onDelete: async (id) => {
        await PM.store.deletePrompt(id);
        back();
      },
      onCancel: () => back()
    });
    show('editor', ed, null);
    ed.focus();
  }

  // ---------- Pick a text area ----------
  function stableClasses(el) {
    return [...el.classList].filter((c) => /^[A-Za-z][\w-]{1,40}$/.test(c) && !/\d{3,}|^(css|sc|jsx|svelte|emotion|tw)-|__[a-z0-9]{5,}$/i.test(c)).slice(0, 2);
  }
  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{4,}/.test(el.id)) {
      const s = '#' + CSS.escape(el.id);
      if (document.querySelectorAll(s).length === 1) return s;
    }
    const part = (n) => {
      let s = n.tagName.toLowerCase() + stableClasses(n).map((c) => '.' + CSS.escape(c)).join('');
      const name = n.getAttribute('name');
      if (name && /^[\w-]{1,40}$/.test(name)) s += '[name="' + name + '"]';
      if (n.hasAttribute('contenteditable')) s += '[contenteditable]';
      return s;
    };
    let sel = part(el);
    let n = el.parentElement;
    for (let i = 0; i < 3 && n && document.querySelectorAll(sel).length > 1; i++, n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && !/\d{4,}/.test(n.id)) {
        sel = '#' + CSS.escape(n.id) + ' ' + sel;
        break;
      }
      const cls = stableClasses(n);
      if (cls.length) sel = n.tagName.toLowerCase() + cls.map((c) => '.' + CSS.escape(c)).join('') + ' ' + sel;
    }
    try {
      if (!el.matches(sel)) return null;
    } catch (e) {
      return null;
    }
    return sel;
  }
  function candidateAt(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    for (const n of path) {
      const el = editableOf(n);
      if (el) return el;
    }
    for (const n of path.slice(0, 5)) {
      if (n && n.querySelector) {
        const c = n.querySelector(EDITABLE_SEL);
        const el = c && editableOf(c);
        if (el && visible(el)) return el;
      }
    }
    return null;
  }

  async function startPick() {
    await ready;
    if (pick) return;
    closeUI();
    hideToast();
    mount();
    const box = h('div', { class: 'pm-pickbox', hidden: true });
    const banner = h('div', { class: 'pm-panel pm-banner', role: 'dialog', 'aria-label': 'Choose a text area' },
      h('span', { class: 'pm-logo' }, '#'),
      h('span', null, 'Click the text area you want to use with Prolly'),
      h('button', { type: 'button', class: 'pm-btn', onclick: () => endPick(null, true) }, 'Use any text field'),
      h('span', { class: 'pm-kbd-chip' }, 'esc'));
    layer.append(box, banner);
    const outside = (e) => e.target !== host;
    const move = (e) => {
      if (!outside(e)) return;
      const el = candidateAt(e);
      if (!el) {
        box.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
      box.hidden = false;
    };
    const block = (e) => {
      if (!outside(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const click = (e) => {
      if (!outside(e)) return;
      block(e);
      const el = candidateAt(e);
      if (el) endPick(el, true);
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        block(e);
        endPick(null, true);
      }
    };
    window.addEventListener('pointermove', move, true);
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((t) => window.addEventListener(t, block, true));
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    pick = {
      cleanup() {
        window.removeEventListener('pointermove', move, true);
        ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((t) => window.removeEventListener(t, block, true));
        window.removeEventListener('click', click, true);
        window.removeEventListener('keydown', key, true);
        box.remove();
        banner.remove();
      }
    };
  }

  async function endPick(el, save) {
    if (!pick) return;
    pick.cleanup();
    pick = null;
    if (!save) return;
    const target = el ? selectorFor(el) : null;
    try {
      const s = await PM.store.getSettings();
      const sites = s.sites.slice();
      let i = sites.findIndex((x) => PM.hostMatches(location.hostname, x.host));
      if (i < 0) {
        sites.push(PM.store.newSite(PM.normHost(location.hostname)));
        i = sites.length - 1;
      }
      sites[i] = Object.assign({}, sites[i], { target, enabled: true });
      await PM.store.saveSettings({ sites });
      await refresh();
    } catch (e) {
      showToast(el, 'Could not save: ' + ((e && e.message) || e));
      return;
    }
    const label = PM.shortcutLabel(shortcut());
    if (el) {
      el.focus({ preventScroll: true });
      showToast(el, 'Prolly will open in this text area. Press ' + label + ' to try it.');
    } else {
      showToast(findComposer(), 'Prolly works in any text field on this site. Press ' + label + ' in one to try it.');
    }
  }

  // ---------- Global listeners ----------
  // Registered at document_start, so this runs before the page's own key handlers.
  window.addEventListener('keydown', (e) => {
    if (host && e.target === host) {
      if (cur && cur.comp.handleKey) {
        if (cur.kind === 'picker' && PM.shortcutMatches(e, shortcut())) {
          e.preventDefault();
          closeUI();
          restoreFocus(ctx);
        } else cur.comp.handleKey(e);
      }
      e.stopImmediatePropagation();
      return;
    }
    if (pick || !activeHere() || e.isComposing) return;
    if (!PM.shortcutMatches(e, shortcut())) return;
    const el = editableOf(e.composedPath ? e.composedPath()[0] : e.target) || editableOf(deepActive());
    if (!el || !targetOk(el)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPicker(el);
  }, true);
  ['keyup', 'keypress'].forEach((t) =>
    window.addEventListener(t, (e) => {
      if (host && e.target === host) e.stopImmediatePropagation();
    }, true));

  // Typed trigger: ";;"
  document.addEventListener('input', (e) => {
    if (!activeHere() || !settings.typedTrigger || (host && e.target === host)) return;
    if (e.inputType !== 'insertText' || typeof e.data !== 'string' || e.data.slice(-1) !== ';') return;
    const el = editableOf(e.composedPath ? e.composedPath()[0] : e.target);
    if (!el || !targetOk(el)) return;
    let before = '';
    if (isTextField(el)) {
      const i = el.selectionStart || 0;
      before = el.value.slice(Math.max(0, i - 2), i);
    } else {
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      const r = document.createRange();
      r.selectNodeContents(el);
      r.setEnd(sel.anchorNode, sel.anchorOffset);
      before = r.toString().slice(-2);
    }
    if (before !== ';;') return;
    setTimeout(() => {
      let ok = false;
      try {
        ok = document.execCommand('delete') && document.execCommand('delete');
      } catch (err) { /* fall back below */ }
      if (!ok && isTextField(el)) {
        const i = el.selectionStart || 0;
        setNativeValue(el, el.value.slice(0, i - 2) + el.value.slice(i));
        el.setSelectionRange(i - 2, i - 2);
      }
      openPicker(el);
    }, 0);
  }, true);

  document.addEventListener('focusin', (e) => {
    const el = editableOf(e.composedPath ? e.composedPath()[0] : e.target);
    if (el) lastEditable = el;
  }, true);

  window.addEventListener('pointerdown', (e) => {
    if (pick || (host && e.target === host)) return;
    if (toast) hideToast();
    if (!cur) return;
    if (cur.kind === 'picker') {
      openSeq++;
      closeUI();
    } else if (cur.kind === 'fill') cur.comp.done();
  }, true);

  ext.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || typeof msg.type !== 'string' || msg.type.slice(0, 3) !== 'pm:') return;
    (async () => {
      await ready;
      if (msg.type === 'pm:ping') return { ok: true, active: activeHere(), host: location.hostname, target: (site && site.target) || null };
      if (msg.type === 'pm:open') {
        if (!activeHere()) return { ok: false, reason: 'Prolly is turned off for this site.' };
        const el = findComposer();
        if (!el) return { ok: false, reason: 'No text area found on this page. Click into one and press ' + PM.shortcutLabel(shortcut()) + '.' };
        el.focus({ preventScroll: true });
        openPicker(el);
        return { ok: true };
      }
      if (msg.type === 'pm:pickTarget') {
        startPick();
        return { ok: true };
      }
      return { ok: false };
    })().then(respond, () => respond({ ok: false }));
    return true;
  });

  ready.then(() => {
    if (activeHere()) ext.runtime.sendMessage({ type: 'pm:active' }).catch(() => {});
  });
})();
