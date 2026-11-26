# Changelog

Each release is built with `scripts/release.sh` into `releases/prolly-<version>.zip`.

## 1.0.0 — 2026-11-26

First release.

- Prompt picker on chatgpt.com, claude.ai and gemini.google.com, opened with Ctrl + ; (Control + ; on Mac) or by typing `;;`. It opens as a centered sheet.
- Variables: `#name#` for free text and `#name:a|b|c#` for fixed choices, filled through a variable bar.
- Editor with title, folder (two levels), tags and variables detected as you type, with defaults.
- Recent, All and Folders views, folder and tag filters, and creating a prompt from the search box.
- Any other site can be added, with a choice of text area and an optional shortcut per site.
- Sync through Chrome (100 KB, long prompts split automatically), with a copy kept when a prompt is edited on two computers; JSON export and import.
- Light, dark and system themes, with six accent colors or any hex value.
