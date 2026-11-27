// Reads the Prolly import block (v1): the ~~~~prolly block that the setup prompt asks the AI to write.
// Pure: no I/O, no DOM, no extension APIs, so it runs in the settings page and in node tests.
// Turns text (a pasted AI reply, or a code block read from the chat page) into entries for the review
// screen, and the selection made there into an import plan.
//
//   let { session, result } = PM.importer.addText(PM.importer.emptySession(), text);
//   let entries = PM.importer.evaluate(PM.importer.sessionEntries(session), library);
//   entries[i] = PM.importer.applyEdit(entries[i], { title: "New" }); entries = PM.importer.evaluate(entries, library);
//   const plan = PM.importer.buildImportPlan(entries, { selected, decisions, library });
//
// Tests: test/importer.test.mjs.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.importer) return;

  const LIMITS = {
    inputChars: 500000,
    entriesPerSession: 200,
    bodyChars: 20000,
    titleChars: 80,
    tagsPerEntryWarn: 8,
    dividerLookahead: 10,
    unknownKeyChars: 24,
  };
  const CATALOG = {
    no_block: { severity: 'fatal', attention: true, message: "We couldn't find a Prolly library in this text. Make sure you copied the whole reply, or ask the AI to output the import block again." },
    version_unsupported: { severity: 'fatal', attention: true, message: 'This library was made for a newer version of Prolly. Update Prolly and try again.' },
    no_entries: { severity: 'fatal', attention: true, message: 'We found the import block, but there were no prompts in it. Ask the AI to output the import block again.' },
    input_too_large: { severity: 'fatal', attention: true, message: 'This is too much to import at once. Ask the AI to split the library into parts.' },
    entries_capped: { severity: 'warning', attention: true, message: `Only the first ${LIMITS.entriesPerSession} prompts are shown.` },
    header_missing: { severity: 'warning', attention: false, message: 'The block had no header line, so it was read as part 1 of 1.' },
    header_variant: { severity: 'warning', attention: false, message: "The header line wasn't in the exact format." },
    separator_variant: { severity: 'warning', attention: false, message: "A separator line wasn't in the exact format." },
    stray_text: { severity: 'warning', attention: false, message: 'Some text outside the prompts was ignored.' },
    end_missing: { severity: 'warning', attention: false, message: 'The block had no END line, but it was closed, so it was read as complete.' },
    cut_off: { severity: 'warning', attention: true, message: 'The reply was cut off. Ask the AI to continue, then add the next part.' },
    part_replaced: { severity: 'warning', attention: true, message: 'A newer copy of part {part} replaced the earlier one.' },
    part_total_changed: { severity: 'warning', attention: false, message: "The parts disagreed on how many parts there are. Using {total}." },
    part_invalid: { severity: 'warning', attention: false, message: 'A part had an unexpected number, so it was added after the others.' },
    title_derived: { severity: 'warning', attention: true, field: 'title', message: 'No title was given, so one was made from the first line.' },
    title_long: { severity: 'warning', attention: true, field: 'title', message: `The title was shortened to ${LIMITS.titleChars} characters.` },
    folder_default: { severity: 'warning', attention: true, field: 'folder', message: 'No folder was given, so this goes in Imported.' },
    start_here_invalid: { severity: 'warning', attention: false, field: 'startHere', message: '"Start here" had a value we couldn\'t read, so it was turned off.' },
    divider_missing: { severity: 'warning', attention: false, message: 'The line between the fields and the prompt text was missing.' },
    field_line_moved: { severity: 'warning', attention: true, field: 'body', message: 'Some lines written before the prompt text were moved into it.' },
    field_alias: { severity: 'warning', attention: false, message: 'A field used another name, e.g. "name" for "title".' },
    unknown_field: { severity: 'warning', attention: false, message: 'An unknown field was kept but not imported.' },
    duplicate_field: { severity: 'warning', attention: false, message: 'A field appeared twice. The last value was used.' },
    title_missing: { severity: 'error', attention: true, field: 'title', message: 'Add a title.' },
    body_missing: { severity: 'error', attention: true, field: 'body', message: 'This prompt has no text.' },
    body_too_large: { severity: 'error', attention: true, field: 'body', message: `This prompt is too long to import (over ${LIMITS.bodyChars.toLocaleString('en-US')} characters).` },
    body_fenced: { severity: 'warning', attention: true, field: 'body', message: 'The prompt text is wrapped in a code fence.' },
    tags_many: { severity: 'warning', attention: false, field: 'tags', message: 'This prompt has a lot of tags.' },
    possible_personal_data: { severity: 'warning', attention: true, field: 'body', message: 'This may contain an email address or phone number. Check it before importing.' },
    variable_unnamed_choices: { severity: 'warning', attention: true, field: 'body', message: 'A list of choices has no name, so it won\'t work as a variable. Write it as #name:first|second#, e.g. "{example}".' },
    incomplete: { severity: 'state', attention: true, field: 'body', message: 'This prompt may be cut off.' },
    maybe: { severity: 'state', attention: true, message: "The AI wasn't sure you'd use this one." },
    duplicate_library: { severity: 'state', attention: true, message: 'You already have a prompt called "{title}".' },
    duplicate_batch: { severity: 'state', attention: true, message: 'Same as "{title}", earlier in this import.' },
  };
  function issue(code, params = {}, line) {
    const c = CATALOG[code];
    const message = c.message.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
    const out = { code, severity: c.severity, message, attention: c.attention };
    if (c.field)
      out.field = c.field;
    if (line !== undefined)
      out.line = line;
    return out;
  }
  // ---------------------------------------------------------------------------
  // Line patterns (applied to structurally normalized lines)
  const HEADER = /^prolly[- ]import\s+v(\d+)(?:\s*[|·,\-–—]?\s*part\s+(\d+)\s*(?:of|\/)\s*(\d+))?\s*$/i;
  const HEADER_CANONICAL = /^prolly-import v\d+ \| part \d+ of \d+$/;
  const SEPARATOR = /^={2,}\s*(PROMPT|MODIFIER)\s*={2,}$/i;
  const SEPARATOR_CANONICAL = '=== PROMPT ===';
  const END = /^={2,}\s*END\s*={2,}$/i;
  const DIVIDER = /^-{3,}$/;
  const FIELD = /^(?:[-*•]\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z _-]*?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/;
  const FENCE_OPEN = /^(`{3,}|~{3,})\s*prolly\b/i;
  const FENCE_CLOSE = /^(`{3,}|~{3,})\s*$/;
  const KNOWN_KEYS = ['title', 'folder', 'tags', 'start-here'];
  const ALIASES = {
    title: 'title', name: 'title', 'prompt-title': 'title',
    folder: 'folder', category: 'folder', collection: 'folder',
    tags: 'tags', tag: 'tags', labels: 'tags', label: 'tags',
    'start-here': 'start-here', starthere: 'start-here', pinned: 'start-here', featured: 'start-here',
  };
  const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
  // C0 controls except tab and newline, plus DEL.
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  /** Normalization used only to recognize structural lines. Bodies keep the raw line. */
  function structural(line) {
    return line.replace(ZERO_WIDTH, '').replace(/ /g, ' ').trim();
  }
  /** Strips heading marks and wrapping emphasis/backticks around a structural line. */
  function stripDecor(line) {
    let s = line.replace(/^#{1,6}\s*/, '').trim();
    for (let i = 0; i < 3; i++) {
      const m = /^(\*\*|__|`)(.*)\1$/.exec(s);
      if (!m)
        break;
      s = m[2].trim();
    }
    return s;
  }
  // ---------------------------------------------------------------------------
  // Small helpers (exported for the UI and tests)
  const WRAPPERS = [['**', '**'], ['__', '__'], ['`', '`'], ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  function cleanText(value) {
    let s = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
    for (let changed = true; changed;) {
      changed = false;
      for (const [open, close] of WRAPPERS) {
        if (s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
          s = s.slice(open.length, s.length - close.length).trim();
          changed = true;
        }
      }
    }
    return s;
  }
  function normalizeTag(raw) {
    return cleanText(raw)
      .replace(/^#+/, '')
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  /** Parses a tags value ("a, b; c" or "[a, b]") or normalizes an array of tags. */
  function normalizeTags(value) {
    const parts = Array.isArray(value)
      ? value
      : value.trim().replace(/^\[(.*)\]$/, '$1').split(/[,;]/);
    const tags = [];
    let maybe = false;
    for (const p of parts) {
      const t = normalizeTag(p);
      if (!t)
        continue;
      if (t === 'maybe') {
        maybe = true;
        continue;
      }
      if (!tags.includes(t))
        tags.push(t);
    }
    return { tags, maybe };
  }
  function titleKey(title) {
    return title.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
  }
  function bodyKey(body) {
    return body.normalize('NFKC').replace(/\s+/g, ' ').trim();
  }
  function slugify(title) {
    const slug = title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '');
    return slug || 'prompt';
  }
  // Prolly's variable syntax (shared/template.js in the extension):
  //   #name#            free text
  //   #name:a|b|c#      fixed choices, the first one is the default
  const VARIABLE = /#([A-Za-z_][A-Za-z0-9_]*)(?::([^#\n]+))?#/g;
  // A choice list with no name, e.g. #table|bullets#. Prolly doesn't read it as a variable.
  const UNNAMED_CHOICES = /#([A-Za-z0-9_][^#\n:]*\|[^#\n]+)#/;
  /** Default variable matcher, same rules as Prolly's template parser. */
  function defaultExtractVariables(body) {
    const names = [];
    for (const m of body.matchAll(VARIABLE)) {
      if (!names.includes(m[1]))
        names.push(m[1]);
    }
    return names;
  }
  function isFenced(body) {
    const lines = body.split('\n');
    if (lines.length < 2)
      return false;
    return /^\s*(`{3,}|~{3,})[^`~]*$/.test(lines[0]) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]);
  }
  /** Removes a code fence wrapping the whole body (the review screen's "Remove fence" action). */
  function removeCodeFence(body) {
    if (!isFenced(body))
      return body;
    return trimBlankLines(body.split('\n').slice(1, -1)).join('\n');
  }
  function hasPersonalData(body) {
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(body))
      return true;
    for (const m of body.matchAll(/(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g)) {
      const digits = m[0].replace(/\D/g, '').length;
      if (digits >= 9 && digits <= 15)
        return true;
    }
    return false;
  }
  function trimBlankLines(lines) {
    let a = 0;
    let b = lines.length;
    while (a < b && lines[a].trim() === '')
      a++;
    while (b > a && lines[b - 1].trim() === '')
      b--;
    return lines.slice(a, b);
  }
  function parseBool(value) {
    const v = cleanText(value).toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(v))
      return true;
    if (['no', 'n', 'false', '0', ''].includes(v))
      return false;
    return null;
  }
  function findRegions(lines, wholeTextIsBlock) {
    if (wholeTextIsBlock)
      return [{ lines, firstLine: 1, closedByFence: false }];
    // Method 2: fenced blocks with the info string "prolly".
    const regions = [];
    for (let i = 0; i < lines.length; i++) {
      const open = FENCE_OPEN.exec(structural(lines[i]));
      if (!open)
        continue;
      const fence = open[1];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(structural(lines[j]));
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
          closed = true;
          break;
        }
      }
      regions.push({ lines: lines.slice(i + 1, j), firstLine: i + 2, closedByFence: closed });
      i = j;
    }
    if (regions.length)
      return regions;
    // Method 3: a header line, e.g. when the user copied the rendered reply.
    // Method 4: no header, but separator lines.
    for (const test of [HEADER, SEPARATOR]) {
      const start = lines.findIndex((l) => test.test(stripDecor(structural(l))));
      if (start >= 0)
        return [{ lines: lines.slice(start), firstLine: start + 1, closedByFence: false }];
    }
    return [];
  }
  function matchField(line, allowUnknown) {
    const m = FIELD.exec(line);
    if (!m)
      return null;
    const rawKey = m[1].trim().toLowerCase().replace(/[\s_]+/g, '-');
    const value = m[2] ?? '';
    const known = ALIASES[rawKey];
    if (known)
      return { kind: 'known', key: known, alias: !KNOWN_KEYS.includes(rawKey), value };
    if (allowUnknown && rawKey.length <= LIMITS.unknownKeyChars && rawKey.split('-').length <= 3) {
      return { kind: 'unknown', key: rawKey, value };
    }
    return null;
  }
  function addOnce(list, item) {
    if (!list.some((i) => i.code === item.code))
      list.push(item);
  }
  function parseRegion(region) {
    const { lines, firstLine } = region;
    const blocks = [];
    const newBlock = () => {
      const b = { hasHeader: false, version: 1, part: 1, total: 1, entries: [], issues: [], ended: false };
      blocks.push(b);
      return b;
    };
    let block = newBlock();
    let state = 'preamble';
    let entry = null;
    const setHeader = (m, text, line) => {
      block.hasHeader = true;
      block.version = Number(m[1]);
      block.part = m[2] ? Number(m[2]) : 1;
      block.total = m[3] ? Number(m[3]) : 1;
      if (!HEADER_CANONICAL.test(text))
        addOnce(block.issues, issue('header_variant', {}, line));
    };
    const startEntry = (i, m, text) => {
      let hasDivider = false;
      for (let j = i + 1; j <= i + LIMITS.dividerLookahead && j < lines.length; j++) {
        const s = structural(lines[j]);
        const d = stripDecor(s);
        if (SEPARATOR.test(d) || END.test(d))
          break;
        if (DIVIDER.test(s)) {
          hasDivider = true;
          break;
        }
      }
      entry = {
        line: firstLine + i,
        separator: m[1].toUpperCase(),
        hasDivider,
        fields: {},
        extra: {},
        notes: [],
        movedLines: [],
        bodyLines: [],
        incomplete: false,
      };
      if (text !== SEPARATOR_CANONICAL)
        addOnce(block.issues, issue('separator_variant', {}, firstLine + i));
      block.entries.push(entry);
      state = 'fields';
    };
    const setField = (e, f, line) => {
      if (f.kind === 'unknown') {
        e.extra[f.key] = f.value;
        addOnce(e.notes, issue('unknown_field', {}, line));
        return;
      }
      if (f.alias)
        addOnce(e.notes, issue('field_alias', {}, line));
      if (e.fields[f.key])
        addOnce(e.notes, issue('duplicate_field', {}, line));
      e.fields[f.key] = { value: f.value, line };
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const s = structural(raw);
      const d = stripDecor(s);
      const lineNo = firstLine + i;
      const header = HEADER.exec(d);
      const sep = SEPARATOR.exec(d);
      const end = END.test(d);
      if (state === 'preamble') {
        if (header) {
          if (block.hasHeader || block.entries.length)
            block = newBlock();
          setHeader(header, d, lineNo);
        }
        else if (sep) {
          if (!block.hasHeader)
            addOnce(block.issues, issue('header_missing', {}, lineNo));
          startEntry(i, sep, d);
        }
        else if (end) {
          block.ended = true;
          state = 'done';
        }
        else if (s !== '') {
          addOnce(block.issues, issue('stray_text', {}, lineNo));
        }
        continue;
      }
      if (state === 'done') {
        if (header) {
          block = newBlock();
          setHeader(header, d, lineNo);
          state = 'preamble';
        }
        else if (sep) {
          // Entries after END with no new header: keep them as a continuation of this block.
          block.ended = false;
          addOnce(block.issues, issue('header_missing', {}, lineNo));
          startEntry(i, sep, d);
        }
        else if (s !== '') {
          addOnce(block.issues, issue('stray_text', {}, lineNo));
        }
        continue;
      }
      const e = entry;
      if (sep) {
        startEntry(i, sep, d);
        continue;
      }
      if (end) {
        block.ended = true;
        state = 'done';
        entry = null;
        continue;
      }
      if (state === 'body') {
        e.bodyLines.push(raw);
        continue;
      }
      // state === 'fields'
      if (e.hasDivider) {
        if (DIVIDER.test(s)) {
          e.bodyLines.push(...e.movedLines);
          state = 'body';
          continue;
        }
        const f = matchField(s, true);
        if (f) {
          setField(e, f, lineNo);
          continue;
        }
        if (s === '')
          continue;
        e.movedLines.push(raw);
        addOnce(e.notes, issue('field_line_moved', {}, lineNo));
      }
      else {
        const f = matchField(s, false);
        if (f) {
          setField(e, f, lineNo);
          continue;
        }
        if (s === '')
          continue;
        addOnce(e.notes, issue('divider_missing', {}, lineNo));
        e.bodyLines.push(raw);
        state = 'body';
      }
    }
    // Input ended. (startEntry() changes `state` inside a closure, which TypeScript's
    // narrowing can't see, so read it through a widened alias.)
    const finalState = state;
    if (finalState === 'fields' || finalState === 'body') {
      const e = entry;
      if (finalState === 'fields')
        e.bodyLines.push(...e.movedLines);
      if (region.closedByFence) {
        block.ended = true;
        addOnce(block.issues, issue('end_missing'));
      }
      else {
        e.incomplete = true;
      }
    }
    return blocks;
  }
  // ---------------------------------------------------------------------------
  // Building entries
  function buildEntry(raw, part, index, extract) {
    const notes = [...raw.notes];
    const body = trimBlankLines(raw.bodyLines).join('\n').replace(CONTROL_CHARS, '');
    // Title
    let title = cleanText(raw.fields.title?.value ?? '');
    if (!title) {
      const first = body.split('\n').find((l) => l.trim() !== '') ?? '';
      title = cleanText(first.replace(/^\s*(?:#{1,6}|[-*>]|\d+[.)])\s*/, '')).split(' ').slice(0, 6).join(' ');
      title = title.replace(/[.:;,]+$/, '') || 'Untitled prompt';
      notes.push(issue('title_derived', {}, raw.line));
    }
    if (title.length > LIMITS.titleChars) {
      title = title.slice(0, LIMITS.titleChars).trimEnd();
      notes.push(issue('title_long', {}, raw.fields.title?.line ?? raw.line));
    }
    // Folder
    let folder = cleanText(raw.fields.folder?.value ?? '');
    if (!folder) {
      if (raw.separator === 'MODIFIER')
        folder = 'Modifiers';
      else {
        folder = 'Imported';
        notes.push(issue('folder_default', {}, raw.line));
      }
    }
    // Tags
    const { tags, maybe } = normalizeTags(raw.fields.tags?.value ?? '');
    // Start here
    let startHere = false;
    if (raw.fields['start-here']) {
      const b = parseBool(raw.fields['start-here'].value);
      if (b === null)
        notes.push(issue('start_here_invalid', {}, raw.fields['start-here'].line));
      startHere = b ?? false;
    }
    return {
      key: '',
      part,
      index,
      line: raw.line,
      kind: folder.toLowerCase() === 'modifiers' ? 'modifier' : 'prompt',
      title,
      folder,
      tags,
      startHere,
      maybe,
      body,
      variables: extract(body),
      extra: raw.extra,
      incomplete: raw.incomplete,
      notes,
      status: 'ok',
      issues: [],
      defaultChecked: true,
    };
  }
  // ---------------------------------------------------------------------------
  // Public API: parsing
  function parseImport(text, opts = {}) {
    if (text.length > LIMITS.inputChars) {
      return { ok: false, parts: [], issues: [issue('input_too_large')] };
    }
    const extract = opts.extractVariables ?? defaultExtractVariables;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const regions = findRegions(lines, opts.wholeTextIsBlock ?? false);
    if (!regions.length)
      return { ok: false, parts: [], issues: [issue('no_block')] };
    const issues = [];
    const parts = [];
    for (const region of regions) {
      for (const block of parseRegion(region)) {
        if (block.version > 1) {
          addOnce(issues, issue('version_unsupported'));
          continue;
        }
        if (!block.entries.length)
          continue;
        const blockIssues = [...block.issues];
        let part = block.part;
        if (part < 1 || part > block.total) {
          blockIssues.push(issue('part_invalid'));
          part = 0;
        }
        const cutOff = !block.ended;
        if (cutOff)
          blockIssues.push(issue('cut_off'));
        parts.push({
          part,
          total: Math.max(block.total, 1),
          cutOff,
          entries: block.entries.map((e, i) => buildEntry(e, part, i, extract)),
          issues: blockIssues,
        });
      }
    }
    if (!parts.length && !issues.length)
      issues.push(issue('no_entries'));
    return { ok: parts.length > 0, parts, issues };
  }
  // ---------------------------------------------------------------------------
  // Public API: sessions (collecting parts)
  function emptySession() {
    return { parts: [], total: 0, issues: [], seq: 0 };
  }
  function mergeParts(session, result) {
    const parts = [...session.parts];
    const issues = [...result.issues];
    let total = session.total;
    const seq = session.seq + 1;
    for (const p of result.parts) {
      const maxPart = parts.reduce((m, x) => Math.max(m, x.part), 0);
      const part = p.part === 0 ? maxPart + 1 : p.part;
      if (total && p.total !== total)
        addOnce(issues, issue('part_total_changed', { total: Math.max(total, p.total) }));
      total = Math.max(total, p.total, part);
      const rekeyed = {
        ...p,
        part,
        entries: p.entries.map((e) => ({ ...e, part, key: `${part}.${e.index}.${seq}` })),
      };
      const at = parts.findIndex((x) => x.part === part);
      if (at >= 0) {
        parts[at] = rekeyed;
        issues.push(issue('part_replaced', { part }));
      }
      else {
        parts.push(rekeyed);
      }
    }
    parts.sort((a, b) => a.part - b.part);
    // Cap the number of entries across the session.
    let count = 0;
    const capped = parts.map((p) => {
      const room = Math.max(0, LIMITS.entriesPerSession - count);
      count += p.entries.length;
      return p.entries.length > room ? { ...p, entries: p.entries.slice(0, room) } : p;
    });
    if (count > LIMITS.entriesPerSession)
      addOnce(issues, issue('entries_capped'));
    return { parts: capped, total, issues, seq };
  }
  function sessionEntries(session) {
    return session.parts.flatMap((p) => p.entries);
  }
  function sessionProgress(session) {
    const received = session.parts.map((p) => p.part);
    const missing = [];
    for (let n = 1; n <= session.total; n++)
      if (!received.includes(n))
        missing.push(n);
    const cutOff = session.parts.filter((p) => p.cutOff).map((p) => p.part);
    return { received, total: session.total, missing, cutOff, complete: received.length > 0 && !missing.length && !cutOff.length };
  }
  /** Convenience: parse text and merge it into the session in one step. */
  function addText(session, text, opts = {}) {
    const result = parseImport(text, opts);
    return { session: result.ok ? mergeParts(session, result) : session, result };
  }
  // ---------------------------------------------------------------------------
  // Public API: library index
  function createLibraryIndex(prompts, folders = []) {
    const index = { byTitle: new Map(), byBody: new Map(), folders: new Map(), fileNames: new Set() };
    for (const f of folders)
      index.folders.set(f.toLowerCase(), f);
    for (const p of prompts) {
      index.byTitle.set(titleKey(p.title), p);
      if (p.body.trim())
        index.byBody.set(bodyKey(p.body), p);
      if (p.folder && !index.folders.has(p.folder.toLowerCase()))
        index.folders.set(p.folder.toLowerCase(), p.folder);
      index.fileNames.add(p.fileName ?? slugify(p.title));
    }
    return index;
  }
  // ---------------------------------------------------------------------------
  // Public API: evaluating and editing entries (review screen)
  /**
  * Recomputes status, issues, duplicates and default selection for the entries the
  * user still has in the list. Call after parsing and after every edit or removal.
  */
  function evaluate(entries, library, opts = {}) {
    const extract = opts.extractVariables ?? defaultExtractVariables;
    const seenTitle = new Map();
    const seenBody = new Map();
    return entries.map((e) => {
      const issues = [...e.notes];
      const tk = titleKey(e.title);
      const bk = bodyKey(e.body);
      if (!e.title.trim())
        issues.push(issue('title_missing'));
      if (!e.body.trim())
        issues.push(issue('body_missing'));
      else if (e.body.length > LIMITS.bodyChars)
        issues.push(issue('body_too_large'));
      if (isFenced(e.body))
        issues.push(issue('body_fenced'));
      if (e.tags.length > LIMITS.tagsPerEntryWarn)
        issues.push(issue('tags_many'));
      const unnamed = UNNAMED_CHOICES.exec(e.body);
      if (unnamed)
        issues.push(issue('variable_unnamed_choices', { example: `#choice:${unnamed[1]}#` }));
      const personal = hasPersonalData(e.body);
      if (personal)
        issues.push(issue('possible_personal_data'));
      if (e.incomplete)
        issues.push(issue('incomplete'));
      if (e.maybe)
        issues.push(issue('maybe'));
      let duplicateOf;
      let duplicateOfKey;
      const libMatch = library && ((tk && library.byTitle.get(tk)) || (bk && library.byBody.get(bk)));
      if (libMatch) {
        duplicateOf = libMatch.id;
        issues.push(issue('duplicate_library', { title: libMatch.title }));
      }
      else {
        const earlier = (tk && seenTitle.get(tk)) || (bk && seenBody.get(bk));
        if (earlier) {
          duplicateOfKey = earlier.key;
          issues.push(issue('duplicate_batch', { title: earlier.title }));
        }
      }
      if (tk && !seenTitle.has(tk))
        seenTitle.set(tk, e);
      if (bk && !seenBody.has(bk))
        seenBody.set(bk, e);
      const status = issues.some((i) => i.severity === 'error')
        ? 'invalid'
        : e.incomplete
          ? 'incomplete'
          : duplicateOf || duplicateOfKey
            ? 'duplicate'
            : 'ok';
      const next = {
        ...e,
        kind: e.folder.trim().toLowerCase() === 'modifiers' ? 'modifier' : 'prompt',
        variables: extract(e.body),
        status,
        issues,
        // Possible personal data starts unchecked so it's never imported without a look.
        defaultChecked: status === 'ok' && !e.maybe && !personal,
      };
      if (duplicateOf)
        next.duplicateOf = duplicateOf;
      else
        delete next.duplicateOf;
      if (duplicateOfKey)
        next.duplicateOfKey = duplicateOfKey;
      else
        delete next.duplicateOfKey;
      return next;
    });
  }
  /** Applies a user edit. Clears the parse notes about the edited fields. Call evaluate() afterwards. */
  function applyEdit(entry, patch) {
    const next = { ...entry };
    const edited = new Set();
    if (patch.title !== undefined) {
      next.title = cleanText(patch.title).slice(0, LIMITS.titleChars);
      edited.add('title');
    }
    if (patch.folder !== undefined) {
      next.folder = cleanText(patch.folder);
      edited.add('folder');
    }
    if (patch.tags !== undefined) {
      next.tags = normalizeTags(patch.tags).tags;
      edited.add('tags');
    }
    if (patch.startHere !== undefined) {
      next.startHere = patch.startHere;
      edited.add('startHere');
    }
    if (patch.body !== undefined) {
      next.body = patch.body.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
      next.incomplete = false;
      edited.add('body');
    }
    next.notes = entry.notes.filter((n) => !n.field || !edited.has(n.field));
    return next;
  }
  // ---------------------------------------------------------------------------
  // Public API: import plan
  function buildImportPlan(entries, opts) {
    const selected = new Set(opts.selected);
    const decisions = opts.decisions ?? {};
    const library = opts.library;
    const usedTitles = new Set(library ? library.byTitle.keys() : []);
    const usedFiles = new Set(library ? library.fileNames : []);
    const folders = new Map(library ? library.folders : []);
    const plan = { create: [], replace: [], foldersToCreate: [], skipped: [] };
    const uniqueTitle = (title) => {
      let candidate = title;
      for (let n = 2; usedTitles.has(titleKey(candidate)); n++)
        candidate = `${title} (${n})`;
      usedTitles.add(titleKey(candidate));
      return candidate;
    };
    const uniqueFile = (title) => {
      const base = slugify(title);
      let candidate = base;
      for (let n = 2; usedFiles.has(candidate); n++)
        candidate = `${base}-${n}`;
      usedFiles.add(candidate);
      return candidate;
    };
    const folderFor = (name) => {
      const display = cleanText(name) || 'Imported';
      const key = display.toLowerCase();
      const existing = folders.get(key);
      if (existing)
        return existing;
      folders.set(key, display);
      plan.foldersToCreate.push(display);
      return display;
    };
    for (const e of entries) {
      if (!selected.has(e.key) || e.status === 'invalid') {
        plan.skipped.push(e.key);
        continue;
      }
      if (e.duplicateOf && decisions[e.key] === 'replace') {
        plan.replace.push({ entryKey: e.key, libraryId: e.duplicateOf, body: e.body, addTags: [...e.tags] });
        continue;
      }
      const title = uniqueTitle(e.title);
      plan.create.push({
        entryKey: e.key,
        kind: e.kind,
        title,
        folder: folderFor(e.folder),
        tags: [...e.tags],
        startHere: e.startHere,
        body: e.body,
        fileName: uniqueFile(title),
      });
    }
    return plan;
  }

  PM.importer = { LIMITS, issue, cleanText, normalizeTag, normalizeTags, titleKey, bodyKey, slugify, defaultExtractVariables, removeCodeFence, parseImport, emptySession, mergeParts, sessionEntries, sessionProgress, addText, createLibraryIndex, evaluate, applyEdit, buildImportPlan };
})();
