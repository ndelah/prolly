// Google Drive: sign-in, and a file provider for PM.fileSync (see filesync.js for what a provider does).
//
// Prompts are kept as one Markdown file each in a visible "Prolly" folder in My Drive, so people can
// open their own files, and Google Drive for desktop copies the folder onto the computer. Prolly asks
// only for the drive.file permission: the files Prolly creates, nothing else in the Drive.
//
// Sign-in uses identity.launchWebAuthFlow (Chrome and Firefox) with Google's token flow. A token
// lasts an hour. After that Prolly asks Google again without showing anything (prompt=none), and
// only says "Sign in again" if Google wants the person to pick an account or approve again.
//
// State, in storage.local under _drive (per computer, never synced):
//   { connected, email, folderId, files, lastSync, lastError, lastStats }
// The token is kept in storage.session (gone when the browser closes), or storage.local without it.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.drive) return;

  // OAuth client ID (type "Web application") from Google Cloud. Its authorized redirect URIs must
  // include PM.drive.redirectURL() for each browser. See README › "Google Drive setup".
  const CLIENT_ID = '';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const FOLDER_NAME = 'Prolly';
  const FILE_FIELDS = 'id,name,version,modifiedTime';
  const STATE_KEY = '_drive';
  const TOKEN_KEY = '_driveToken';

  const tokenArea = () => ext.storage.session || ext.storage.local;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const SIGN_IN_AGAIN = 'Google needs you to sign in again.';

  // ---------- State ----------
  async function getState() {
    const r = await ext.storage.local.get(STATE_KEY);
    return r[STATE_KEY] || { connected: false };
  }
  async function setState(patch) {
    const next = Object.assign({}, await getState(), patch);
    await ext.storage.local.set({ [STATE_KEY]: next });
    return next;
  }

  // ---------- Sign-in ----------
  function redirectURL() {
    try {
      return ext.identity && ext.identity.getRedirectURL ? ext.identity.getRedirectURL() : '';
    } catch (e) {
      return '';
    }
  }

  async function authorize(interactive, hint) {
    if (!CLIENT_ID) throw fail('SETUP', 'Google Drive is not set up in this build of Prolly.');
    if (!ext.identity || !ext.identity.launchWebAuthFlow) throw fail('SETUP', 'This browser does not let extensions sign in to Google.');
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'token', redirect_uri: redirectURL(), scope: SCOPE,
      include_granted_scopes: 'true', prompt: interactive ? 'select_account' : 'none'
    });
    if (hint) q.set('login_hint', hint);
    const details = { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, interactive: !!interactive };
    // Chrome closes a silent flow as soon as the first page loads; Google may need a moment to redirect.
    // (Firefox rejects options it does not know, so only Chrome gets these.)
    if (!interactive && !PM.isFirefox) Object.assign(details, { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 15000 });
    let url;
    try {
      url = await ext.identity.launchWebAuthFlow(details);
    } catch (e) {
      throw interactive ? fail('CANCELLED', 'Google sign-in was closed before it finished.') : fail('AUTH', SIGN_IN_AGAIN);
    }
    const r = new URLSearchParams((new URL(url).hash || '').slice(1));
    if (r.get('error')) {
      if (interactive && r.get('error') === 'access_denied') throw fail('CANCELLED', 'Google sign-in was cancelled.');
      throw fail('AUTH', SIGN_IN_AGAIN);
    }
    const token = r.get('access_token');
    if (!token) throw fail('AUTH', SIGN_IN_AGAIN);
    // Google lets people untick a permission on the consent screen.
    const granted = (r.get('scope') || SCOPE).split(/\s+/);
    if (granted.indexOf(SCOPE) < 0) {
      throw fail('SCOPE', 'Prolly needs access to the files it creates in your Google Drive. Connect again and leave that box ticked.');
    }
    const ttl = (Number(r.get('expires_in')) || 3600) * 1000;
    await tokenArea().set({ [TOKEN_KEY]: { token, exp: Date.now() + ttl - 60000 } });
    return token;
  }

  async function token(fresh) {
    if (!fresh) {
      const t = (await tokenArea().get(TOKEN_KEY))[TOKEN_KEY];
      if (t && t.exp > Date.now()) return t.token;
    }
    return authorize(false, (await getState()).email);
  }

  // ---------- Requests ----------
  async function request(url, opts) {
    opts = opts || {};
    let fresh = false;
    for (let attempt = 0; ; attempt++) {
      const t = await token(fresh);
      let res;
      try {
        res = await fetch(url, { method: opts.method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}), body: opts.body });
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw fail('NETWORK', 'Could not reach Google Drive. Check your connection.');
      }
      if (res.ok) return res;
      if (res.status === 401) {
        if (fresh) throw fail('AUTH', SIGN_IN_AGAIN);
        fresh = true;
        continue;
      }
      let detail = '';
      try {
        const e = (await res.clone().json()).error || {};
        detail = ((e.errors && e.errors[0] && e.errors[0].reason) || '') + ' ' + (e.message || '');
      } catch (e) { /* no JSON body */ }
      const busy = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit/i.test(detail));
      if (busy && attempt < 4) {
        await sleep(Math.min(16000, 1000 * 2 ** attempt) + Math.random() * 500);
        continue;
      }
      if (res.status === 404) throw fail('NOT_FOUND', 'Not found in Google Drive.');
      if (/storageQuotaExceeded/.test(detail)) throw fail('FULL', 'Your Google Drive is full.');
      throw fail('HTTP', 'Google Drive refused the request (' + res.status + (detail.trim() ? ': ' + detail.trim() : '') + ').');
    }
  }
  const getJson = async (url) => (await request(url)).json();
  const sendJson = async (url, method, body) => (await request(url, { method, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) })).json();

  function multipart(method, metadata, text) {
    let b;
    do b = 'prolly-' + Math.random().toString(36).slice(2); while (text.indexOf(b) >= 0);
    const body =
      '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
      '--' + b + '\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n' + text + '\r\n--' + b + '--';
    return { method, headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body };
  }
  const meta = (f) => ({ id: f.id, name: f.name, rev: String(f.version), modified: Date.parse(f.modifiedTime) || 0 });
  const enc = encodeURIComponent;
  const quote = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  // ---------- Folder ----------
  async function findFolder() {
    const q = 'name = ' + quote(FOLDER_NAME) + " and mimeType = '" + FOLDER_MIME + "' and 'root' in parents and trashed = false";
    const r = await getJson(API + '/files?' + new URLSearchParams({ q, fields: 'files(id,name)', orderBy: 'createdTime', pageSize: '10', spaces: 'drive' }));
    return (r.files && r.files[0]) || null;
  }
  const createFolder = () => sendJson(API + '/files?fields=id,name', 'POST', { name: FOLDER_NAME, mimeType: FOLDER_MIME });
  async function folderOk(id) {
    try {
      const f = await getJson(API + '/files/' + enc(id) + '?fields=id,trashed');
      return !f.trashed;
    } catch (e) {
      if (e.code === 'NOT_FOUND') return false;
      throw e;
    }
  }

  // ---------- Provider ----------
  function provider(folderId) {
    return {
      async list() {
        if (!(await folderOk(folderId))) throw fail('FOLDER_GONE', 'The Prolly folder is no longer in your Google Drive. It may be in the bin.');
        const out = [];
        let pageToken = '';
        do {
          const q = new URLSearchParams({
            q: quote(folderId) + ' in parents and trashed = false',
            fields: 'nextPageToken,files(mimeType,' + FILE_FIELDS + ')', pageSize: '1000', spaces: 'drive'
          });
          if (pageToken) q.set('pageToken', pageToken);
          const r = await getJson(API + '/files?' + q);
          for (const f of r.files || []) if (f.mimeType !== FOLDER_MIME && /\.md$/i.test(f.name)) out.push(meta(f));
          pageToken = r.nextPageToken || '';
        } while (pageToken);
        return out;
      },
      async read(id) {
        return (await request(API + '/files/' + enc(id) + '?alt=media')).text();
      },
      async create(name, text) {
        const opts = multipart('POST', { name, parents: [folderId], mimeType: 'text/markdown' }, text);
        return meta(await (await request(UPLOAD + '/files?uploadType=multipart&fields=' + FILE_FIELDS, opts)).json());
      },
      async update(id, name, text) {
        const opts = multipart('PATCH', { name }, text);
        return meta(await (await request(UPLOAD + '/files/' + enc(id) + '?uploadType=multipart&fields=' + FILE_FIELDS, opts)).json());
      },
      // To the bin, not deleted: Drive keeps it 30 days.
      async remove(id) {
        await sendJson(API + '/files/' + enc(id) + '?fields=id', 'PATCH', { trashed: true });
      }
    };
  }

  PM.drive = {
    configured: () => !!CLIENT_ID,
    redirectURL,
    folderURL: (id) => 'https://drive.google.com/drive/folders/' + enc(id),
    getState,
    setState,
    provider,

    // From a click on the settings page: shows Google's sign-in, then finds or creates the folder.
    async connect() {
      await authorize(true);
      const about = await getJson(API + '/about?fields=user(emailAddress)');
      const folder = (await findFolder()) || (await createFolder());
      return setState({
        connected: true, email: (about.user && about.user.emailAddress) || '', folderId: folder.id,
        files: {}, lastSync: 0, lastError: null, lastStats: null
      });
    },
    // "Sign in again": the same account if Google allows it.
    async reauthorize() {
      await authorize(true, (await getState()).email);
      return setState({ lastError: null });
    },
    // The folder was deleted: start a new one. Every prompt is uploaded again on the next sync.
    async newFolder() {
      const folder = await createFolder();
      return setState({ folderId: folder.id, files: {}, lastError: null });
    },
    // Forget the account on this computer. The token is not revoked: revoking it would also sign out
    // every other computer using Prolly with this Google account.
    async disconnect() {
      await tokenArea().remove(TOKEN_KEY);
      await ext.storage.local.remove(STATE_KEY);
    }
  };
})();
