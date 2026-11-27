# Prolly — prompt manager for AI chats

Website and live demo: https://prolly.delahousse.xyz

A browser extension (Manifest V3) for Chrome and Firefox that keeps your prompts one shortcut away in ChatGPT, Claude, Gemini and any other site you add. No account, no server: prompts live in your browser and, if you want, in its sync (Chrome sync or Firefox Sync) or in your own Google Drive (once the build has a Google client ID).

## Install (unpacked)

**Chrome** (116 or later)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. A settings tab opens on the Library, with one prompt in it: **Set up my prompt library** (see [Getting started](#getting-started)).

**Firefox** (140 or later, desktop)

1. Run `scripts/build.sh firefox`. It writes the Firefox build to `dist/firefox/`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `dist/firefox/manifest.json`.
4. A settings tab opens on the Library, with one prompt in it: **Set up my prompt library**.

Firefox removes a temporary add-on when it quits. Run `scripts/build.sh firefox` again after changing the code, then click **Reload** on the add-on in `about:debugging`.

Tabs that were already open on chatgpt.com, claude.ai or gemini.google.com get the extension straight away; other tabs may need a reload.

## Getting started

A new library holds one prompt, **Set up my prompt library** (`shared/onboarding.js`).

1. In ChatGPT, Claude or Gemini, open the picker and press ↵ on it. It has no variables, so it goes straight into the message box.
2. The AI looks through your chats (or asks you for examples), then ends its reply with an import block: a code block that starts with `~~~~prolly`.
3. When the block stops changing, a **Prolly found N prompts** bar appears at the top of the page. **Review & import** opens Settings → Library → **Import from AI** with the block loaded. You can also copy the block and paste it there.
4. Review: entries are grouped into Needs a look, Ready and Can't import. Fix one with **Edit** (the usual editor), remove it, or pick **Import as copy** / **Replace existing** for a prompt you already have. Prompts that are ready are ticked; "maybe" prompts, duplicates, prompts that may be cut off and ones that may hold an email address or phone number are not.
5. **Import** adds the ticked prompts. Prompts the AI marked "start here" go to the top of the picker's Recent list. **Undo import** takes it all back.

If the reply is cut off or split into parts, say "continue" in the chat and add the next reply: parts are merged, and a newer copy of a part replaces the older one.

The block format (v1): a `prolly-import v1 | part 1 of 1` header, then entries that start with `=== PROMPT ===` (or `=== MODIFIER ===`), with `title:`, `folder:`, `tags:` and `start-here:` lines, a `---` line and the prompt text, and a final `=== END ===`. The parser (`shared/importer.js`) accepts common variations and says what it changed.

## Use

| Where | Keys |
| --- | --- |
| Open the picker (in a chat's text box) | **Ctrl + ;** (Control + ; on Mac), or type `;;` |
| Picker | ↑ ↓ move · ↵ insert · → open folder · ⌫ / ← back · Tab switch Recent / All / Folders · Ctrl/⌘ + ↵ edit · Esc close |
| Variable bar | Tab / ↵ next field · ← → change a choice · ↵ on the last field or Esc to finish |
| Editor | Ctrl/⌘ + ↵ save · Esc cancel |

**Variables.** Write `#name#` for free text and `#name:a|b|c#` for a fixed choice. The editor finds them as you type and lets you set defaults. In a plain text box, values are filled in place as you type them. In rich editors (ChatGPT, Claude, Gemini), the variable bar shows a preview and inserts the finished text when you're done.

**Folders and tags.** One folder per prompt, at most two levels (`Dev/Testing`). Tags are lowercase words. In the picker, search matches titles, text, folders and tags. Typing the start of a folder or tag name offers it as a row: ↵ opens the folder or filters by the tag.

**Other sites.** Click the toolbar button on any page and choose **Use Prolly on this site**, or go to Settings → Shortcut & sites → **Add a site**. The browser asks for access to that one site, then you click the text area you want to use. You can give a site its own shortcut. docs.google.com gets **Ctrl + Shift + ;** by default because Google Sheets uses Ctrl + ; to insert the date.

## Settings

- **Appearance:** Light, Dark or System theme; six accent colours or any hex value; live preview.
- **Shortcut & sites:** record a new shortcut; turn the `;;` trigger on or off; turn sites on or off.
- **Library → Import from AI:** paste an AI's reply holding an import block, review it and import (see [Getting started](#getting-started)).
- **Sync & backup:** browser sync on or off, with a usage meter; Google Drive sync (when the build has a client ID); JSON export and import (import merges, newer edit wins).

## Google Drive sync

**Connect Google Drive** (Settings → Sync & backup) keeps one Markdown file per prompt in a visible **Prolly** folder in My Drive. There's no 100 KB limit, and the same library works in Chrome and Firefox. People can open their own files, and Google Drive for desktop copies the folder onto the computer (`~/Library/CloudStorage/GoogleDrive-…/My Drive/Prolly` on a Mac, `G:\My Drive\Prolly` on Windows), where other tools can read it.

```
---
id: "lq3k9x2abc"
title: "Code review"
folder: "Dev"
tags: ["review","code"]
updated: "2026-11-26T10:00:00.000Z"
---
Review this #language# code for bugs…
```

- **Permission:** only `drive.file`, which covers the files Prolly creates and nothing else in the Drive. One catch: a new `.md` file added to the folder by hand or by another tool is invisible to Prolly. Edits to files Prolly created come through.
- **When it syncs:** a few seconds after an edit, every 5 minutes, and when Settings opens. Drive can't notify an extension without a server, so Prolly checks. Browser sync is turned off on that computer while Drive is connected.
- **Two-way merge** (`shared/filesync.js`):
  - A change on one side is copied to the other.
  - Edited on both: the newer edit wins and the other becomes "Title (copy)".
  - Deleted on one side but edited on the other: the edit wins.
  - Deleted prompts go to the Drive bin.
  - If many prompts vanish from the folder at once, sync pauses and asks.
  - The starter prompts on a second computer are matched to the ones already in Drive, not duplicated.
- **Disconnect** forgets the account on that computer only. It doesn't revoke Google's permission, which would also sign out every other computer.

### Google Drive setup (developer, once)

1. In [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Configure the **OAuth consent screen**: External, add the scope `https://www.googleapis.com/auth/drive.file`. It's a non-sensitive scope, so it needs Google's brand verification (app name, logo, privacy policy) but not the paid security assessment.
3. Create **Credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs**, add the URL shown in Settings → Sync & backup for each browser:
   - Chrome: `https://<extension-id>.chromiumapp.org/`. An unpacked copy has a different ID from the Web Store one, so register both, or pin the ID with a `key` in the manifest.
   - Firefox: `https://<hash>.extensions.allizom.org/`. It stays the same because the add-on ID is fixed.
4. Put the client ID in `CLIENT_ID` at the top of `shared/drive.js`.

Sign-in uses `identity.launchWebAuthFlow` (Chrome and Firefox) with Google's token flow. Tokens last an hour. Prolly then gets a new one without showing anything, and only asks the person to sign in again if Google requires it.

## Things to know

- **Chrome sync and Firefox Sync give each extension 100 KB** (a few hundred typical prompts). Long prompts are split into pieces to fit the 8 KB per-item limit. If sync is full, saving shows an error. Turn sync off to keep everything on this computer only, with much more room.
- **Edited on two computers at once?** The latest edit wins and the other version is kept as "Title (copy)".
- **Very long prompts** may be turned into an attachment by Claude or ChatGPT when pasted. That is the site's behaviour, not the extension's.
- The picker only opens while the cursor is in a text box on a site where Prolly is on. If a site uses Ctrl + ; itself, give that site its own shortcut or use `;;`.
- **In Firefox, prompts sync only if Add-ons is ticked** in Settings → Sync. Chrome and Firefox don't share a sync: use JSON export and import to move a library between them.
- "Connect Google Drive" needs a Google OAuth client ID in the build (see "Google Drive setup"). Without one, Settings doesn't show Google Drive at all.

## Files

```
manifest.json         MV3 manifest (Chrome); the Firefox one is generated from it
background.js         background script: custom sites, conflict copies, Google Drive sync, the first-run setup prompt, opening Import from AI
content/content.js    runs in chat pages: shortcut, picker, insertion, pick-a-text-area mode, the "Prolly found N prompts" bar
shared/               code shared by every part (DOM helpers, templates, theme, storage, UI)
shared/mdfile.js      a prompt as a Markdown file (front matter + text), file names
shared/filesync.js    two-way sync with any folder of files (Google Drive now, GitHub later)
shared/drive.js       Google Drive sign-in and file access
shared/importer.js    reads the import block an AI writes (parser, checks, import plan)
shared/onboarding.js  the setup prompt a new library starts with
test/                 node --test test/*.test.mjs (Markdown format and sync; the import block parser and the setup prompt)
popup/                toolbar popup
options/              settings page (Library, Import from AI, Appearance, Shortcut & sites, Sync & backup)
icons/                toolbar icons
scripts/build.sh      copies the extension into dist/chrome and dist/firefox, each with its manifest
scripts/firefox-manifest.js   turns manifest.json into the Firefox manifest
scripts/release.sh    builds the versioned release ZIPs
releases/             per version, prolly-<version>.zip (Chrome) and prolly-<version>-firefox.zip, each with a .sha256 checksum
dist/                 build output (not committed)
CHANGELOG.md          what changed in each version
```

## Releases

Each version is zipped into `releases/` and kept there: `prolly-<version>.zip` is the file to upload to the Chrome Web Store, `prolly-<version>-firefox.zip` the one to upload to addons.mozilla.org.

1. Raise `"version"` in `manifest.json` (for example `1.0.1`).
2. Add a `## 1.0.1` section to `CHANGELOG.md`.
3. Run `scripts/release.sh`.

**Firefox differences.** The code is the same for both browsers: it calls `ext.*`, which is Firefox's `browser` or Chrome's `chrome`. Only the manifest differs. `scripts/firefox-manifest.js` makes the Firefox one: the background script runs as an event page (Firefox has no extension service workers), the options page is `options_ui`, and `browser_specific_settings` sets the add-on ID `prolly@delahousse.xyz`, Firefox 140 as the minimum and "no data collected". Keep that ID once the add-on is on addons.mozilla.org: changing it makes a new add-on.

The script takes the name and version from `manifest.json`. It refuses to overwrite an existing version unless you pass `--force`, and it stops if the changelog has no entry for the version. It checks the code's syntax, zips only the files the extension runs, makes sure every file each manifest points to is in its ZIP, checks the Firefox manifest has what addons.mozilla.org needs, and writes a SHA-256 checksum next to each ZIP. If `web-ext` is installed (`npm install --global web-ext`), it also runs Mozilla's linter on the Firefox build.

The overlay runs in a closed shadow root and builds its DOM without `innerHTML`, so page styles, page CSP and Trusted Types don't affect it.

## License

MIT. See [LICENSE](LICENSE).
