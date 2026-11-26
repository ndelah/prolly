(async function () {
  'use strict';
  const PM = globalThis.PM;
  const h = PM.h;
  const status = document.getElementById('status');
  const openPage = (hash) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#' + hash) });
    window.close();
  };
  document.getElementById('library').addEventListener('click', (e) => { e.preventDefault(); openPage('library'); });
  document.getElementById('settings').addEventListener('click', (e) => { e.preventDefault(); openPage('sites'); });

  const settings = await PM.store.getSettings();
  document.documentElement.style.setProperty('--acc', settings.accent);
  document.documentElement.style.setProperty('--acc-deep', 'color-mix(in srgb, ' + settings.accent + ' 80%, #000)');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try {
    url = new URL(tab.url);
  } catch (e) { /* no access to this tab's address */ }

  const show = (...nodes) => status.replaceChildren(...nodes);
  const btn = (label, onClick, primary) => h('button', { type: 'button', class: primary ? 'primary' : '', onclick: onClick }, label);
  const err = (msg) => {
    const old = status.querySelector('.err');
    if (old) old.remove();
    status.appendChild(h('p', { class: 'err', role: 'alert' }, msg));
  };

  if (!url || !/^https?:$/.test(url.protocol) || /^(chrome\.google\.com|chromewebstore\.google\.com)$/.test(url.hostname)) {
    document.getElementById('kbd').textContent = PM.shortcutLabel(settings.shortcut, true);
    show(h('div', { class: 'state' }, h('span', { class: 'dot' }), 'Not available here'),
      h('p', { class: 'note' }, 'Chrome does not let extensions run on this page. Open an AI chat and press ' + PM.shortcutLabel(settings.shortcut) + ' in its text box.'));
    return;
  }

  const hostname = url.hostname;
  const site = settings.sites.find((s) => PM.hostMatches(hostname, s.host));
  const sc = (site && site.shortcut) || settings.shortcut;
  document.getElementById('kbd').textContent = PM.shortcutLabel(sc, true);
  const ping = () => chrome.tabs.sendMessage(tab.id, { type: 'pm:ping' }).catch(() => null);
  const send = (type) => chrome.tabs.sendMessage(tab.id, { type }).catch(() => null);

  async function enableHere() {
    const host = PM.normHost(hostname);
    const origins = PM.sitePatterns(host);
    await chrome.storage.local.set({ _pendingSite: { host, tabId: tab.id, at: Date.now() } });
    if (await chrome.permissions.contains({ origins })) {
      await chrome.runtime.sendMessage({ type: 'pm:enableSite', host, tabId: tab.id });
      window.close();
      return;
    }
    // The background script finishes the job once Chrome grants access, even if this popup closes.
    const ok = await chrome.permissions.request({ origins }).catch(() => false);
    if (!ok) {
      await chrome.storage.local.remove('_pendingSite');
      err('Prolly needs access to ' + host + ' to work there.');
      return;
    }
    window.close();
  }

  async function turnOn() {
    const sites = settings.sites.map((s) => (s === site ? Object.assign({}, s, { enabled: true }) : s));
    await PM.store.saveSettings({ sites });
    if (!site.builtin) return enableHere();
    await chrome.runtime.sendMessage({ type: 'pm:inject', tabId: tab.id });
    render();
  }

  async function render() {
    const s = await PM.store.getSettings();
    const st = s.sites.find((x) => PM.hostMatches(hostname, x.host));
    const hostEl = h('span', { class: 'host' }, PM.normHost(hostname) || hostname);
    if (!st) {
      show(h('div', { class: 'state' }, h('span', { class: 'dot' }), 'Not active on ', hostEl),
        h('p', { class: 'note' }, 'Use your prompts in this site\'s text boxes too. Chrome will ask to let Prolly read and change this site.'),
        h('div', { class: 'btns' }, btn('Use Prolly on this site', enableHere, true)));
      return;
    }
    if (st.enabled === false) {
      show(h('div', { class: 'state' }, h('span', { class: 'dot' }), 'Turned off on ', hostEl),
        h('div', { class: 'btns' }, btn('Turn on for this site', turnOn, true)));
      return;
    }
    let p = await ping();
    if (!p) {
      if (st.builtin || (await chrome.permissions.contains({ origins: PM.sitePatterns(st.host) }))) {
        await chrome.runtime.sendMessage({ type: 'pm:inject', tabId: tab.id });
        p = await ping();
      }
    }
    if (!p) {
      show(h('div', { class: 'state' }, h('span', { class: 'dot' }), 'Not running on ', hostEl),
        h('p', { class: 'note' }, 'Prolly has no access to this page yet.'),
        h('div', { class: 'btns' }, btn('Use Prolly on this site', enableHere, true)));
      return;
    }
    const where = st.target ? h('p', { class: 'note' }, 'Opens in ', h('code', null, st.target)) : h('p', { class: 'note' }, 'Works in any text box on this site.');
    show(h('div', { class: 'state' }, h('span', { class: 'dot on' }), 'Active on ', hostEl),
      h('p', { class: 'note' }, 'Press ' + PM.shortcutLabel(st.shortcut || s.shortcut) + (s.typedTrigger ? ' or type ;;' : '') + ' in the text box.'),
      where,
      h('div', { class: 'btns' },
        btn('Open the picker', async () => {
          const r = await send('pm:open');
          if (r && r.ok) window.close();
          else err((r && r.reason) || 'Could not open the picker on this page.');
        }, true),
        btn(st.target ? 'Choose another text area' : 'Limit to one text area', async () => {
          await send('pm:pickTarget');
          window.close();
        })));
  }

  render();
})();
