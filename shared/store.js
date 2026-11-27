// Storage: prompts + settings in storage.sync (the browser's free sync: Chrome sync or Firefox Sync),
// or storage.local when sync is turned off on this computer. "Recent" is always per computer.
//
// Layout (in the active area):
//   settings          -> settings object
//   p.<id>            -> { u, pu, dev, n, d }   head: updated-at, parent version, device, chunk count, chunk 0
//   p.<id>.<k>        -> chunk k of the prompt's JSON (long prompts are split, sync allows 8 KB per item)
// Local only:
//   _sync (bool), _device, _recent, _mirror (last-seen prompts, for conflict copies), _pendingSite
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.store) return;

  const S = ext.storage;
  const ITEM_MAX = (S.sync && S.sync.QUOTA_BYTES_PER_ITEM) || 8192;
  const SYNC_QUOTA = (S.sync && S.sync.QUOTA_BYTES) || 102400;
  const LOCAL_QUOTA = (S.local && S.local.QUOTA_BYTES) || 10485760;
  const enc = new TextEncoder();
  const size = (s) => enc.encode(s).length;
  const HEAD_RE = /^p\.([A-Za-z0-9_-]+)$/;
  const SYNC_NAME = PM.SYNC_NAME;

  // Bytes used by these keys (null: all). Firefox has no storage.local.getBytesInUse before 144,
  // so count the way Chrome does: key length plus the JSON of the value.
  async function bytesInUse(a, keys) {
    if (typeof a.getBytesInUse === 'function') {
      try {
        return await a.getBytesInUse(keys);
      } catch (e) { /* count below */ }
    }
    const all = await a.get(keys);
    let n = 0;
    for (const k of Object.keys(all)) n += size(k) + size(JSON.stringify(all[k]));
    return n;
  }

  const builtin = (host) => ({ host, builtin: true, enabled: true, target: null, shortcut: null });
  const DEFAULT_SITES = [builtin('chatgpt.com'), builtin('claude.ai'), builtin('gemini.google.com')];
  const DEFAULTS = { shortcut: PM.DEFAULT_SHORTCUT, typedTrigger: true, theme: 'system', accent: '#2563EB' };

  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    const sites = (Array.isArray(s.sites) ? s.sites : []).filter((x) => x && x.host).map((x) => Object.assign({ enabled: true, target: null, shortcut: null }, x));
    DEFAULT_SITES.forEach((d) => {
      if (!sites.some((x) => x.host === d.host)) sites.push(Object.assign({}, d));
    });
    const order = (x) => {
      const i = DEFAULT_SITES.findIndex((d) => d.host === x.host);
      return i < 0 ? 100 : i;
    };
    s.sites = sites.map((x, i) => [x, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map((x) => x[0]);
    if (!s.shortcut || (!s.shortcut.code && !s.shortcut.key)) s.shortcut = PM.DEFAULT_SHORTCUT;
    return s;
  }

  async function syncOn() {
    const r = await S.local.get('_sync');
    return r._sync !== false;
  }
  async function area() {
    return (await syncOn()) ? S.sync : S.local;
  }
  let devCache = null;
  async function deviceId() {
    if (devCache) return devCache;
    const r = await S.local.get('_device');
    if (r._device) return (devCache = r._device);
    devCache = PM.uid();
    await S.local.set({ _device: devCache });
    return devCache;
  }

  function friendly(e) {
    const msg = (e && e.message) || String(e);
    if (/QUOTA_BYTES_PER_ITEM/.test(msg)) return new Error('This prompt is too large to save.');
    if (/QUOTA_BYTES/.test(msg)) return new Error(SYNC_NAME + ' is full (100 KB for this extension). Delete some prompts, or turn off sync in Settings › Sync & backup.');
    if (/MAX_ITEMS/.test(msg)) return new Error('Too many prompts for ' + SYNC_NAME + '. Turn off sync in Settings › Sync & backup to store more.');
    if (/MAX_WRITE_OPERATIONS/.test(msg)) return new Error(SYNC_NAME + ' is busy (too many saves in a short time). Try again in a minute.');
    if (/quota/i.test(msg)) return new Error(SYNC_NAME + ' is full. Delete some prompts, or turn off sync in Settings › Sync & backup.');
    return new Error(msg);
  }
  async function write(a, items) {
    try {
      await a.set(items);
    } catch (e) {
      throw friendly(e);
    }
  }

  // Split a string into pieces whose JSON encoding fits the byte budget.
  function splitBytes(str, firstBudget, budget) {
    if (!str.length) return [''];
    const out = [];
    let i = 0;
    let b = firstBudget;
    while (i < str.length) {
      let lo = 1, hi = str.length - i, best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (size(JSON.stringify(str.slice(i, i + mid))) <= b) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      let end = i + best;
      const c = str.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff && end - i > 1) end--;
      out.push(str.slice(i, end));
      i = end;
      b = budget;
    }
    return out;
  }

  function encode(p) {
    const key = 'p.' + p.id;
    const body = JSON.stringify({ t: p.title || '', x: p.text || '', f: p.folder || '', g: p.tags || [], d: p.defaults || {}, c: p.c || p.u || Date.now() });
    const meta = { u: p.u || Date.now(), pu: p.pu || 0, dev: p.dev || '' };
    const headOverhead = size(key) + size(JSON.stringify(Object.assign({ n: 9999, d: '' }, meta))) + 32;
    const chunks = splitBytes(body, ITEM_MAX - headOverhead, ITEM_MAX - size(key + '.9999') - 32);
    const items = {};
    items[key] = Object.assign({}, meta, { n: chunks.length, d: chunks[0] });
    for (let i = 1; i < chunks.length; i++) items[key + '.' + i] = chunks[i];
    return items;
  }

  function decodeAll(all) {
    const prompts = [];
    const incomplete = [];
    for (const k of Object.keys(all)) {
      const m = HEAD_RE.exec(k);
      if (!m) continue;
      const head = all[k];
      if (!head || typeof head.d !== 'string') continue;
      let s = head.d;
      let ok = true;
      for (let i = 1; i < (head.n || 1); i++) {
        const c = all[k + '.' + i];
        if (typeof c !== 'string') {
          ok = false;
          break;
        }
        s += c;
      }
      if (!ok) {
        incomplete.push(m[1]);
        continue;
      }
      try {
        const b = JSON.parse(s);
        prompts.push({
          id: m[1], title: b.t || '', text: b.x || '', folder: b.f || '', tags: Array.isArray(b.g) ? b.g : [],
          defaults: b.d && typeof b.d === 'object' ? b.d : {}, c: b.c || head.u, u: head.u || 0, pu: head.pu || 0, dev: head.dev || ''
        });
      } catch (e) {
        incomplete.push(m[1]);
      }
    }
    prompts.sort((a, b) => a.title.localeCompare(b.title));
    return { prompts, incomplete };
  }

  function chunkKeys(id, from, to) {
    const out = [];
    for (let i = Math.max(from, 1); i < to; i++) out.push('p.' + id + '.' + i);
    return out;
  }

  async function updateMirror(recs, removedIds) {
    if (!(await syncOn())) return;
    const r = await S.local.get('_mirror');
    const m = r._mirror || {};
    (recs || []).forEach((p) => (m[p.id] = p));
    (removedIds || []).forEach((id) => delete m[id]);
    await S.local.set({ _mirror: m });
  }

  function clean(p) {
    return {
      id: p.id, title: String(p.title || '').trim(), text: String(p.text || ''), folder: PM.normFolder(p.folder),
      tags: Array.from(new Set((p.tags || []).map(PM.normTag).filter(Boolean))), defaults: p.defaults || {},
      c: p.c, u: p.u, pu: p.pu, dev: p.dev
    };
  }

  // Save several prompts in ONE storage write (sync allows ~120 writes per minute).
  async function savePrompts(list, opts) {
    opts = opts || {};
    const a = await area();
    const me = await deviceId();
    const heads = await a.get(list.filter((p) => p.id).map((p) => 'p.' + p.id));
    const items = {};
    const stale = [];
    const recs = [];
    const now = Date.now();
    list.forEach((p, i) => {
      const rec = clean(Object.assign({}, p, { id: p.id || PM.uid() + i.toString(36) }));
      const head = heads['p.' + rec.id];
      if (!opts.keepMeta) {
        rec.pu = head ? head.u : 0;
        rec.u = Math.max(now, head ? head.u + 1 : 0);
        rec.dev = me;
      }
      if (!rec.c) rec.c = rec.u;
      const enc = encode(rec);
      Object.assign(items, enc);
      if (head) stale.push(...chunkKeys(rec.id, enc['p.' + rec.id].n, head.n || 1));
      recs.push(rec);
    });
    await write(a, items);
    if (stale.length) await a.remove(stale);
    await updateMirror(recs);
    return recs;
  }

  PM.store = {
    SYNC_QUOTA,
    DEFAULT_SITES,
    syncOn,
    deviceId,
    _decodeAll: decodeAll,
    _encode: encode,
    _splitBytes: splitBytes,

    newSite(host) {
      return { host, builtin: false, enabled: true, target: null, shortcut: PM.KNOWN_CONFLICTS[host] ? PM.CONFLICT_SHORTCUT : null };
    },

    async getSettings() {
      const a = await area();
      const r = await a.get('settings');
      return normalizeSettings(r.settings);
    },
    async saveSettings(patch) {
      const a = await area();
      const r = await a.get('settings');
      const next = normalizeSettings(Object.assign({}, normalizeSettings(r.settings), patch));
      await write(a, { settings: next });
      return next;
    },

    async loadPrompts() {
      const a = await area();
      return decodeAll(await a.get(null)).prompts;
    },
    async savePrompt(p) {
      return (await savePrompts([p]))[0];
    },
    savePrompts,
    async deletePrompt(id) {
      const a = await area();
      const key = 'p.' + id;
      const head = (await a.get(key))[key];
      await a.remove([key].concat(chunkKeys(id, 1, (head && head.n) || 1)));
      const r = await S.local.get('_recent');
      await S.local.set({ _recent: (r._recent || []).filter((x) => x !== id) });
      await updateMirror([], [id]);
    },

    async getRecent() {
      const r = await S.local.get('_recent');
      return Array.isArray(r._recent) ? r._recent : [];
    },
    async pushRecent(id) {
      const list = (await this.getRecent()).filter((x) => x !== id);
      list.unshift(id);
      await S.local.set({ _recent: list.slice(0, 10) });
    },
    async setRecent(ids) {
      await S.local.set({ _recent: ids.filter((x) => typeof x === 'string').slice(0, 10) });
    },

    async usage() {
      const on = await syncOn();
      const a = on ? S.sync : S.local;
      const all = await a.get(null);
      const keys = Object.keys(all).filter((k) => k === 'settings' || k.slice(0, 2) === 'p.');
      const bytes = keys.length ? await bytesInUse(a, keys) : 0;
      return { sync: on, bytes, quota: on ? SYNC_QUOTA : LOCAL_QUOTA };
    },

    // Turn browser sync on or off for this computer, moving the library across.
    async setSyncOn(on) {
      const cur = await syncOn();
      if (cur === on) return;
      const pick = (all) => {
        const out = {};
        for (const k in all) if (k === 'settings' || k.slice(0, 2) === 'p.') out[k] = all[k];
        return out;
      };
      if (!on) {
        const data = pick(await S.sync.get(null));
        const oldLocal = Object.keys(pick(await S.local.get(null)));
        if (oldLocal.length) await S.local.remove(oldLocal);
        await S.local.set(data);
        await S.local.set({ _sync: false });
        return;
      }
      const localAll = pick(await S.local.get(null));
      const remoteAll = await S.sync.get(null);
      const local = decodeAll(localAll).prompts;
      const remote = decodeAll(remoteAll).prompts;
      const toWrite = local.filter((p) => {
        const r = remote.find((x) => x.id === p.id);
        return !r || r.u < p.u;
      });
      const items = {};
      toWrite.forEach((p) => Object.assign(items, encode(p)));
      if (!remoteAll.settings && localAll.settings) items.settings = localAll.settings;
      const used = await bytesInUse(S.sync, null);
      const adding = size(JSON.stringify(items));
      if (used + adding > SYNC_QUOTA) {
        throw new Error('Your library (' + PM.formatBytes(used + adding) + ') is larger than ' + SYNC_NAME + ' allows (100 KB). Delete some prompts first, or keep sync off.');
      }
      if (Object.keys(items).length) await write(S.sync, items);
      await S.local.set({ _sync: true });
      await S.local.remove(Object.keys(localAll));
      await updateMirror(decodeAll(await S.sync.get(null)).prompts);
    },

    async exportData() {
      const prompts = await this.loadPrompts();
      return {
        format: 'prolly',
        version: 1,
        exportedAt: new Date().toISOString(),
        prompts: prompts.map((p) => ({ id: p.id, title: p.title, text: p.text, folder: p.folder, tags: p.tags, defaults: p.defaults, created: p.c, updated: p.u }))
      };
    },
    // Merge a backup into the library. Same id: the newer version wins.
    async importData(obj) {
      const list = Array.isArray(obj) ? obj : obj && Array.isArray(obj.prompts) ? obj.prompts : null;
      if (!list) throw new Error('This file is not a Prolly backup.');
      const existing = await this.loadPrompts();
      const res = { added: 0, updated: 0, skipped: 0 };
      const out = [];
      list.forEach((raw) => {
        if (!raw || typeof raw.text !== 'string') {
          res.skipped++;
          return;
        }
        const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : null;
        const cur = id && existing.find((p) => p.id === id);
        const rec = { id: id || undefined, title: raw.title || '', text: raw.text, folder: raw.folder || '', tags: Array.isArray(raw.tags) ? raw.tags : [], defaults: raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {}, c: raw.created || undefined };
        if (cur) {
          const same = cur.title === rec.title && cur.text === rec.text && cur.folder === PM.normFolder(rec.folder);
          if (same || (raw.updated || 0) <= cur.u) {
            res.skipped++;
            return;
          }
          res.updated++;
        } else res.added++;
        out.push(rec);
      });
      if (out.length) await savePrompts(out);
      return res;
    },

    // cb(changes, areaName) for prompt/settings changes in either area.
    onChanged(cb) {
      ext.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' && areaName !== 'local') return;
        const keys = Object.keys(changes).filter((k) => k === 'settings' || k === '_sync' || k.slice(0, 2) === 'p.');
        if (keys.length) cb(changes, areaName);
      });
    }
  };
})();
