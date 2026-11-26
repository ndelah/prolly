# Proof of concept: Prolly prompts as Claude Code commands

A standalone script, not part of the extension. It reads a Prolly backup (Settings → Sync & backup → **Export JSON**) and writes one Claude Code slash command per prompt. Prolly itself is unchanged, and `scripts/build.sh` doesn't copy this folder into the extension.

## Try it

```bash
# 1. Export your library from Prolly, then, from this folder:
node prolly-to-claude.mjs ~/Downloads/prolly-backup.json --project ~/path/to/some/project

# or try the sample first
node prolly-to-claude.mjs sample-backup.json --project ~/path/to/some/project --dry-run
```

Then open Claude Code in that project and type `/prolly:` to list your prompts.

| Option | What it does |
| --- | --- |
| `--project <dir>` | Write to `<dir>/.claude/commands/prolly/` (default: the current folder) |
| `--user` | Write to `~/.claude/commands/prolly/` instead, for every project |
| `--namespace <name>` | Change the `prolly` prefix (`--namespace ""` for none) |
| `--dry-run` | Show what would be written, write nothing |

Run it again after changing prompts in Prolly: it replaces the files it wrote before (they carry a `prolly-id`), so deleted prompts disappear. Other files in the folder are left alone.

## How a prompt becomes a command

- **Name:** the title, lowercased and joined with dashes, in the `prolly` subfolder, so *Code review* becomes `/prolly:code-review`. The folder is shown in the description.
- **No variables:** the text as it is.
- **One variable:** it takes everything you type after the command, spaces included: `/prolly:explain-like-im-new the sync layer`.
- **Several variables:** one argument each, in order of first use. Quote values with spaces: `/prolly:code-review Go "very strict"`. Choices and defaults appear in the argument hint, shown in Claude Code's `/` menu.
- **Defaults:** Claude Code has none, and leaves an unfilled placeholder as text. Prompts with defaults get a last line that tells Claude which values to use for anything left unfilled.

## Checked with Claude Code 2.1.321

- `$ARGUMENTS[0]` is the **first** argument (counted from 0), and quoted values stay as one argument.
- A missing argument stays as `$ARGUMENTS[1]` in the text; the defaults line covers it.
- `$5` in a prompt stayed as `$5` when there were fewer arguments.
- A subfolder of `.claude/commands/` gives `/<subfolder>:<name>`.
- With a one-variable prompt, **everything after the command name goes into the variable**, including any extra instructions you type after it.

## Things it refuses or warns about

- Prompts containing `` !`…` `` are **skipped**: Claude Code would run that as a shell command.
- Prompts containing `$<number>` or `$ARGUMENTS` get a warning: with enough arguments, Claude Code could replace them.
