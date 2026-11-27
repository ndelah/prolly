#!/usr/bin/env node
// Print the Firefox manifest, derived from manifest.json (the Chrome one), so there is one source of truth.
//
//   node scripts/firefox-manifest.js > dist/firefox/manifest.json
//
// What changes for Firefox (desktop, 140 or later):
// - background: Firefox has no extension service workers. It runs the same file as an event page,
//   with the shared files it would importScripts() listed before it.
// - options_page becomes options_ui (opened in a tab, as in Chrome).
// - browser_specific_settings.gecko: a fixed add-on ID (needed for storage.sync and for
//   addons.mozilla.org), the minimum version, and the data collection declaration AMO requires.
// - action.default_area: keep the button on the toolbar instead of inside the extensions menu.
// - Chrome-only keys are dropped and "Chrome" in the description becomes "Firefox".
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const GECKO_ID = 'prolly@delahousse.xyz'; // Never change this once published: it is the add-on's identity on AMO.
const MIN_FIREFOX = '140.0'; // First ESR with host permissions granted at install and data collection consent.

const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const sw = m.background && m.background.service_worker;
if (!sw) throw new Error('manifest.json has no background.service_worker');

// The files background.js loads with importScripts(...), in order.
const bg = fs.readFileSync(path.join(root, sw), 'utf8');
const call = /importScripts\(([^)]*)\)/.exec(bg);
const imports = call ? [...call[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : [];

const ff = {};
for (const [k, v] of Object.entries(m)) {
  if (k === 'minimum_chrome_version') continue;
  if (k === 'background') ff.background = { scripts: [...imports, sw] };
  else if (k === 'options_page') ff.options_ui = { page: v, open_in_tab: true };
  else if (k === 'description') ff.description = v.replace(/\bChrome\b/g, 'Firefox');
  else if (k === 'action') ff.action = Object.assign({}, v, { default_area: 'navbar' });
  else ff[k] = v;
}
ff.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: MIN_FIREFOX,
    data_collection_permissions: { required: ['none'] }
  }
};

process.stdout.write(JSON.stringify(ff, null, 2) + '\n');
