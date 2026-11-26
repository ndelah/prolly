# Prolly — prompt manager for AI chats

Website and live demo: https://prolly.delahousse.xyz

A Chrome extension (Manifest V3) that keeps your prompts one shortcut away in ChatGPT, Claude, Gemini and any other site you add. No account, no server: prompts live in your browser and, if you want, in Chrome sync.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. A settings tab opens on the Library, with a few starter prompts in it.

Tabs that were already open on chatgpt.com, claude.ai or gemini.google.com get the extension straight away; other tabs may need a reload.

## Use

| Where | Keys |
| --- | --- |
| Open the picker (in a chat's text box) | **Ctrl + ;** (Control + ; on Mac), or type `;;` |
| Picker | ↑ ↓ move · ↵ insert · → open folder · ⌫ / ← back · Tab switch Recent / All / Folders · Ctrl/⌘ + ↵ edit · Esc close |
| Variable bar | Tab / ↵ next field · ← → change a choice · ↵ on the last field or Esc to finish |
| Editor | Ctrl/⌘ + ↵ save · Esc cancel |

**Variables.** Write `#name#` for free text and `#name:a|b|c#` for a fixed choice. The editor finds them as you type and lets you set defaults. In a plain text box, values are filled in place as you type them. In rich editors (ChatGPT, Claude, Gemini), the variable bar shows a preview and inserts the finished text when you're done.

**Folders and tags.** One folder per prompt, at most two levels (`Dev/Testing`). Tags are lowercase words. In the picker, search matches titles, text, folders and tags. Typing the start of a folder or tag name offers it as a row: ↵ opens the folder or filters by the tag.

**Other sites.** Click the toolbar button on any page and choose **Use Prolly on this site**, or go to Settings → Shortcut & sites → **Add a site**. Chrome asks for access to that one site, then you click the text area you want to use. You can give a site its own shortcut. docs.google.com gets **Ctrl + Shift + ;** by default because Google Sheets uses Ctrl + ; to insert the date.

## Settings

- **Appearance:** Light, Dark or System theme; six accent colours or any hex value; live preview.
- **Shortcut & sites:** record a new shortcut; turn the `;;` trigger on or off; turn sites on or off.
- **Sync & backup:** Chrome sync on or off, with a usage meter; JSON export and import (import merges, newer edit wins).

## Things to know

- **Chrome sync gives each extension 100 KB** (a few hundred typical prompts). Long prompts are split into pieces to fit Chrome's per-item limit. If sync is full, saving shows an error. Turn sync off to keep everything on this computer only, with much more room.
- **Edited on two computers at once?** The latest edit wins and the other version is kept as "Title (copy)".
- **Very long prompts** may be turned into an attachment by Claude or ChatGPT when pasted. That is the site's behaviour, not the extension's.
- The picker only opens while the cursor is in a text box on a site where Prolly is on. If a site uses Ctrl + ; itself, give that site its own shortcut or use `;;`.
- "Connect Google Drive" is shown as a later option and does nothing yet.

## Files

```
manifest.json         MV3 manifest
background.js         service worker: custom sites, conflict copies, first-run starter prompts
content/content.js    runs in chat pages: shortcut, picker, insertion, pick-a-text-area mode
shared/               code shared by every part (DOM helpers, templates, theme, storage, UI)
popup/                toolbar popup
options/              settings page (Library, Appearance, Shortcut & sites, Sync & backup)
icons/                toolbar icons
scripts/release.sh    builds a versioned release ZIP
releases/             one ZIP per version (prolly-<version>.zip), with a .sha256 checksum
CHANGELOG.md          what changed in each version
```

## Releases

Each version is zipped into `releases/` and kept there. The ZIP is the file to upload to the Chrome Web Store.

1. Raise `"version"` in `manifest.json` (for example `1.0.1`).
2. Add a `## 1.0.1` section to `CHANGELOG.md`.
3. Run `scripts/release.sh`.

The script takes the name and version from `manifest.json`. It refuses to overwrite an existing version unless you pass `--force`, and it stops if the changelog has no entry for the version. It checks the code's syntax, zips only the files the extension runs, makes sure every file the manifest points to is in the ZIP, and writes a SHA-256 checksum next to it.

The overlay runs in a closed shadow root and builds its DOM without `innerHTML`, so page styles, page CSP and Trusted Types don't affect it.
