// Prompt variables.
//   #name#            free text
//   #name:a|b|c#      fixed choices (the first one is the default)
// A name used several times is one variable.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.tpl) return;

  const TOKEN = /#([A-Za-z_][A-Za-z0-9_]*)(?::([^#\n]+))?#/g;

  function parse(text) {
    const defs = [];
    const map = {};
    for (const m of String(text || '').matchAll(TOKEN)) {
      const name = m[1];
      const opts = m[2] ? m[2].split('|').map((s) => s.trim()).filter(Boolean) : null;
      let d = map[name];
      if (!d) {
        d = map[name] = { name, options: opts && opts.length ? opts : null, uses: 0 };
        defs.push(d);
      } else if (!d.options && opts && opts.length) {
        d.options = opts;
      }
      d.uses++;
    }
    return { defs };
  }

  function segments(text) {
    text = String(text || '');
    const out = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ name: m[1], raw: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  // Unfilled variables stay as #name# so they are easy to spot.
  function render(text, values) {
    return String(text || '').replace(TOKEN, (raw, name) => {
      const v = values && values[name];
      return v ? v : '#' + name + '#';
    });
  }

  function plain(text) {
    return String(text || '').replace(TOKEN, (raw, name) => '#' + name + '#');
  }

  function setChoices(text, name, options) {
    const tok = '#' + name + (options && options.length ? ':' + options.join('|') : '') + '#';
    return String(text || '').replace(TOKEN, (raw, n) => (n === name ? tok : raw));
  }

  PM.tpl = { parse, segments, render, plain, setChoices };
})();
