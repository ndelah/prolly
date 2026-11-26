#!/usr/bin/env node
// Proof of concept: turn a Prolly JSON backup into Claude Code slash commands.
// Not part of the extension. Nothing here is loaded by Prolly or packed into its ZIPs.
//
//   node prolly-to-claude.mjs <backup.json> [--project <dir>] [--user] [--namespace <name>] [--dry-run]
//
//   --project <dir>   write to <dir>/.claude/commands/<namespace>/   (default: the current folder)
//   --user            write to ~/.claude/commands/<namespace>/ instead (every project)
//   --namespace       subfolder name, so commands are /<namespace>:<name>  (default: prolly)
//   --dry-run         print what would be written, write nothing
//
// Each run replaces the files it wrote last time (they carry a prolly-id), so a prompt deleted in
// Prolly disappears from Claude Code. Files without a prolly-id are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Same pattern as shared/template.js: #name# or #name:a|b|c#
const TOKEN = /#([A-Za-z_][A-Za-z0-9_]*)(?::([^#\n]+))?#/g;

function parseArgs(argv) {
  const o = { file: null, project: process.cwd(), user: false, ns: 'prolly', dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') o.project = argv[++i];
    else if (a === '--user') o.user = true;
    else if (a === '--namespace') o.ns = argv[++i];
    else if (a === '--dry-run') o.dry = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.file) o.file = a;
    else throw new Error('Unexpected argument: ' + a);
  }
  return o;
}

// Variables in order of first use, with their choices (like PM.tpl.parse).
function variables(text) {
  const defs = [];
  for (const m of text.matchAll(TOKEN)) {
    const opts = m[2] ? m[2].split('|').map((s) => s.trim()).filter(Boolean) : null;
    let d = defs.find((x) => x.name === m[1]);
    if (!d) defs.push((d = { name: m[1], options: null }));
    if (!d.options && opts && opts.length) d.options = opts;
  }
  return defs;
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

// YAML double-quoted string; JSON's escaping is valid YAML.
const q = (s) => JSON.stringify(String(s));

function convert(p) {
  const text = String(p.text || '');
  const defs = variables(text);
  const defaults = p.defaults && typeof p.defaults === 'object' ? p.defaults : {};
  const warnings = [];

  // One variable takes everything typed after the command, spaces included: no quotes needed.
  // Several variables take one argument each, counted from 0 ($ARGUMENTS[0] is the first).
  const ref = (i) => (defs.length === 1 ? '$ARGUMENTS' : '$ARGUMENTS[' + i + ']');
  const body = text.replace(TOKEN, (raw, name) => ref(defs.findIndex((d) => d.name === name)));

  const hint = defs
    .map((d) => {
      const def = d.options ? defaults[d.name] || d.options[0] : defaults[d.name];
      let s = d.name;
      if (d.options) s += ': ' + d.options.join('|');
      if (def) s += ' = ' + def;
      return '<' + s + '>';
    })
    .join(' ');

  // Claude Code fills a missing argument with nothing useful (the placeholder stays as text),
  // so tell the model the defaults in plain words.
  const withDefault = defs
    .map((d) => [d.name, d.options ? defaults[d.name] || d.options[0] : defaults[d.name]])
    .filter(([, v]) => v);
  let note = '';
  if (withDefault.length) {
    note = '\n\n(If a value above was left unfilled, use: ' + withDefault.map(([n, v]) => n + ' = ' + v).join(', ') + '.)';
  }

  // Things in the prompt text that Claude Code would read as its own syntax.
  if (/!`/.test(text)) warnings.push('contains !`…` — Claude Code runs that as a shell command. Skipped.');
  if (/\$(\d|ARGUMENTS)/.test(text)) warnings.push('contains $<number> or $ARGUMENTS, which Claude Code may replace with an argument.');

  const desc = (p.title || text.split('\n')[0] || 'Prolly prompt').trim() + (p.folder ? ' (' + p.folder + ')' : '');
  const fm = ['---', 'description: ' + q(desc)];
  if (hint) fm.push('argument-hint: ' + q(hint));
  fm.push('prolly-id: ' + q(p.id || ''));
  fm.push('---');
  return { content: fm.join('\n') + '\n' + body.trim() + note + '\n', warnings, skip: /!`/.test(text), defs };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.file) {
    console.log('Usage: node prolly-to-claude.mjs <backup.json> [--project <dir>] [--user] [--namespace <name>] [--dry-run]');
    process.exit(o.file ? 0 : 1);
  }
  const data = JSON.parse(fs.readFileSync(o.file, 'utf8'));
  const prompts = Array.isArray(data) ? data : data && Array.isArray(data.prompts) ? data.prompts : null;
  if (!prompts) throw new Error('This file is not a Prolly backup (no "prompts" list).');
  if (!/^[a-z0-9-]*$/.test(o.ns)) throw new Error('--namespace may only use a-z, 0-9 and -');

  const root = o.user ? os.homedir() : path.resolve(o.project);
  const dir = path.join(root, '.claude', 'commands', ...(o.ns ? [o.ns] : []));

  const used = new Set();
  const out = [];
  for (const p of prompts) {
    if (!p || typeof p.text !== 'string') continue;
    let base = slugify(p.title) || slugify(p.text.split('\n')[0]) || 'prompt';
    let name = base;
    for (let n = 2; used.has(name); n++) name = base + '-' + n;
    used.add(name);
    out.push({ name, p, ...convert(p) });
  }

  // Files this script wrote before: replace them. Anything else in the folder stays.
  const old = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && /^prolly-id:/m.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    : [];

  const cmd = (n) => '/' + (o.ns ? o.ns + ':' : '') + n;
  console.log((o.dry ? '[dry run] ' : '') + 'Writing to ' + dir + '\n');
  if (!o.dry) {
    fs.mkdirSync(dir, { recursive: true });
    old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
  }
  let written = 0;
  for (const r of out) {
    const label = cmd(r.name) + (r.defs.length ? ' ' + r.defs.map((d) => '<' + d.name + '>').join(' ') : '');
    if (r.skip) {
      console.log('  skip  ' + label);
    } else {
      if (!o.dry) fs.writeFileSync(path.join(dir, r.name + '.md'), r.content);
      written++;
      console.log('  ok    ' + label);
    }
    r.warnings.forEach((w) => console.log('        ! ' + w));
  }
  const removed = old.filter((f) => !out.some((r) => !r.skip && r.name + '.md' === f)).length;
  console.log('\n' + written + ' command(s) written' + (removed ? ', ' + removed + ' old one(s) removed' : '') + '.');
  console.log('In Claude Code, type ' + (o.ns ? '/' + o.ns + ':' : '/') + ' to list them. Quote values with spaces when a command takes several.');
}

try {
  main();
} catch (e) {
  console.error('Error: ' + e.message);
  process.exit(1);
}
