// Prompts as Markdown files, one per prompt, for file-based sync (Google Drive now, GitHub later).
//
//   ---
//   id: "lq3k9x2abc"
//   title: "Code review"
//   folder: "Dev"
//   tags: ["review","code"]
//   defaults: {"language":"TypeScript"}
//   created: "2026-11-26T10:00:00.000Z"
//   updated: "2026-11-26T10:00:00.000Z"
//   ---
//   Review this #language# code…
//
// Values are written as JSON, which is also valid YAML, so Markdown and YAML tools read the files.
// The parser also takes the plain YAML a person might type: unquoted text, 'single quotes',
// `tags: a, b`, `[a, b]` and `- item` lists. A file without a header is all text, titled by its name.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.md) return;

  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const FRONT_RE = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;

  const iso = (t) => new Date(t).toISOString();
  function toMs(v) {
    const t = typeof v === 'number' ? v : Date.parse(String(v));
    return Number.isFinite(t) && t > 0 ? t : 0;
  }

  function serialize(p) {
    const lines = ['---', 'id: ' + JSON.stringify(p.id), 'title: ' + JSON.stringify(p.title || '')];
    if (p.folder) lines.push('folder: ' + JSON.stringify(p.folder));
    if (p.tags && p.tags.length) lines.push('tags: ' + JSON.stringify(p.tags));
    if (p.defaults && Object.keys(p.defaults).length) lines.push('defaults: ' + JSON.stringify(p.defaults));
    if (p.c) lines.push('created: ' + JSON.stringify(iso(p.c)));
    if (p.u) lines.push('updated: ' + JSON.stringify(iso(p.u)));
    lines.push('---');
    // The text ends with one extra newline (editors add one anyway); parse() takes it off again.
    return lines.join('\n') + '\n' + (p.text || '') + '\n';
  }

  function scalar(raw) {
    const s = raw.trim();
    if (!s) return '';
    if (/^["[{]/.test(s) || /^(-?\d+(\.\d+)?|true|false|null)$/.test(s)) {
      try {
        return JSON.parse(s);
      } catch (e) { /* not JSON: read it as YAML below */ }
    }
    if (s.length > 1 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
    if (s[0] === '[' && s[s.length - 1] === ']') return s.slice(1, -1).split(',').map(scalar).filter((x) => x !== '');
    return s;
  }

  function readFront(block, out) {
    const lines = block.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/.exec(lines[i]);
      if (!m) continue;
      const key = m[1].toLowerCase();
      let val;
      if (!m[2].trim()) {
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1])) items.push(scalar(lines[++i].replace(/^\s*-\s/, '')));
        val = items.length ? items : '';
      } else val = scalar(m[2]);
      if (key === 'id') out.id = typeof val === 'string' && ID_RE.test(val) ? val : null;
      else if (key === 'title' || key === 'folder') out[key] = val == null ? '' : String(val);
      else if (key === 'tags') out.tags = (Array.isArray(val) ? val : String(val || '').split(/[,\s]+/)).map(String).filter(Boolean);
      else if (key === 'defaults' && val && typeof val === 'object' && !Array.isArray(val)) {
        out.defaults = {};
        for (const k of Object.keys(val)) if (val[k] != null) out.defaults[k] = String(val[k]);
      } else if (key === 'created') out.c = toMs(val);
      else if (key === 'updated') out.u = toMs(val);
    }
  }

  // -> { id (or null), title, text, folder, tags, defaults, c, u (0 when unknown) }
  function parse(src, fallbackTitle) {
    const s = String(src == null ? '' : src).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const out = { id: null, title: '', text: '', folder: '', tags: [], defaults: {}, c: 0, u: 0 };
    let body = s;
    const m = FRONT_RE.exec(s);
    if (m) {
      readFront(m[1] || '', out);
      body = s.slice(m[0].length);
    }
    if (body.endsWith('\n')) body = body.slice(0, -1);
    out.text = body;
    if (!out.title) out.title = fallbackTitle || '';
    return out;
  }

  // What the user wrote, without ids and timestamps: two prompts with the same key are the same.
  function contentKey(p) {
    const d = p.defaults || {};
    return JSON.stringify([p.title || '', p.text || '', p.folder || '', p.tags || [], Object.keys(d).sort().map((k) => [k, String(d[k])])]);
  }
  // cyrb53: a fast 53-bit string hash. Enough to notice an edit; not for security.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const contentHash = (p) => hash(contentKey(p));

  // "Code review" -> "code-review". Letters in any script are kept; characters that are not allowed
  // in file names on Windows, macOS or Linux are not.
  function slug(title) {
    return String(title || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'prompt';
  }

  // A file name for this title that no other file uses (compared without case, as on macOS and
  // Windows). Keeps the current name when it already fits the title, so files are not renamed for nothing.
  function fileName(title, taken, current) {
    const base = slug(title);
    if (current) {
      const c = current.toLowerCase();
      const rest = c.slice(base.length);
      if (c.startsWith(base) && (rest === '.md' || /^-\d+\.md$/.test(rest))) return current;
    }
    let name = base + '.md';
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = base + '-' + i + '.md';
    return name;
  }

  const titleFromName = (name) => String(name || '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();

  PM.md = { serialize, parse, contentHash, hash, slug, fileName, titleFromName };
})();
