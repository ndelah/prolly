// Two-way sync between the library and a folder of Markdown files, one per prompt (see mdfile.js).
// It knows nothing about Google Drive or GitHub: it works with any provider that deals in files.
//
// provider:
//   list()                 -> [{ id, name, rev, modified }]   the .md files in the folder; rev changes on every write
//   read(id)               -> the file's text
//   create(name, text)     -> { id, name, rev, modified }
//   update(id, name, text) -> { id, name, rev, modified }     throws an error with code 'NOT_FOUND' if the file is gone
//   remove(id)             -> moves the file to the bin (or deletes it, where there is no bin)
// local (the browser's library):
//   load()        -> prompts
//   save(list)    -> the saved prompts, in the same order, as stored (normalized), keeping the given u/c
//   remove(id)
//
// state.files remembers, per prompt id, both sides as they were at the end of the last sync:
//   { fileId, name, rev, hash }    rev: the file's version then; hash: the prompt's content then.
// Comparing both sides with it tells which one changed (a three-way merge):
//   changed on one side       -> copy it to the other
//   changed on both           -> the newer edit wins; the other is kept as "Title (copy)", on both sides
//   deleted on one side       -> delete it on the other, unless the other side edited it (the edit wins)
//   new on both, same content -> link them (a second computer's starter prompts don't turn into copies)
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.fileSync) return;

  // Pause instead of deleting when this many prompts (and at least half the library) vanish from the folder at once.
  const MASS_DELETE_MIN = 3;

  function fail(code, message, extra) {
    return Object.assign(new Error(message), { code }, extra || {});
  }

  async function pool(items, n, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) await fn(items[i++]);
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }

  // Has anything changed in the library since the last sync? Answers without touching the network.
  function localDirty(prompts, files) {
    const seen = new Set();
    for (const p of prompts) {
      seen.add(p.id);
      const b = files[p.id];
      if (!b || b.hash !== PM.md.contentHash(p)) return true;
    }
    return Object.keys(files).some((id) => !seen.has(id));
  }

  // opts: { provider, local, state, localOnly, massDelete: 'restore' | 'apply', now }
  //   localOnly   do nothing (and make no request) unless the library changed since the last sync
  //   massDelete  how to resolve a MASS_DELETE pause: put the files back, or delete the prompts here too
  // -> { state: { files }, stats, skipped }. On an error, err.state holds what was done before it.
  async function run(opts) {
    const { provider, local } = opts;
    const now = opts.now || Date.now;
    const files = Object.assign({}, (opts.state && opts.state.files) || {});
    const stats = { uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0 };
    const hashOf = PM.md.contentHash;

    const prompts = await local.load();
    if (opts.localOnly && !localDirty(prompts, files)) return { state: { files }, stats, skipped: true };
    const localById = {};
    prompts.forEach((p) => (localById[p.id] = p));

    // ---- The folder, by prompt id. Only files that are new or changed since the last sync are read.
    const listing = await provider.list();
    const inListing = new Set(listing.map((f) => f.id));
    const pidByFile = {};
    for (const pid of Object.keys(files)) pidByFile[files[pid].fileId] = pid;
    const remote = {};
    const toRead = [];
    for (const f of listing) {
      const pid = pidByFile[f.id];
      if (pid && files[pid].rev === f.rev) remote[pid] = { file: f, prompt: null, hash: files[pid].hash };
      else toRead.push({ f, pid });
    }
    toRead.sort((a, b) => (b.pid ? 1 : 0) - (a.pid ? 1 : 0)); // known files claim their ids first
    await pool(toRead, 4, async (x) => {
      x.text = await provider.read(x.f.id);
    });
    for (const x of toRead) {
      const p = PM.md.parse(x.text, PM.md.titleFromName(x.f.name));
      let pid = x.pid || p.id;
      if (pid && !x.pid && files[pid] && files[pid].fileId !== x.f.id) {
        // Another file was synced under this id. Still there: this one is a duplicate of it.
        // Gone: this file replaces it, compared as if it had never been synced.
        if (inListing.has(files[pid].fileId)) pid = null;
        else delete files[pid];
      }
      if (!pid || remote[pid]) pid = 'f' + PM.md.hash(x.f.id);
      p.id = pid;
      // Edit time: the file's "updated" line. Not the file's own time, which for a file Prolly wrote is
      // when it was uploaded, not when it was edited (and could make an older edit win a conflict).
      if (!p.u) p.u = x.f.modified || now();
      if (!p.c) p.c = p.u;
      remote[pid] = { file: x.f, prompt: p, hash: hashOf(p) };
    }

    // ---- Many prompts gone from the folder at once looks like an accident (a folder emptied or
    // moved), not a decision: ask before deleting them here.
    const gone = Object.keys(files).filter((pid) => !remote[pid] && localById[pid]);
    if (gone.length >= MASS_DELETE_MIN && gone.length * 2 >= Object.keys(files).length) {
      if (opts.massDelete === 'restore') gone.forEach((pid) => delete files[pid]);
      else if (opts.massDelete !== 'apply') {
        throw fail('MASS_DELETE', gone.length + ' prompts were deleted from the synced folder.', { count: gone.length, state: { files } });
      }
    }

    // ---- First sync on another computer: the same prompt under another id (the starter prompts,
    // or a library imported on both). Keep the folder's copy rather than both.
    const newRemoteByHash = {};
    for (const pid of Object.keys(remote)) {
      if (!files[pid] && !localById[pid]) (newRemoteByHash[remote[pid].hash] = newRemoteByHash[remote[pid].hash] || []).push(pid);
    }
    const dropLocal = new Set();
    for (const p of prompts) {
      if (files[p.id] || remote[p.id]) continue;
      const same = newRemoteByHash[hashOf(p)];
      if (same && same.length) {
        same.shift();
        dropLocal.add(p.id);
      }
    }

    // ---- Decide, per prompt.
    const saves = []; // { rec, kind: 'remote' (from the folder: record its base) | 'copy' (new: upload it) , file }
    const uploads = []; // { pid, prompt, fileId, name }
    const trash = []; // { pid, fileId }
    const removes = []; // ids to delete from the library
    const fromRemote = (pid, R) => {
      const L = localById[pid];
      return { rec: Object.assign({}, R.prompt, { id: pid, pu: L ? L.u : 0, dev: '' }), kind: 'remote', file: R.file };
    };
    const copyOf = (p, base) => ({
      rec: Object.assign({}, p, { id: (base + 'c' + (p.u || 0).toString(36)).slice(0, 40), title: p.title + ' (copy)', u: now(), pu: 0, dev: '' }),
      kind: 'copy'
    });

    const ids = new Set([...Object.keys(localById), ...Object.keys(files), ...Object.keys(remote)]);
    for (const pid of ids) {
      if (dropLocal.has(pid)) {
        removes.push(pid);
        continue;
      }
      const L = localById[pid];
      const B = files[pid];
      const R = remote[pid];
      const hL = L ? hashOf(L) : null;
      if (L && !R) {
        if (B && hL === B.hash) {
          removes.push(pid); // deleted in the folder
          stats.deletedLocal++;
        } else {
          delete files[pid]; // new here, or edited here after being deleted in the folder
          uploads.push({ pid, prompt: L });
        }
      } else if (!L && R) {
        if (B && R.file.rev === B.rev) trash.push({ pid, fileId: R.file.id }); // deleted here
        else saves.push(fromRemote(pid, R)); // new in the folder, or edited there after being deleted here
      } else if (!L && !R) {
        delete files[pid];
      } else {
        const localChanged = !B || hL !== B.hash;
        const remoteChanged = !B || R.file.rev !== B.rev;
        if (!localChanged && !remoteChanged) continue;
        const base = { fileId: R.file.id, name: R.file.name, rev: R.file.rev, hash: hL };
        if (remoteChanged && R.hash === hL) files[pid] = base; // same content both sides (or only the file's details changed)
        else if (!localChanged) saves.push(fromRemote(pid, R));
        else if (!remoteChanged) uploads.push({ pid, prompt: L, fileId: R.file.id, name: R.file.name });
        else {
          stats.conflicts++;
          if (R.prompt.u > L.u) {
            saves.push(fromRemote(pid, R));
            saves.push(copyOf(L, pid));
          } else {
            uploads.push({ pid, prompt: L, fileId: R.file.id, name: R.file.name });
            saves.push(copyOf(R.prompt, pid));
          }
        }
      }
    }

    // ---- Apply: the library first (one write), then the folder.
    try {
      if (saves.length) {
        const saved = await local.save(saves.map((s) => s.rec));
        saves.forEach((s, i) => {
          const rec = saved[i];
          if (s.kind === 'remote') {
            files[rec.id] = { fileId: s.file.id, name: s.file.name, rev: s.file.rev, hash: hashOf(rec) };
            stats.downloaded++;
          } else uploads.push({ pid: rec.id, prompt: rec });
        });
      }
      for (const pid of removes) {
        await local.remove(pid);
        delete files[pid];
      }

      const taken = new Set(listing.map((f) => f.name.toLowerCase()));
      for (const u of uploads) {
        if (u.name) taken.delete(u.name.toLowerCase());
        const name = PM.md.fileName(u.prompt.title, taken, u.name);
        taken.add(name.toLowerCase());
        const text = PM.md.serialize(u.prompt);
        let f;
        if (u.fileId) {
          try {
            f = await provider.update(u.fileId, name, text);
          } catch (e) {
            if (e.code !== 'NOT_FOUND') throw e;
            f = await provider.create(name, text);
          }
        } else f = await provider.create(name, text);
        files[u.pid] = { fileId: f.id, name: f.name, rev: f.rev, hash: hashOf(u.prompt) };
        stats.uploaded++;
      }

      for (const t of trash) {
        try {
          await provider.remove(t.fileId);
        } catch (e) {
          if (e.code !== 'NOT_FOUND') throw e;
        }
        delete files[t.pid];
        stats.deletedRemote++;
      }
    } catch (e) {
      e.state = { files };
      throw e;
    }
    return { state: { files }, stats, skipped: false };
  }

  PM.fileSync = { run, localDirty, MASS_DELETE_MIN };
})();
