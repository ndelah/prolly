// Tests for the import block parser (shared/importer.js) and the setup prompt (shared/onboarding.js).
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
for (const f of ['shared/core.js', 'shared/template.js', 'shared/importer.js', 'shared/onboarding.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const PM = globalThis.PM;
const { addText, applyEdit, buildImportPlan, createLibraryIndex, emptySession, evaluate, mergeParts, parseImport, removeCodeFence, sessionEntries, sessionProgress } = PM.importer;

// ---------- Setup prompt ----------
const SETUP = PM.SETUP_PROMPT.text;

test('the setup prompt has no Prolly variables, so picking it sends it as is', () => {
  assert.deepEqual(PM.tpl.parse(SETUP).defs, []);
});

test("the setup prompt's example block parses as one ready entry", () => {
  const { session, result } = addText(emptySession(), SETUP);
  assert.ok(result.ok);
  const [e] = evaluate(sessionEntries(session));
  assert.equal(e.title, 'Meeting notes to actions');
  assert.equal(e.status, 'ok');
  assert.equal(session.parts[0].cutOff, false);
});

test('the variable syntax the setup prompt teaches, without its spaces, is what Prolly reads', () => {
  assert.ok(SETUP.includes('# audience #') && SETUP.includes('# format:table|bullets|prose #'));
  const defs = PM.tpl.parse('# audience # # format:table|bullets|prose #'.replace(/ #/g, '#').replace(/# /g, '#')).defs;
  assert.deepEqual(defs.map((d) => [d.name, d.options || null]), [['audience', null], ['format', ['table', 'bullets', 'prose']]]);
});

test('a new library starts with the setup prompt only', () => {
  const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(bg, /const SEED = \[PM\.SETUP_PROMPT\];/);
  assert.match(bg, /importScripts\([^)]*'shared\/onboarding\.js'/);
});

// ---------- Parser ----------
const T = "~~~~";
function entry(fields, body, sep = "=== PROMPT ===") {
  return `${sep}
${fields}
---
${body}`;
}
function block(entries, header = "prolly-import v1 | part 1 of 1", end = "=== END ===") {
  return [`${T}prolly`, header, ...entries, end, T].filter((l) => l !== "").join("\n");
}
const MEETING = entry(
  "title: Meeting notes to actions\nfolder: Decide & plan\ntags: quick, list\nstart-here: yes",
  "Turn these meeting notes into a list of action items with an owner and due date for each. Flag anything without an owner. Notes:"
);
function parseOne(text, opts) {
  const { session, result } = addText(emptySession(), text, opts);
  assert.ok(result.ok, `parse failed: ${result.issues.map((i) => i.code).join(", ")}`);
  return evaluate(sessionEntries(session));
}
function codes(e) {
  return e.issues.map((i) => i.code);
}
test("1. example block from the onboarding prompt", () => {
  const text = `Here's your library:

${block([MEETING])}

Want changes?`;
  const { session, result } = addText(emptySession(), text);
  assert.equal(result.issues.length, 0);
  const [e] = evaluate(sessionEntries(session));
  assert.equal(e.title, "Meeting notes to actions");
  assert.equal(e.folder, "Decide & plan");
  assert.deepEqual(e.tags, ["quick", "list"]);
  assert.equal(e.startHere, true);
  assert.equal(e.status, "ok");
  assert.equal(e.defaultChecked, true);
  assert.equal(e.kind, "prompt");
  assert.match(e.body, /^Turn these meeting notes/);
  assert.deepEqual(sessionProgress(session), { received: [1], total: 1, missing: [], cutOff: [], complete: true });
});
test("2. CRLF line endings give the same result", () => {
  const lf = parseOne(block([MEETING]));
  const crlf = parseOne(block([MEETING]).replace(/\n/g, "\r\n"));
  assert.deepEqual(crlf.map((e) => [e.title, e.body, e.tags]), lf.map((e) => [e.title, e.body, e.tags]));
});
test("3. two entries, no END line, no closing fence: cut off", () => {
  const text = `prolly-import v1 | part 1 of 1
${MEETING}
${entry("title: Second", "Half a promp")}`;
  const { session } = addText(emptySession(), text);
  const [a, b] = evaluate(sessionEntries(session));
  assert.equal(a.status, "ok");
  assert.equal(b.status, "incomplete");
  assert.equal(b.defaultChecked, false);
  assert.deepEqual(sessionProgress(session).cutOff, [1]);
  assert.ok(session.parts[0].issues.some((i) => i.code === "cut_off"));
});
test("3b. no END line but the fence closed: complete, with a warning", () => {
  const text = [`${T}prolly`, "prolly-import v1 | part 1 of 1", MEETING, T].join("\n");
  const { session } = addText(emptySession(), text);
  assert.equal(sessionProgress(session).complete, true);
  assert.equal(evaluate(sessionEntries(session))[0].status, "ok");
  assert.ok(session.parts[0].issues.some((i) => i.code === "end_missing"));
});
test("4. part 1 of 2 only", () => {
  const { session } = addText(emptySession(), block([MEETING], "prolly-import v1 | part 1 of 2"));
  const p = sessionProgress(session);
  assert.equal(p.complete, false);
  assert.deepEqual(p.missing, [2]);
});
test("5. parts arrive in separate messages", () => {
  let s = addText(emptySession(), block([MEETING], "prolly-import v1 | part 1 of 2")).session;
  s = addText(s, block([entry("title: Second one", "Body two")], "prolly-import v1 | part 2 of 2")).session;
  assert.equal(sessionEntries(s).length, 2);
  assert.equal(sessionProgress(s).complete, true);
});
test("6. the same part twice: newest wins", () => {
  let s = addText(emptySession(), block([MEETING])).session;
  const oldKey = sessionEntries(s)[0].key;
  s = addText(s, block([entry("title: Refined", "New body")])).session;
  const entries = sessionEntries(s);
  assert.deepEqual(entries.map((e) => e.title), ["Refined"]);
  assert.notEqual(entries[0].key, oldKey);
  assert.ok(s.issues.some((i) => i.code === "part_replaced"));
});
test("7. backtick fence with info string prolly", () => {
  const text = ["```prolly", "prolly-import v1 | part 1 of 1", MEETING, "=== END ===", "```"].join("\n");
  assert.equal(parseOne(text)[0].title, "Meeting notes to actions");
});
test("8. rendered reply copied without fences", () => {
  const text = ["Here you go.", "prolly-import v1 | part 1 of 1", MEETING, "=== END ===", "Three questions for you:", "1. ..."].join("\n");
  const { session } = addText(emptySession(), text);
  assert.equal(sessionEntries(session).length, 1);
  assert.equal(sessionProgress(session).complete, true);
});
test("9. DOM code text: whole text is the block", () => {
  const text = ["prolly-import v1 | part 1 of 1", MEETING, "=== END ==="].join("\n");
  const [e] = parseOne(text, { wholeTextIsBlock: true });
  assert.equal(e.title, "Meeting notes to actions");
  assert.ok(!e.body.includes("Copy"));
});
test("10. tags are normalized and deduplicated", () => {
  const [e] = parseOne(block([entry("title: T\ntags: #Table, Pros Cons, table", "Body")]));
  assert.deepEqual(e.tags, ["table", "pros-cons"]);
});
test("11. the maybe tag becomes a flag, unchecked", () => {
  const [e] = parseOne(block([entry("title: T\ntags: maybe, quick", "Body")]));
  assert.deepEqual(e.tags, ["quick"]);
  assert.equal(e.maybe, true);
  assert.equal(e.defaultChecked, false);
});
test("12. decorated keys", () => {
  const [e] = parseOne(block([entry("**title:** Weekly review\n- folder: Write\n**tags**: a", "Body")]));
  assert.equal(e.title, "Weekly review");
  assert.equal(e.folder, "Write");
  assert.deepEqual(e.tags, ["a"]);
  assert.ok(!codes(e).includes("field_alias"));
});
test("13. colons inside values", () => {
  const [e] = parseOne(block([entry("title: Review: weekly", "Body")]));
  assert.equal(e.title, "Review: weekly");
});
test("14. no divider: fields end at the first non-field line", () => {
  const text = block(["=== PROMPT ===\ntitle: No divider\nfolder: Write\nWrite a haiku about #topic#.\nKeep it short."]);
  const [e] = parseOne(text);
  assert.equal(e.title, "No divider");
  assert.equal(e.body, "Write a haiku about #topic#.\nKeep it short.");
  assert.deepEqual(e.variables, ["topic"]);
  assert.ok(codes(e).includes("divider_missing"));
});
test("15. a --- inside the body stays in the body", () => {
  const [e] = parseOne(block([entry("title: T", "Line one\nLine two\n---\nLine three")]));
  assert.equal(e.body, "Line one\nLine two\n---\nLine three");
});
test("16. a --- far below the separator is not the divider", () => {
  const body = Array.from({ length: 13 }, (_, i) => `Line ${i + 1}`).join("\n");
  const text = block([`=== PROMPT ===
title: Far rule
${body}
---
After the rule`]);
  const [e] = parseOne(text);
  assert.equal(e.title, "Far rule");
  assert.ok(e.body.startsWith("Line 1\n"));
  assert.ok(e.body.endsWith("---\nAfter the rule"));
});
test("17. empty body: invalid, never checked", () => {
  const [e] = parseOne(block([entry("title: Empty", "")]));
  assert.equal(e.status, "invalid");
  assert.equal(e.defaultChecked, false);
  assert.ok(codes(e).includes("body_missing"));
});
test("18. newer format version is refused", () => {
  const r = parseImport(block([MEETING], "prolly-import v2 | part 1 of 1"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((i) => i.code), ["version_unsupported"]);
});
test("19. duplicate of a library prompt (case and punctuation ignored)", () => {
  const library = createLibraryIndex([{ id: "lib-1", title: "Meeting Notes, to Actions!", body: "Something else" }]);
  const { session } = addText(emptySession(), block([MEETING]));
  const [e] = evaluate(sessionEntries(session), library);
  assert.equal(e.status, "duplicate");
  assert.equal(e.duplicateOf, "lib-1");
  assert.equal(e.defaultChecked, false);
});
test("20. duplicate within the batch", () => {
  const [a, b] = parseOne(block([MEETING, MEETING]));
  assert.equal(a.status, "ok");
  assert.equal(b.status, "duplicate");
  assert.equal(b.duplicateOfKey, a.key);
});
test("21. Modifiers folder and MODIFIER separator", () => {
  const [a, b] = parseOne(block([
    entry("title: Pros and cons\nfolder: modifiers", "End with pros and cons."),
    entry("title: No tables", "Do not use tables.", "=== MODIFIER ===")
  ]));
  assert.equal(a.kind, "modifier");
  assert.equal(b.kind, "modifier");
  assert.equal(b.folder, "Modifiers");
});
test("22. non-English titles and tags keep their letters", () => {
  const [e] = parseOne(block([entry("title: R\xE9sum\xE9 de r\xE9union\ntags: r\xE9union, \u65E5\u672C\u8A9E", "R\xE9sume ces notes.")]));
  assert.equal(e.title, "R\xE9sum\xE9 de r\xE9union");
  assert.deepEqual(e.tags, ["r\xE9union", "\u65E5\u672C\u8A9E"]);
});
test("23. HTML in a body is stored unchanged", () => {
  const body = 'Describe this: <img src="https://example.com/x.png">';
  assert.equal(parseOne(block([entry("title: T", body)]))[0].body, body);
});
test("24. personal data warning", () => {
  const [a, b] = parseOne(block([
    entry("title: Email", "Reply to jane.doe@example.com about it."),
    entry("title: Dates", "Plan 2026-11-26 to 2026-12-03, budget 1500.")
  ]));
  assert.ok(codes(a).includes("possible_personal_data"));
  assert.equal(a.defaultChecked, false);
  assert.ok(!codes(b).includes("possible_personal_data"));
  assert.equal(b.defaultChecked, true);
});
test("25. input too large", () => {
  const r = parseImport("x".repeat(6e5));
  assert.deepEqual(r.issues.map((i) => i.code), ["input_too_large"]);
});
test("variables follow Prolly's syntax; unnamed choice lists are flagged", () => {
  const [named, unnamed] = parseOne(block([
    entry("title: Named", "Explain #concept# at #level:beginner|expert# depth. C# and F# are fine."),
    entry("title: Unnamed", "Answer as a #table|bullets#.")
  ]));
  assert.deepEqual(named.variables, ["concept", "level"]);
  assert.ok(!codes(named).includes("variable_unnamed_choices"));
  assert.deepEqual(unnamed.variables, []);
  assert.ok(codes(unnamed).includes("variable_unnamed_choices"));
  assert.match(unnamed.issues.find((i) => i.code === "variable_unnamed_choices").message, /#choice:table\|bullets#/);
});
test("no block at all", () => {
  const r = parseImport("Just a normal reply with no library.");
  assert.deepEqual(r.issues.map((i) => i.code), ["no_block"]);
});
test("header variants and drifted separators are accepted", () => {
  const text = [
    "```prolly",
    "**Prolly-Import v1 \xB7 Part 1/1**",
    "**=== prompt ===**",
    "name: Aliased title",
    "category: Write",
    "pinned: yes",
    "---",
    "Body text",
    "== END ==",
    "```"
  ].join("\n");
  const { session } = addText(emptySession(), text);
  const [e] = evaluate(sessionEntries(session));
  assert.equal(e.title, "Aliased title");
  assert.equal(e.folder, "Write");
  assert.equal(e.startHere, true);
  assert.ok(codes(e).includes("field_alias"));
  const blockCodes = session.parts[0].issues.map((i) => i.code);
  assert.ok(blockCodes.includes("header_variant"));
  assert.ok(blockCodes.includes("separator_variant"));
});
test("missing title is derived from the first line", () => {
  const [e] = parseOne(block([entry("folder: Write", "# Summarize this article in five bullet points for me")]));
  assert.equal(e.title, "Summarize this article in five bullet");
  assert.ok(codes(e).includes("title_derived"));
});
test("missing folder defaults to Imported", () => {
  const [e] = parseOne(block([entry("title: T", "Body")]));
  assert.equal(e.folder, "Imported");
  assert.ok(codes(e).includes("folder_default"));
});
test("prose before the divider is moved into the body", () => {
  const [e] = parseOne(block(["=== PROMPT ===\ntitle: T\nThis one is great for weekly reviews.\n---\nBody"]));
  assert.equal(e.body, "This one is great for weekly reviews.\nBody");
  assert.ok(codes(e).includes("field_line_moved"));
});
test("unknown fields are kept in extra", () => {
  const [e] = parseOne(block([entry("title: T\nlanguage: fr", "Body")]));
  assert.deepEqual(e.extra, { language: "fr" });
});
test("fenced body: warning, and removeCodeFence fixes it", () => {
  const [e] = parseOne(block([entry("title: T", "```\nInner prompt\n```")]));
  assert.ok(codes(e).includes("body_fenced"));
  const fixed = evaluate([applyEdit(e, { body: removeCodeFence(e.body) })]);
  assert.equal(fixed[0].body, "Inner prompt");
  assert.ok(!codes(fixed[0]).includes("body_fenced"));
});
test("editing a field clears its notes and re-evaluates", () => {
  const [e] = parseOne(block([entry("tags: a", "Write something")]));
  assert.ok(codes(e).includes("title_derived"));
  assert.ok(codes(e).includes("folder_default"));
  const edited = evaluate([applyEdit(e, { title: "Writer", folder: "Write", tags: "A, b" })])[0];
  assert.equal(edited.title, "Writer");
  assert.deepEqual(edited.tags, ["a", "b"]);
  assert.ok(!codes(edited).includes("title_derived"));
  assert.ok(!codes(edited).includes("folder_default"));
  const cleared = evaluate([applyEdit(edited, { title: "" })])[0];
  assert.equal(cleared.status, "invalid");
});
test("editing the body of a cut-off entry marks it complete", () => {
  const text = `prolly-import v1 | part 1 of 1
${entry("title: Cut", "Half")}`;
  const [e] = parseOne(text);
  assert.equal(e.status, "incomplete");
  const fixed = evaluate([applyEdit(e, { body: "Half, now finished." })])[0];
  assert.equal(fixed.status, "ok");
});
test("headerless entries after END continue the same block", () => {
  const text = [`${T}prolly`, "prolly-import v1 | part 1 of 1", MEETING, "=== END ===", entry("title: Late", "Late body"), "=== END ===", T].join("\n");
  const { session } = addText(emptySession(), text);
  assert.deepEqual(sessionEntries(session).map((e) => e.title), ["Meeting notes to actions", "Late"]);
});
test("invalid part number is appended after existing parts", () => {
  let s = addText(emptySession(), block([MEETING], "prolly-import v1 | part 1 of 2")).session;
  s = mergeParts(s, parseImport(block([entry("title: Odd", "Body")], "prolly-import v1 | part 5 of 2")));
  assert.deepEqual(s.parts.map((p) => p.part), [1, 2]);
});
test("import plan: selection, copies, replace, folders, file names", () => {
  const library = createLibraryIndex(
    [{ id: "lib-1", title: "Code review", body: "old", folder: "Build", fileName: "code-review" }],
    ["Build", "Write"]
  );
  const text = block([
    entry("title: Code review\nfolder: build", "Review my code"),
    entry("title: Code Review!\nfolder: Build", "Review my code, strictly"),
    entry("title: Release notes\nfolder: write", "Write release notes"),
    entry("title: Brand new\nfolder: Research", "Research #topic#"),
    entry("title: Skipped", "Not selected"),
    entry("title: Broken", "")
  ]);
  const { session } = addText(emptySession(), text);
  const entries = evaluate(sessionEntries(session), library);
  const [dupReplace, dupCopy, ok1, ok2, skipped, broken] = entries;
  const plan = buildImportPlan(entries, {
    selected: [dupReplace.key, dupCopy.key, ok1.key, ok2.key, broken.key],
    decisions: { [dupReplace.key]: "replace", [dupCopy.key]: "copy" },
    library
  });
  assert.deepEqual(plan.replace, [{ entryKey: dupReplace.key, libraryId: "lib-1", body: "Review my code", addTags: [] }]);
  assert.deepEqual(plan.create.map((p) => [p.title, p.folder, p.fileName]), [
    ["Code Review! (2)", "Build", "code-review-2"],
    ["Release notes", "Write", "release-notes"],
    ["Brand new", "Research", "brand-new"]
  ]);
  assert.deepEqual(plan.foldersToCreate, ["Research"]);
  assert.deepEqual(plan.skipped, [skipped.key, broken.key]);
});
