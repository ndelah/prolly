# Changelog

Each release is built with `scripts/release.sh` into `releases/prolly-<version>.zip` (Chrome) and `releases/prolly-<version>-firefox.zip` (Firefox).

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
