// Background script: registers the content script on sites you add, finishes "Use Prolly on this site",
// keeps a copy of a prompt edited on two computers at once, syncs with Google Drive, and seeds starter
// prompts on install.
// Chrome runs it as a service worker and loads the shared files here. Firefox runs it as an event page
// and its manifest lists the shared files before this one (see scripts/firefox-manifest.js).
if (typeof importScripts === 'function') importScripts('shared/core.js', 'shared/template.js', 'shared/store.js', 'shared/mdfile.js', 'shared/filesync.js', 'shared/drive.js');
const PM = self.PM;

const CONTENT_JS = [
  'shared/core.js', 'shared/template.js', 'shared/theme.js', 'shared/store.js', 'shared/ui-css.js',
  'shared/ui-picker.js', 'shared/ui-fill.js', 'shared/ui-editor.js', 'content/content.js'
];
const BUILTIN_URLS = ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*'];

let chain = Promise.resolve();
function serial(fn) {
  chain = chain.then(fn).catch((e) => console.warn('[Prolly]', e));
  return chain;
}

// ---------- Content scripts for sites you added ----------
async function syncContentScripts() {
  const s = await PM.store.getSettings();
  const origins = [];
  for (const site of s.sites) {
    if (site.builtin || site.enabled === false) continue;
    const pats = PM.sitePatterns(site.host);
    if (await ext.permissions.contains({ origins: pats })) origins.push(...pats);
  }
  const existing = await ext.scripting.getRegisteredContentScripts({ ids: ['pm-custom'] });
  if (existing.length) await ext.scripting.unregisterContentScripts({ ids: ['pm-custom'] });
  if (origins.length) {
    await ext.scripting.registerContentScripts([
      { id: 'pm-custom', matches: [...new Set(origins)], js: CONTENT_JS, runAt: 'document_start', allFrames: false, persistAcrossSessions: true }
    ]);
  }
}

async function injectInto(tabId) {
  try {
    await ext.scripting.executeScript({ target: { tabId }, files: CONTENT_JS });
    return true;
  } catch (e) {
    return false;
  }
}

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      ext.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      setTimeout(resolve, 400);
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, 30000);
    ext.tabs.onUpdated.addListener(onUpd);
  });
}

async function enableSite({ host, tabId, openTab }) {
  host = PM.normHost(host);
  if (!host) return;
  const s = await PM.store.getSettings();
  const sites = s.sites.slice();
  const i = sites.findIndex((x) => x.host === host);
  if (i < 0) sites.push(PM.store.newSite(host));
  else sites[i] = Object.assign({}, sites[i], { enabled: true });
  await PM.store.saveSettings({ sites });
  await syncContentScripts();
  if (tabId != null) {
    await injectInto(tabId);
    await ext.tabs.sendMessage(tabId, { type: 'pm:pickTarget' }).catch(() => {});
  } else if (openTab) {
    const tab = await ext.tabs.create({ url: 'https://' + host + '/' });
    await waitForTab(tab.id);
    await ext.tabs.sendMessage(tab.id, { type: 'pm:pickTarget' }).catch(async () => {
      await injectInto(tab.id);
      await ext.tabs.sendMessage(tab.id, { type: 'pm:pickTarget' }).catch(() => {});
    });
  }
}

ext.permissions.onAdded.addListener(() =>
  serial(async () => {
    const { _pendingSite: p } = await ext.storage.local.get('_pendingSite');
    if (p && Date.now() - (p.at || 0) < 10 * 60 * 1000) {
      await ext.storage.local.remove('_pendingSite');
      await enableSite(p);
    } else {
      await syncContentScripts();
    }
  }));
ext.permissions.onRemoved.addListener(() => serial(syncContentScripts));

// ---------- Edited on two computers: keep both ----------
const same = (a, b) =>
  a.title === b.title && a.text === b.text && (a.folder || '') === (b.folder || '') &&
  (a.tags || []).join(',') === (b.tags || []).join(',') && JSON.stringify(a.defaults || {}) === JSON.stringify(b.defaults || {});

async function reconcile() {
  if (!(await PM.store.syncOn())) return;
  const me = await PM.store.deviceId();
  const all = await ext.storage.sync.get(null);
  const { prompts, incomplete } = PM.store._decodeAll(all);
  const { _mirror: mirror = {} } = await ext.storage.local.get('_mirror');
  const writes = [];
  for (const p of prompts) {
    const m = mirror[p.id];
    if (!m || m.u === p.u) continue;
    // Our last version came from this computer, the new one from another, and it was not based on ours.
    const concurrent = m.dev === me && p.dev && p.dev !== me && p.pu !== m.u;
    if (!concurrent || same(m, p)) continue;
    const oursNewer = m.u > p.u;
    const loser = oursNewer ? p : m;
    const copyId = (p.id + 'c' + loser.u.toString(36)).slice(0, 40);
    if (!all['p.' + copyId]) {
      writes.push(Object.assign({}, loser, { id: copyId, title: loser.title + ' (copy)', u: Date.now(), pu: 0, dev: me }));
    }
    if (oursNewer) writes.push(Object.assign({}, m, { pu: p.u, dev: me }));
  }
  if (writes.length) await PM.store.savePrompts(writes, { keepMeta: true });
  const next = {};
  prompts.forEach((p) => (next[p.id] = p));
  incomplete.forEach((id) => mirror[id] && (next[id] = mirror[id]));
  writes.forEach((w) => (next[w.id] = w));
  await ext.storage.local.set({ _mirror: next });
}
let recTimer = 0;

// ---------- Google Drive ----------
// While Drive is connected, browser sync is off: the library lives in storage.local and this copies
// changes both ways with the Prolly folder (shared/filesync.js). It runs a few seconds after an edit,
// every 5 minutes, and when the settings page asks.
const DRIVE_ALARM = 'pm-drive';
// After these, only a click on the settings page tries again.
const DRIVE_WAITS_FOR_USER = ['FOLDER_GONE', 'MASS_DELETE', 'SCOPE', 'SETUP'];
const library = {
  load: () => PM.store.loadPrompts(),
  save: (list) => PM.store.savePrompts(list, { keepMeta: true }),
  remove: (id) => PM.store.deletePrompt(id)
};

async function driveSync(opts) {
  opts = opts || {};
  const st = await PM.drive.getState();
  if (!st.connected) return st;
  if (opts.auto && st.lastError && DRIVE_WAITS_FOR_USER.indexOf(st.lastError.code) >= 0) return st;
  // Edits made on this computer before Drive was connected may still be in browser sync.
  if (await PM.store.syncOn()) await PM.store.setSyncOn(false);
  try {
    const res = await PM.fileSync.run({ provider: PM.drive.provider(st.folderId), local: library, state: st, localOnly: opts.localOnly, massDelete: opts.massDelete });
    if (res.skipped) return st;
    return PM.drive.setState({ files: res.state.files, lastSync: Date.now(), lastError: null, lastStats: res.stats });
  } catch (e) {
    console.warn('[Prolly] Google Drive sync:', e);
    const patch = { lastError: { code: e.code || 'ERROR', message: (e && e.message) || String(e), count: e.count || 0, at: Date.now() } };
    if (e.state) patch.files = e.state.files;
    return PM.drive.setState(patch);
  }
}

async function driveAlarm() {
  const st = await PM.drive.getState();
  if (!st.connected) return ext.alarms.clear(DRIVE_ALARM);
  if (!(await ext.alarms.get(DRIVE_ALARM))) await ext.alarms.create(DRIVE_ALARM, { periodInMinutes: 5 });
}
ext.alarms.onAlarm.addListener((a) => {
  if (a.name === DRIVE_ALARM) serial(() => driveSync({ auto: true }));
});

async function driveCommand(msg) {
  switch (msg.op) {
    case 'connected': // the settings page finished signing in
      await driveAlarm();
      return driveSync();
    case 'sync':
      return driveSync();
    case 'resolve': // after MASS_DELETE: 'restore' or 'apply'
      return driveSync({ massDelete: msg.choice === 'apply' ? 'apply' : 'restore' });
    case 'newFolder':
      await PM.drive.newFolder();
      return driveSync();
    case 'disconnect':
      await PM.drive.disconnect();
      await driveAlarm();
      return PM.drive.getState();
  }
  return PM.drive.getState();
}

let driveTimer = 0;
ext.storage.onChanged.addListener((changes, area) => {
  if (changes.settings || changes._sync) serial(syncContentScripts);
  if (area === 'sync' && Object.keys(changes).some((k) => k.slice(0, 2) === 'p.')) {
    clearTimeout(recTimer);
    recTimer = setTimeout(() => serial(reconcile), 1500);
  }
  // Includes the sync's own writes: those find nothing to do and make no request (localOnly).
  if (area === 'local' && Object.keys(changes).some((k) => k.slice(0, 2) === 'p.')) {
    clearTimeout(driveTimer);
    driveTimer = setTimeout(() => serial(() => driveSync({ localOnly: true, auto: true })), 2000);
  }
});

// ---------- Messages from the popup, options page and content script ----------
ext.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'pm:active' && sender.tab) {
    ext.action.setTitle({ tabId: sender.tab.id, title: 'Prolly · active on this site' }).catch(() => {});
    return;
  }
  if (msg.type === 'pm:enableSite') {
    serial(async () => {
      await ext.storage.local.remove('_pendingSite');
      await enableSite(msg);
    }).then(() => respond({ ok: true }));
    return true;
  }
  if (msg.type === 'pm:drive') {
    serial(() => driveCommand(msg)).then((state) => respond({ ok: true, state }));
    return true;
  }
  if (msg.type === 'pm:inject' && typeof msg.tabId === 'number') {
    injectInto(msg.tabId).then((ok) => respond({ ok }));
    return true;
  }
});

// ---------- Install ----------
const SEED = [
  { title: 'Code review', folder: 'Dev', tags: ['review', 'code'], text: 'Review this #language# code for bugs, security issues and readability. Pay special attention to #focus#.\n\nWhere it helps, suggest more idiomatic #language# alternatives. Return the findings as a #format:numbered list|table|checklist#, ordered by severity.' },
  { title: 'Explain like a senior engineer', folder: 'Dev', tags: ['learning'], text: 'Explain #concept# as if I were a #level:junior|mid-level|senior# developer. Use one concrete example from #domain#, then list the three mistakes people make most often.' },
  { title: 'Write unit tests', folder: 'Dev/Testing', tags: ['testing'], text: 'Write #framework# unit tests for the function below. Cover the happy path, empty inputs and #edge_case#. Explain each test in one line.' },
  { title: 'Commit message from diff', folder: 'Dev', tags: ['git'], text: 'Write a conventional commit message for the diff below. Subject under 72 characters, then a short body explaining why, not what.' },
  { title: 'Translate & localize', folder: 'Writing', tags: ['translation'], text: 'Translate the text below into #language#, keeping a #tone:formal|friendly|playful# tone. Flag any idiom that does not carry over and suggest a local equivalent.' },
  { title: 'Summarize a paper', folder: 'Research', tags: ['summary'], text: 'Summarize this paper in #length:one paragraph|five bullets|one page# for a #audience# audience. Start with the main claim, then the method, then the limitations the authors admit.' },
  { title: 'Meeting notes → action items', folder: 'Ops', tags: ['meetings'], text: 'Turn the notes below into action items. For each one give an owner, a due date if mentioned, and a one-line description. Group them by person.' }
];

ext.runtime.onInstalled.addListener((details) =>
  serial(async () => {
    if (details.reason === 'install') {
      const existing = await PM.store.loadPrompts();
      if (!existing.length) await PM.store.savePrompts(SEED);
    }
    await syncContentScripts();
    await driveAlarm();
    // Start in tabs that were already open.
    const tabs = await ext.tabs.query({ url: BUILTIN_URLS });
    for (const t of tabs) await injectInto(t.id);
    if (details.reason === 'install') ext.tabs.create({ url: ext.runtime.getURL('options/options.html#library') });
  }));
ext.runtime.onStartup.addListener(() =>
  serial(async () => {
    await syncContentScripts();
    await driveAlarm();
    await driveSync({ auto: true });
  }));
