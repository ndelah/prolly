// Theme tokens derived from light/dark + an accent colour (same maths as the mockup).
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.tokens) return;

  function hx(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '2563EB';
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, k) {
    const x = hx(a), y = hx(b);
    return '#' + x.map((v, i) => Math.round(v * (1 - k) + y[i] * k).toString(16).padStart(2, '0')).join('');
  }
  function lum(h) {
    const c = hx(h).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  PM.tokens = function (theme, accent) {
    const a = mix(accent, accent, 0);
    const dark = theme === 'dark';
    const P = dark ? '#17181C' : '#FFFFFF';
    const deep = mix(a, '#000000', lum(a) > 0.3 ? 0.55 : 0.4);
    const light = mix(a, '#FFFFFF', 0.45);
    return {
      panel: P,
      border: dark ? '#2C2E35' : '#DCDBD6',
      divider: dark ? '#2A2C33' : '#ECEBE7',
      text: dark ? '#ECEDEF' : '#1C1C1E',
      muted: dark ? '#9A9DA6' : '#5E5E64',
      muted2: dark ? '#B8BBC3' : '#55555A',
      faint: dark ? '#8C8F98' : '#6B6B70',
      line: dark ? '#3A3C44' : '#D6D5D0',
      line2: dark ? '#4A4D56' : '#BDBCB6',
      footer: dark ? '#1B1C21' : '#F7F7F5',
      kbd: dark ? '#D4D6DC' : '#2C2C2E',
      input: dark ? '#22242A' : '#F7F7F5',
      choiceText: dark ? '#C9CBD1' : '#3A3A3C',
      ok: dark ? '#7BD88F' : '#1F7A3A',
      danger: dark ? '#F97066' : '#B42318',
      sel: dark ? '#262830' : mix('#FFFFFF', a, 0.08),
      selRing: dark ? '#3A3C44' : mix('#FFFFFF', a, 0.35),
      acc: a,
      onAcc: lum(a) > 0.45 ? '#111114' : '#FFFFFF',
      accText: dark ? light : lum(a) > 0.18 ? deep : a,
      accSoft: dark ? mix(P, a, 0.22) : mix(P, a, 0.1),
      shadow: dark
        ? '0 24px 60px rgba(20,20,25,0.30), 0 4px 12px rgba(20,20,25,0.16)'
        : '0 24px 60px rgba(20,20,25,0.14), 0 2px 8px rgba(20,20,25,0.08)',
      hlFill: mix('#FFFFFF', a, 0.16),
      hlActive: mix('#FFFFFF', a, 0.3),
      hlText: deep,
      hlEmptyText: dark ? light : mix(a, '#000000', 0.3),
      hlDash: dark ? mix(P, a, 0.6) : mix('#FFFFFF', a, 0.55),
      chipBg: dark ? mix(P, a, 0.18) : mix('#FFFFFF', a, 0.07),
      chipBorder: mix('#FFFFFF', a, 0.35),
      chipText: dark ? light : deep,
      tableHead: dark ? '#1D1E23' : '#F7F7F5',
      promptText: dark ? '#DADCE1' : '#2C2C2E'
    };
  };

  PM.resolveTheme = function (t) {
    if (t === 'dark' || t === 'light') return t;
    return globalThis.matchMedia && globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  PM.applyTheme = function (el, settings) {
    const s = settings || {};
    const mode = PM.resolveTheme(s.theme || 'system');
    const tk = PM.tokens(mode, s.accent || '#2563EB');
    for (const k in tk) el.style.setProperty('--pm-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), tk[k]);
    el.setAttribute('data-pm-theme', mode);
    return tk;
  };

  PM.validHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
})();
