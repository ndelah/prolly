// Styles for the picker, variable bar, editor and toasts.
// Kept in JS so it can be applied as a constructed stylesheet inside the page's shadow root
// (not blocked by the host page's CSP) and reused by the options page.
(function () {
  'use strict';
  const PM = (globalThis.PM = globalThis.PM || {});
  if (PM.CSS) return;

  PM.CSS = `
:host { all: initial; }
.pm-ui {
  --pm-font: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --pm-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-family: var(--pm-font); font-size: 14px; line-height: 1.4; color: var(--pm-text);
  -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal; text-transform: none;
}
.pm-ui *, .pm-ui *::before, .pm-ui *::after { box-sizing: border-box; }
.pm-ui [hidden] { display: none !important; }
.pm-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.pm-ui button { font-family: var(--pm-font); margin: 0; }
.pm-ui svg { flex: none; display: block; }

.pm-panel { pointer-events: auto; background: var(--pm-panel); border: 1px solid var(--pm-border); border-radius: 14px;
  box-shadow: var(--pm-shadow); color: var(--pm-text); display: flex; flex-direction: column; overflow: hidden; }
.pm-float { position: fixed; }
.pm-k { font-family: var(--pm-mono); color: var(--pm-kbd); }
.pm-faint { color: var(--pm-faint); }
.pm-push { margin-left: auto; }
.pm-ui :focus-visible { outline: 2px solid var(--pm-acc); outline-offset: 1px; }
.pm-ui input:focus-visible, .pm-ui textarea:focus-visible { outline: none; }

/* ---------- Picker ---------- */
.pm-picker { width: 600px; max-width: 100%; max-height: 560px; }
.pm-searchrow { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--pm-divider); flex: none; }
.pm-searchrow > svg { color: var(--pm-muted); }
.pm-chip-folder { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 7px;
  background: var(--pm-acc-soft); color: var(--pm-acc-text); font-size: 13px; font-weight: 600; white-space: nowrap; }
.pm-chip-tag { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 13px;
  border: 1px solid var(--pm-sel-ring); background: transparent; color: var(--pm-text); font-size: 13px; cursor: pointer; white-space: nowrap; }
.pm-chip-tag svg { color: var(--pm-acc-text); }
.pm-chip-tag .pm-x { color: var(--pm-faint); }
.pm-search-wrap { position: relative; flex: 1; min-width: 0; display: flex; }
.pm-search-input { flex: 1; min-width: 0; width: 100%; background: transparent; border: 0; outline: none; color: var(--pm-text);
  font-family: var(--pm-font); font-size: 15px; padding: 4px 0; margin: 0; box-shadow: none; height: auto; }
.pm-placeholder { position: absolute; left: 0; top: 4px; font-size: 15px; color: var(--pm-faint); pointer-events: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.pm-kbd-chip { flex: none; font-family: var(--pm-mono); font-size: 11px; color: var(--pm-muted2); border: 1px solid var(--pm-line); border-radius: 5px; padding: 2px 6px; white-space: nowrap; }
.pm-tabs { display: flex; gap: 4px; padding: 8px 10px 0; border-bottom: 1px solid var(--pm-divider); flex: none; }
.pm-tab { position: relative; height: 34px; padding: 0 12px; border: 0; background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 500; color: var(--pm-muted); }
.pm-tab.is-on { color: var(--pm-text); }
.pm-tab .pm-count { color: var(--pm-faint); font-weight: 400; margin-left: 4px; }
.pm-tab.is-line::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 1px; background: var(--pm-acc); }
.pm-tabs-hint { margin-left: auto; align-self: center; font-size: 11.5px; color: var(--pm-faint); white-space: nowrap; }
.pm-list { position: relative; flex: 0 1 auto; min-height: 0; max-height: 372px; overflow-y: auto; padding: 4px 6px 6px; overscroll-behavior: contain; }
.pm-section { display: flex; justify-content: space-between; padding: 10px 10px 4px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--pm-faint); }
.pm-row { position: relative; width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; text-align: left; cursor: pointer; color: var(--pm-text); font-size: 14px; }
.pm-row.is-sel { background: var(--pm-sel); box-shadow: inset 0 0 0 1px var(--pm-sel-ring); }
.pm-ico { width: 28px; height: 28px; flex: none; border-radius: 7px; background: var(--pm-input); color: var(--pm-acc-text);
  display: flex; align-items: center; justify-content: center; font-family: var(--pm-mono); font-size: 13px; }
.pm-ico.is-prompt { background: var(--pm-acc-soft); }
.pm-ico.is-more { background: transparent; }
.pm-ico.is-new { background: transparent; border: 1px dashed var(--pm-line2); color: var(--pm-muted2); }
.pm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pm-row-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-row.is-new .pm-row-title { font-weight: 500; }
.pm-row-sub { font-size: 12.5px; color: var(--pm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-row-side { flex: none; display: flex; align-items: center; gap: 5px; max-width: 46%; overflow: hidden; }
.pm-tagpill { font-size: 11px; color: var(--pm-muted2); border: 1px solid var(--pm-line); border-radius: 10px; padding: 1px 7px; white-space: nowrap; }
.pm-aside { font-size: 12px; color: var(--pm-faint); white-space: nowrap; }
.pm-rowkey { font-family: var(--pm-mono); font-size: 12px; color: var(--pm-muted2); min-width: 14px; text-align: right; visibility: hidden; }
.pm-row.is-sel .pm-rowkey { visibility: visible; }
.pm-empty { padding: 14px 12px 6px; font-size: 13px; color: var(--pm-muted); }
.pm-footer { display: flex; align-items: center; gap: 16px; padding: 9px 16px; border-top: 1px solid var(--pm-divider); background: var(--pm-footer);
  font-size: 12px; color: var(--pm-muted); flex: none; flex-wrap: wrap; }
.pm-footer > span { display: inline-flex; align-items: center; gap: 4px; }
.pm-footer .pm-k { font-size: 13px; line-height: 1; }
.pm-ki { display: inline-flex; }
.pm-ki svg { display: block; }

/* ---------- Variable bar ---------- */
.pm-fill { padding: 12px 14px 14px; gap: 10px; overflow-y: auto; }
.pm-fill-head { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--pm-muted); flex-wrap: wrap; }
.pm-badge { width: 18px; height: 18px; flex: none; border-radius: 5px; background: var(--pm-acc-soft); color: var(--pm-acc-text);
  font-family: var(--pm-mono); font-size: 11px; display: flex; align-items: center; justify-content: center; }
.pm-fill-title { color: var(--pm-text); font-weight: 600; font-size: 13px; }
.pm-fill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.pm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.pm-field-label { display: flex; gap: 6px; font-family: var(--pm-mono); font-size: 11.5px; color: var(--pm-acc-text); white-space: nowrap; overflow: hidden; }
.pm-input { height: 34px; width: 100%; background: var(--pm-input); border: 1px solid var(--pm-line); border-radius: 8px; padding: 0 10px;
  color: var(--pm-text); font-family: var(--pm-font); font-size: 14px; outline: none; margin: 0; box-shadow: none; }
.pm-input:focus { border-color: var(--pm-acc); box-shadow: 0 0 0 3px var(--pm-acc-soft); }
.pm-input::placeholder { color: var(--pm-faint); }
.pm-seg { height: 34px; display: flex; gap: 4px; padding: 3px; background: var(--pm-input); border: 1px solid var(--pm-line); border-radius: 8px; }
.pm-seg:focus-within { border-color: var(--pm-acc); box-shadow: 0 0 0 3px var(--pm-acc-soft); }
.pm-seg button { flex: 1 1 auto; min-width: 0; border: 0; border-radius: 6px; background: transparent; color: var(--pm-choice-text);
  font-size: 12.5px; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; outline: none; }
.pm-seg button[aria-checked="true"] { background: var(--pm-acc); color: var(--pm-on-acc); font-weight: 600; flex-shrink: 0; max-width: 70%; }
.pm-field.is-wide { grid-column: span 2; }
.pm-preview { max-height: 200px; overflow-y: auto; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
  color: var(--pm-prompt-text); background: var(--pm-input); border: 1px solid var(--pm-line); border-radius: 10px; padding: 10px 12px; }
.pm-hl { background: var(--pm-hl-fill); color: var(--pm-hl-text); border-radius: 4px; padding: 1px 3px; }
.pm-hl.is-active { background: var(--pm-hl-active); box-shadow: 0 0 0 2px var(--pm-acc); }
.pm-hl-empty { font-family: var(--pm-mono); font-size: 13px; color: var(--pm-hl-empty-text); border: 1px dashed var(--pm-hl-dash); border-radius: 4px; padding: 0 3px; }
.pm-hl-empty.is-active { border-color: transparent; background: var(--pm-chip-bg); box-shadow: 0 0 0 2px var(--pm-acc); }

/* ---------- Toast ---------- */
.pm-toast { position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 10px; background: var(--pm-panel); color: var(--pm-text);
  border: 1px solid var(--pm-border); border-radius: 10px; padding: 8px 12px; font-size: 13px; box-shadow: var(--pm-shadow); max-width: calc(100vw - 24px); }
.pm-toast .pm-ok { color: var(--pm-ok); }
.pm-toast button { background: var(--pm-divider); border: 0; color: var(--pm-text); border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; white-space: nowrap; }

/* ---------- Editor ---------- */
.pm-scrim { position: fixed; inset: 0; background: rgba(18, 18, 22, 0.22); pointer-events: auto; animation: pm-fade 120ms ease-out; }
.pm-root[data-pm-theme="dark"] .pm-scrim { background: rgba(0, 0, 0, 0.45); }
@keyframes pm-fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .pm-scrim { animation: none; } }
.pm-backdrop { position: fixed; inset: 0; background: rgba(18, 18, 22, 0.45); pointer-events: auto; display: flex; align-items: flex-start;
  justify-content: center; padding: 64px 16px 24px; overflow-y: auto; }
.pm-editor { width: 760px; max-width: 100%; border-radius: 16px; overflow: visible; flex: none; }
.pm-ed-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--pm-divider); }
.pm-logo { width: 24px; height: 24px; flex: none; border-radius: 6px; background: var(--pm-acc); color: var(--pm-on-acc); font-family: var(--pm-mono);
  font-size: 13px; display: flex; align-items: center; justify-content: center; }
.pm-crumb { font-size: 12.5px; color: var(--pm-muted); }
.pm-ed-title { font-size: 15px; font-weight: 600; }
.pm-ed-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
.pm-fl { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pm-lbl { font-size: 12px; font-weight: 600; color: var(--pm-muted2); }
.pm-help { font-size: 11.5px; color: var(--pm-faint); }
.pm-help b { color: var(--pm-muted2); font-weight: 600; }
.pm-ed-input { height: 40px; border-radius: 9px; padding: 0 12px; font-size: 15px; }
.pm-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pm-iconfield { position: relative; }
.pm-iconfield > svg { position: absolute; left: 12px; top: 12px; color: var(--pm-acc-text); pointer-events: none; }
.pm-iconfield > input { padding-left: 36px; font-size: 14.5px; }
.pm-tags { min-height: 40px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: var(--pm-input); border: 1px solid var(--pm-line);
  border-radius: 9px; padding: 5px 8px; cursor: text; }
.pm-tags:focus-within { border-color: var(--pm-acc); box-shadow: 0 0 0 3px var(--pm-acc-soft); }
.pm-tagchips { display: contents; }
.pm-panel:focus, .pm-backdrop:focus { outline: none; }
.pm-tagchip { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; color: var(--pm-text); border: 1px solid var(--pm-sel-ring);
  border-radius: 12px; padding: 1px 3px 1px 8px; }
.pm-tagchip button { border: 0; background: transparent; color: var(--pm-faint); cursor: pointer; font-size: 13px; padding: 0 4px; line-height: 1; }
.pm-tags input { flex: 1; min-width: 80px; background: transparent; border: 0; outline: none; color: var(--pm-text); font-family: var(--pm-font);
  font-size: 14px; height: 26px; padding: 0; margin: 0; box-shadow: none; }
.pm-tag-wrap { position: relative; flex: 1; min-width: 80px; display: flex; }
.pm-tag-wrap input { flex: 1; min-width: 0; position: relative; }
.pm-ghost { position: absolute; inset: 0; display: flex; align-items: center; pointer-events: none; white-space: pre; overflow: hidden;
  font: inherit; font-family: var(--pm-font); font-size: 14px; color: var(--pm-faint); }
.pm-ghost-typed { visibility: hidden; }
.pm-labelrow { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.pm-syntax { font-size: 12px; color: var(--pm-muted); }
.pm-code { font-family: var(--pm-mono); color: var(--pm-acc-text); }
.pm-ta-wrap { position: relative; background: var(--pm-input); border: 1px solid var(--pm-line); border-radius: 9px; }
.pm-ta-wrap:focus-within { border-color: var(--pm-acc); box-shadow: 0 0 0 3px var(--pm-acc-soft); }
.pm-ta-back, .pm-ta { margin: 0; padding: 12px 14px; font-family: var(--pm-font); font-size: 14.5px; line-height: 1.7; white-space: pre-wrap;
  overflow-wrap: break-word; word-wrap: break-word; letter-spacing: normal; tab-size: 4; border: 0; }
.pm-ta-back { position: absolute; inset: 0; color: transparent; pointer-events: none; overflow: hidden; }
.pm-ta-back mark { background: var(--pm-acc-soft); color: transparent; border-radius: 3px; box-shadow: 0 0 0 1px var(--pm-acc-soft); }
.pm-ta { position: relative; display: block; width: 100%; min-height: 150px; max-height: 340px; resize: none; background: transparent; outline: none;
  color: var(--pm-prompt-text); overflow-y: auto; box-shadow: none; }
.pm-ta::placeholder { color: var(--pm-faint); }
.pm-vtable { border: 1px solid var(--pm-border); border-radius: 10px; overflow: hidden; }
.pm-vrow { display: grid; grid-template-columns: 150px 56px 72px minmax(0, 1fr); gap: 8px; align-items: center; padding: 8px 12px;
  border-top: 1px solid var(--pm-divider); font-size: 13.5px; }
.pm-vrow.is-head { border-top: 0; background: var(--pm-table-head); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--pm-faint); }
.pm-vname { font-family: var(--pm-mono); color: var(--pm-acc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-vmeta { color: var(--pm-muted2); }
.pm-sm-input { height: 30px; border-radius: 7px; font-size: 13.5px; }
.pm-choices { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pm-choice { font-size: 12.5px; background: var(--pm-input); color: var(--pm-choice-text); border: 1px solid var(--pm-line); border-radius: 6px;
  padding: 3px 9px; cursor: pointer; }
.pm-choice.is-on { background: var(--pm-acc); color: var(--pm-on-acc); border-color: var(--pm-acc); font-weight: 600; }
.pm-choice.is-add { color: var(--pm-muted); border-style: dashed; border-color: var(--pm-line2); background: transparent; }
.pm-choice-input { width: 130px; height: 26px; border-radius: 6px; font-size: 12.5px; padding: 0 8px; }
.pm-novars { padding: 12px; font-size: 13px; color: var(--pm-muted); border: 1px dashed var(--pm-line); border-radius: 10px; }
.pm-err { color: var(--pm-danger); font-size: 12.5px; }
.pm-ed-foot { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--pm-divider); background: var(--pm-footer);
  border-radius: 0 0 16px 16px; flex-wrap: wrap; }
.pm-btn { height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--pm-line); background: transparent; color: var(--pm-text);
  font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.pm-btn.is-primary { border-color: var(--pm-acc); background: var(--pm-acc); color: var(--pm-on-acc); font-weight: 600; }
.pm-btn.is-primary .pm-k { color: var(--pm-on-acc); opacity: 0.75; font-size: 11.5px; }
.pm-btn.is-danger { color: var(--pm-danger); border-color: transparent; padding: 0 8px; }
.pm-btn[disabled] { opacity: 0.6; cursor: default; }

/* ---------- Pick-a-text-area mode ---------- */
.pm-pickbox { position: fixed; pointer-events: none; border: 2px solid var(--pm-acc); border-radius: 8px; box-shadow: 0 0 0 4px var(--pm-acc-soft); }
.pm-banner { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); flex-direction: row; align-items: center; gap: 12px;
  padding: 10px 12px 10px 14px; font-size: 13.5px; max-width: calc(100vw - 32px); }

@media (max-width: 560px) {
  .pm-grid2 { grid-template-columns: minmax(0, 1fr); }
  .pm-vrow { grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1.4fr); }
  .pm-vrow > :nth-child(3) { display: none; }
  .pm-tabs-hint { display: none; }
}
`;

  // Apply the styles to a document or shadow root.
  PM.adoptCSS = function (root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PM.CSS);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    } catch (e) {
      const st = document.createElement('style');
      st.textContent = PM.CSS;
      (root.head || root).appendChild(st);
    }
  };
})();
