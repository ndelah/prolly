// Shared helpers: DOM builder, icons, shortcuts, small utilities.
// Loaded in the content script, extension pages and the background script.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.h) return;

  // Extension API: Firefox's promise-based `browser`, else Chrome's `chrome`. Every file calls `ext.*`.
  const ext = (globalThis.ext = globalThis.ext || globalThis.browser || globalThis.chrome);
  // The Firefox build's manifest carries browser_specific_settings; the Chrome one does not.
  PM.isFirefox = !!(ext && ext.runtime && ext.runtime.getManifest && ext.runtime.getManifest().browser_specific_settings);
  PM.BROWSER = PM.isFirefox ? 'Firefox' : 'Chrome';
  PM.SYNC_NAME = PM.isFirefox ? 'Firefox Sync' : 'Chrome sync';

  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  PM.isMac = /mac|iphone|ipad/i.test(plat);

  // ---- DOM builder (no innerHTML anywhere, so it is safe on any host page) ----
  PM.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') for (const s of Object.keys(v)) el.style.setProperty(s, v[s]);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value' || k === 'checked' || k === 'tabIndex' || k === 'disabled' || k === 'hidden' || k === 'readOnly') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    PM.append(el, kids);
    return el;
  };
  PM.append = function (el, kids) {
    for (const k of [kids].flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    }
    return el;
  };

  const ICONS = {
    search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M20 20l-3.5-3.5' }]],
    folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
    tag: [['path', { d: 'M3 12V4h8l10 10-8 8z' }], ['circle', { cx: 7.5, cy: 8.5, r: 1.2 }]],
    more: [['path', { d: 'M4 12h16M14 6l6 6-6 6' }]],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
    x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    trash: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }]],
    enter: [['path', { d: 'M19 5v6a3 3 0 0 1-3 3H6' }], ['path', { d: 'M10 10l-4 4 4 4' }]],
    right: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
    backspace: [['path', { d: 'M21 5H9l-6 7 6 7h12z' }], ['path', { d: 'M12 9.5l5 5M17 9.5l-5 5' }]]
  };
  PM.icon = function (name, size, stroke) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const s = String(size || 16);
    const attrs = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': String(stroke || 2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
    for (const k in attrs) svg.setAttribute(k, attrs[k]);
    for (const [t, a] of ICONS[name] || []) {
      const n = document.createElementNS(NS, t);
      for (const k in a) n.setAttribute(k, String(a[k]));
      svg.appendChild(n);
    }
    return svg;
  };

  // ---- Keyboard shortcuts ----
  PM.DEFAULT_SHORTCUT = { ctrl: true, alt: false, shift: false, meta: false, key: ';', code: 'Semicolon' };
  const CODE_LABELS = {
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: '↵', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→'
  };
  PM.keyLabel = function (sc) {
    const c = sc.code || '';
    if (CODE_LABELS[c]) return CODE_LABELS[c];
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^F\d+$/.test(c)) return c;
    const k = sc.key || '?';
    return k.length === 1 ? k.toUpperCase() : k;
  };
  PM.shortcutParts = function (sc) {
    sc = sc || PM.DEFAULT_SHORTCUT;
    const m = PM.isMac;
    const p = [];
    if (sc.ctrl) p.push(m ? '⌃' : 'Ctrl');
    if (sc.alt) p.push(m ? '⌥' : 'Alt');
    if (sc.shift) p.push(m ? '⇧' : 'Shift');
    if (sc.meta) p.push(m ? '⌘' : 'Win');
    p.push(PM.keyLabel(sc));
    return p;
  };
  PM.shortcutLabel = function (sc, compact) {
    return PM.shortcutParts(sc).join(compact ? ' ' : ' + ');
  };
  PM.shortcutMatches = function (e, sc) {
    if (!sc || e.repeat) return false;
    if (e.ctrlKey !== !!sc.ctrl || e.altKey !== !!sc.alt || e.shiftKey !== !!sc.shift || e.metaKey !== !!sc.meta) return false;
    if (sc.code && e.code === sc.code) return true;
    return !!sc.key && !sc.shift && !sc.alt && typeof e.key === 'string' && e.key.toLowerCase() === sc.key.toLowerCase();
  };
  PM.shortcutFromEvent = function (e) {
    return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: e.key, code: e.code };
  };
  PM.sameShortcut = function (a, b) {
    if (!a || !b) return false;
    return !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta && (a.code || a.key) === (b.code || b.key);
  };
  PM.isModifierKey = (k) => k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'OS' || k === 'AltGraph';

  // ---- Sites ----
  // Sites known to use Ctrl + ; themselves. They get their own shortcut by default.
  PM.KNOWN_CONFLICTS = {
    'docs.google.com': 'Google Sheets uses Ctrl + ; to insert the date'
  };
  PM.CONFLICT_SHORTCUT = { ctrl: true, alt: false, shift: true, meta: false, key: ':', code: 'Semicolon' };
  PM.normHost = function (input) {
    let s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    try { s = new URL(s.indexOf('://') >= 0 ? s : 'https://' + s).hostname; } catch (e) { return ''; }
    s = s.replace(/^www\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(s) || s.indexOf('..') >= 0) return '';
    if (s.indexOf('.') < 0 && s !== 'localhost') return '';
    return s;
  };
  PM.sitePatterns = function (host) {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return [isIp || host === 'localhost' ? '*://' + host + '/*' : '*://*.' + host + '/*'];
  };
  PM.hostMatches = function (hostname, siteHost) {
    return hostname === siteHost || hostname.endsWith('.' + siteHost);
  };

  // ---- Misc ----
  PM.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  PM.normFolder = function (s) {
    return String(s || '').split(/\s*(?:\/|›|>)\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 2).join('/');
  };
  PM.folderLabel = (f) => (f ? f.split('/').join(' › ') : '');
  PM.normTag = function (s) {
    return String(s || '').trim().replace(/^#+/, '').toLowerCase()
      .replace(/[^\p{L}\p{N}_.+-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  };
  PM.timeAgo = function (ts) {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  };
  PM.formatBytes = (b) => (b < 1024 ? b + ' B' : Math.round(b / 102.4) / 10 + ' KB');
})();
