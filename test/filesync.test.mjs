// Tests for the Markdown format (shared/mdfile.js) and the file sync (shared/filesync.js),
// against an in-memory folder and library. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
for (const f of ['shared/core.js', 'shared/mdfile.js', 'shared/filesync.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const PM = globalThis.PM;

// ---------- Fakes ----------
let clock = Date.parse('2026-11-26T10:00:00Z');
const tick = () => (clock += 1000);

function fakeFolder() {
  const files = new Map(); // id -> { id, name, text, rev, modified }
  let n = 0;
  const calls = [];
  const meta = (f) => ({ id: f.id, name: f.name, rev: String(f.rev), modified: f.modified });
  return {
    files, calls,
    async list() { calls.push('list'); return [...files.values()].map(meta); },
    async read(id) { calls.push('read'); return files.get(id).text; },
    async create(name, text) { calls.push('create'); const f = { id: 'file' + ++n, name, text, rev: 1, modified: tick() }; files.set(f.id, f); return meta(f); },
    async update(id, name, text) {
      calls.push('update');
      const f = files.get(id);
      if (!f) throw Object.assign(new Error('gone'), { code: 'NOT_FOUND' });
      Object.assign(f, { name, text, rev: f.rev + 1, modified: tick() });
      return meta(f);
    },
    async remove(id) { calls.push('remove'); files.delete(id); },
    // Someone editing the file in Drive or on disk.
    edit(id, text) { const f = files.get(id); Object.assign(f, { text, rev: f.rev + 1, modified: tick() }); },
    add(name, text) { const f = { id: 'file' + ++n, name, text, rev: 1, modified: tick() }; files.set(f.id, f); return f.id; },
    byTitle(t) { return [...files.values()].find((f) => PM.md.parse(f.text).title === t); }
  };
}

// Normalizes like PM.store's clean(), and keeps u/c as given (savePrompts with keepMeta).
function fakeLibrary(list) {
  const m = new Map();
  const clean = (p) => ({
    id: p.id, title: String(p.title || '').trim(), text: String(p.text || ''), folder: PM.normFolder(p.folder),
    tags: Array.from(new Set((p.tags || []).map(PM.normTag).filter(Boolean))), defaults: p.defaults || {},
    c: p.c || p.u, u: p.u, pu: p.pu || 0, dev: p.dev || ''
  });
  (list || []).forEach((p) => m.set(p.id, clean(Object.assign({ u: tick() }, p))));
  return {
    m,
    async load() { return [...m.values()]; },
    async save(recs) { return recs.map((p) => { const r = clean(p); m.set(r.id, r); return r; }); },
    async remove(id) { m.delete(id); },
    // A person editing in Prolly (u moves forward, like savePrompts without keepMeta).
    edit(id, patch) { m.set(id, clean(Object.assign({}, m.get(id), patch, { u: tick() }))); },
    titles() { return [...m.values()].map((p) => p.title).sort(); }
  };
}

function device(folder, lib) {
  let state = { files: {} };
  return {
    lib,
    get state() { return state; },
    async sync(opts) {
      const r = await PM.fileSync.run(Object.assign({ provider: folder, local: lib, state, now: () => tick() }, opts));
      state = r.state;
      return r;
    }
  };
}

const P = (id, title, text, extra) => Object.assign({ id, title, text }, extra || {});

// ---------- Markdown ----------
test('a prompt survives a round trip through Markdown', () => {
  const p = { id: 'abc', title: 'Code “review”: 1', text: 'Line one\n\nüñí #x# — 日本語\n', folder: 'Dev/Testing', tags: ['a', 'b'], defaults: { x: '1' }, c: 1700000000000, u: 1700000001000 };
  const back = PM.md.parse(PM.md.serialize(p));
  assert.deepEqual(back, p);
});

test('hand-written YAML and files without a header are read', () => {
  const a = PM.md.parse("---\r\nid: hand1\r\ntitle: Plain title\r\ntags: one, Two\r\nfolder: 'It''s'\r\n---\r\nBody\r\n");
  assert.equal(a.id, 'hand1');
  assert.equal(a.title, 'Plain title');
  assert.deepEqual(a.tags, ['one', 'Two']);
  assert.equal(a.folder, "It's");
  assert.equal(a.text, 'Body');
  const b = PM.md.parse('---\ntitle: x\ntags:\n  - one\n  - two\n---\n');
  assert.deepEqual(b.tags, ['one', 'two']);
  assert.equal(b.text, '');
  const c = PM.md.parse('Just text, no header', 'my file');
  assert.equal(c.id, null);
  assert.equal(c.title, 'my file');
  assert.equal(c.text, 'Just text, no header');
  // A "---" inside a line does not end the header.
  assert.equal(PM.md.parse('---\ntitle: a---b\n---\nz').title, 'a---b');
});

test('file names are unique, readable, and kept when the title still fits', () => {
  const taken = new Set(['code-review.md']);
  assert.equal(PM.md.fileName('Code review', taken), 'code-review-2.md');
  assert.equal(PM.md.fileName('Code review', new Set(), 'code-review-2.md'), 'code-review-2.md');
  assert.equal(PM.md.fileName('Code review!', new Set(), 'old-name.md'), 'code-review.md');
  assert.equal(PM.md.fileName('日本語のプロンプト', new Set()), '日本語のプロンプト.md');
  assert.equal(PM.md.fileName('???', new Set()), 'prompt.md');
});

// ---------- Sync ----------
test('first sync uploads the library; a second one does nothing', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', 'text 1'), P('p2', 'Two', 'text 2', { folder: 'Dev', tags: ['x'] })]));
  const r = await a.sync();
  assert.equal(r.stats.uploaded, 2);
  assert.equal(folder.files.size, 2);
  assert.deepEqual([...folder.files.values()].map((f) => f.name).sort(), ['one.md', 'two.md']);
  folder.calls.length = 0;
  const r2 = await a.sync();
  assert.deepEqual(folder.calls, ['list'], 'nothing read or written');
  assert.deepEqual(r2.stats, { uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0 });
});

test('localOnly makes no request when nothing changed here', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', 'x')]));
  await a.sync();
  folder.calls.length = 0;
  const r = await a.sync({ localOnly: true });
  assert.equal(r.skipped, true);
  assert.deepEqual(folder.calls, []);
  a.lib.edit('p1', { text: 'y' });
  const r2 = await a.sync({ localOnly: true });
  assert.equal(r2.stats.uploaded, 1);
});

test('edits travel both ways between two computers', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', 'v1')]));
  const b = device(folder, fakeLibrary([]));
  await a.sync();
  await b.sync();
  assert.equal(b.lib.m.get('p1').text, 'v1');

  a.lib.edit('p1', { text: 'v2', title: 'One renamed' });
  await a.sync();
  assert.equal(folder.byTitle('One renamed').name, 'one-renamed.md');
  const r = await b.sync();
  assert.equal(r.stats.downloaded, 1);
  assert.equal(b.lib.m.get('p1').text, 'v2');
  // Downloading is not seen as a local edit afterwards.
  assert.equal((await b.sync({ localOnly: true })).skipped, true);
});

test('an edit made to the file itself (Drive for desktop, a text editor) comes in', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', 'v1', { tags: ['Keep'] })]));
  await a.sync();
  const f = folder.byTitle('One');
  folder.edit(f.id, f.text.replace('v1', 'edited by hand'));
  await a.sync();
  assert.equal(a.lib.m.get('p1').text, 'edited by hand');
  assert.deepEqual(a.lib.m.get('p1').tags, ['keep']);
});

test('deletes travel both ways', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', '1'), P('p2', 'Two', '2'), P('p3', 'Three', '3')]));
  const b = device(folder, fakeLibrary([]));
  await a.sync();
  await b.sync();
  a.lib.m.delete('p1');
  const r = await a.sync();
  assert.equal(r.stats.deletedRemote, 1);
  assert.equal(folder.files.size, 2);
  const r2 = await b.sync();
  assert.equal(r2.stats.deletedLocal, 1);
  assert.deepEqual(b.lib.titles(), ['Three', 'Two']);
});

test('an edit beats a delete made elsewhere', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', '1'), P('p2', 'Two', '2'), P('p3', 'Three', '3')]));
  const b = device(folder, fakeLibrary([]));
  await a.sync();
  await b.sync();
  a.lib.m.delete('p1'); // deleted on A
  b.lib.edit('p1', { text: 'edited on B' }); // edited on B, before B saw the delete
  await a.sync();
  await b.sync();
  assert.equal(b.lib.m.get('p1').text, 'edited on B');
  await a.sync();
  assert.equal(a.lib.m.get('p1').text, 'edited on B', 'the edited prompt comes back on A');
});

test('edited on both: the newer edit wins and the other is kept as a copy on both sides', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', 'base')]));
  const b = device(folder, fakeLibrary([]));
  await a.sync();
  await b.sync();
  a.lib.edit('p1', { text: 'from A' });
  b.lib.edit('p1', { text: 'from B (newer)' });
  await a.sync();
  const r = await b.sync();
  assert.equal(r.stats.conflicts, 1);
  assert.equal(b.lib.m.get('p1').text, 'from B (newer)');
  assert.deepEqual(b.lib.titles(), ['One', 'One (copy)']);
  await a.sync();
  assert.equal(a.lib.m.get('p1').text, 'from B (newer)');
  assert.deepEqual(a.lib.titles(), ['One', 'One (copy)']);
  assert.equal([...a.lib.m.values()].find((p) => p.title === 'One (copy)').text, 'from A');
  assert.equal(folder.files.size, 2);
});

test('the same prompt on two new computers is linked, not duplicated', async () => {
  const folder = fakeFolder();
  // Starter prompts get random ids on each computer.
  const a = device(folder, fakeLibrary([P('a1', 'Code review', 'Review #code#', { folder: 'Dev' }), P('a2', 'Only on A', 'x')]));
  const b = device(folder, fakeLibrary([P('b1', 'Code review', 'Review #code#', { folder: 'Dev' }), P('b2', 'Only on B', 'y')]));
  await a.sync();
  await b.sync();
  assert.deepEqual(b.lib.titles(), ['Code review', 'Only on A', 'Only on B']);
  assert.ok(b.lib.m.has('a1') && !b.lib.m.has('b1'), 'B uses the id already in the folder');
  await a.sync();
  assert.deepEqual(a.lib.titles(), ['Code review', 'Only on A', 'Only on B']);
  assert.equal(folder.files.size, 3);
});

test('many prompts gone from the folder at once pauses instead of deleting', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', '1'), P('p2', 'Two', '2'), P('p3', 'Three', '3'), P('p4', 'Four', '4')]));
  await a.sync();
  folder.files.clear();
  await assert.rejects(a.sync(), (e) => e.code === 'MASS_DELETE' && e.count === 4);
  assert.equal(a.lib.m.size, 4, 'nothing deleted');
  const r = await a.sync({ massDelete: 'restore' });
  assert.equal(r.stats.uploaded, 4);
  assert.equal(folder.files.size, 4);

  folder.files.clear();
  await assert.rejects(a.sync());
  await a.sync({ massDelete: 'apply' });
  assert.equal(a.lib.m.size, 0);
});

test('a file added by hand, without an id, becomes a prompt once', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([]));
  folder.add('my-notes.md', 'Summarize #topic# in three bullets.\n');
  await a.sync();
  const [p] = [...a.lib.m.values()];
  assert.equal(p.title, 'my notes');
  assert.equal(p.text, 'Summarize #topic# in three bullets.');
  await a.sync();
  assert.equal(a.lib.m.size, 1);
  // A copy of an existing file (same id inside) gets its own id instead of replacing the original.
  const orig = folder.byTitle('my notes') || [...folder.files.values()][0];
  folder.add('copy.md', PM.md.serialize(Object.assign({}, p, { title: 'Copied', text: 'other' })));
  await a.sync();
  assert.deepEqual(a.lib.titles(), ['Copied', 'my notes']);
  assert.ok(orig);
});

test('an error part way keeps what was already done', async () => {
  const folder = fakeFolder();
  const a = device(folder, fakeLibrary([P('p1', 'One', '1'), P('p2', 'Two', '2')]));
  const create = folder.create;
  let n = 0;
  folder.create = async (...args) => {
    if (++n === 2) throw Object.assign(new Error('network'), { code: 'NETWORK' });
    return create(...args);
  };
  const e = await a.sync().catch((x) => x);
  assert.equal(e.code, 'NETWORK');
  assert.equal(Object.keys(e.state.files).length, 1);
  folder.create = create;
  const r = await PM.fileSync.run({ provider: folder, local: a.lib, state: e.state });
  assert.equal(r.stats.uploaded, 1);
  assert.equal(folder.files.size, 2);
});
