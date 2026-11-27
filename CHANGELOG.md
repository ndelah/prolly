# Changelog

Each release is built with `scripts/release.sh` into `releases/prolly-<version>.zip` (Chrome) and `releases/prolly-<version>-firefox.zip` (Firefox).

## Unreleased

In the code since 1.3.0, but hidden until the build has a Google OAuth client ID:

- Google Drive sync (Settings → Sync & backup → Connect Google Drive):
  - One Markdown file per prompt, in a visible "Prolly" folder in My Drive, with access only to the files Prolly creates.
  - No 100 KB limit, and the same library in Chrome and Firefox.
  - Syncs a few seconds after an edit and every 5 minutes, merging changes from both sides.
  - Needs a Google OAuth client ID in `shared/drive.js` (README → "Google Drive setup").

## 1.3.0 — 2026-11-27

- A new library starts with one prompt, **Set up my prompt library**, instead of seven samples. Run in ChatGPT, Claude or Gemini, it asks the AI to find the prompts you reuse, clean them up, sort them into folders and tags, and write them as an import block.
- **Import from AI** (Settings → Library → Import from AI): paste the reply, or click **Review & import** in the bar Prolly shows on the chat page once the block is complete.
  - Review before anything is added: entries are grouped into Needs a look, Ready and Can't import, with the reason shown on each.
  - Fix entries in the usual editor, remove and restore them, and choose between importing a copy or replacing a prompt you already have.
  - Ready prompts are ticked; "maybe" prompts, duplicates, prompts that may be cut off and ones that may hold an email address or phone number are not.
  - Replies cut off or split into parts can be continued: parts are merged.
  - "Start here" prompts go to the top of the picker. **Undo import** takes the whole import back.
- The Library shows how to get started while it holds only the setup prompt.
- New permissions: `identity` and `alarms`, for Google Drive sync (see Unreleased), which stays hidden until the build has a Google client ID. Neither shows a warning at install.

## 1.1.0 — 2026-11-26

- Firefox (140 or later, desktop). Same features as in Chrome, with Firefox Sync in place of Chrome sync. `scripts/build.sh firefox` makes a build to load in `about:debugging`, and `scripts/release.sh` now also builds `prolly-<version>-firefox.zip` for addons.mozilla.org.
- "Use Prolly on this site" and adding a site now ask for access as soon as you click, as Firefox requires. A custom site you turn back on stays off if you refuse access.
- Messages name the browser you use (Chrome or Firefox) instead of always saying Chrome.

## 1.0.0 — 2026-11-26

First release.

- Prompt picker on chatgpt.com, claude.ai and gemini.google.com, opened with Ctrl + ; (Control + ; on Mac) or by typing `;;`. It opens as a centered sheet.
- Variables: `#name#` for free text and `#name:a|b|c#` for fixed choices, filled through a variable bar.
- Editor with title, folder (two levels), tags and variables detected as you type, with defaults.
- Recent, All and Folders views, folder and tag filters, and creating a prompt from the search box.
- Any other site can be added, with a choice of text area and an optional shortcut per site.
- Sync through Chrome (100 KB, long prompts split automatically), with a copy kept when a prompt is edited on two computers; JSON export and import.
- Light, dark and system themes, with six accent colors or any hex value.
