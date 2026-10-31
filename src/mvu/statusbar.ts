// The status bar shown under each AI message: an ```html front-end (rendered by TavernHelper) that reads this
// message's MVU variables and draws them. M1 builds a default layout from the variable tree; the canvas comes later.
//
// The HTML ends up in a regex replacement and then goes through ST's message formatting, so it must survive:
// - ST's markdown auto-fix: every line needs an even number of * and " (it appends one otherwise, even in code)
// - regex replacement: no $ followed by a digit or <, no {{macros}}
// - the ``` fence: no backticks// The runtime below is written without * and with single quotes; data is embedded with safeJson().
import type { VarNode } from './types';
import { stageKey, varKey } from './vars';

export type ViewNode =
  | { t: 'group'; label: string; path: string[]; kids: ViewNode[] }
  | { t: 'num'; label: string; path: string[]; min: number | null; max: number | null; stage: string[] | null }
  | { t: 'text' | 'bool' | 'list'; label: string; path: string[] }
  | { t: 'table'; label: string; path: string[]; fields: { label: string; key: string; t: string }[] };

/** Default layout: everything, grouped like the variable tree. */
export function defaultView(vars: VarNode[], keys: string[] = []): ViewNode[] {
  return vars.map((v): ViewNode => {
    const path = [...keys, varKey(v)];
    switch (v.kind) {
      case 'group':
        return { t: 'group', label: v.name, path, kids: defaultView(v.children ?? [], path) };
      case 'number':
        return { t: 'num', label: v.name, path, min: v.min ?? null, max: v.max ?? null, stage: v.stages?.length ? [...keys, stageKey(v)] : null };
      case 'table':
        return { t: 'table', label: v.name, path, fields: (v.children ?? []).map((f) => ({ label: f.name, key: varKey(f), t: f.kind })) };
      case 'choice':
        return { t: 'text', label: v.name, path };
      default:
        return { t: v.kind, label: v.name, path };
    }
  });
}

/** JSON that is safe inside a regex replacement + ST formatting (see the top of this file). */
export function safeJson(o: unknown): string {
  return JSON.stringify(o)
    .replace(/\\"/g, '\\u0022')
    .replace(/\*/g, '\\u002a')
    .replace(/_/g, '\\u005f')
    .replace(/\$/g, '\\u0024')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\{\{/g, '\\u007b\\u007b');
}

const CSS = `
:root { --bg: #1f1d2b; --card: #2a2838; --line: #3a3750; --text: #e8e6f0; --dim: #a9a5bf; --accent: #b48cff; --accent2: #6fc3ff; }
html, body { margin: 0; background: transparent; }
body { font: 14px/1.5 system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: var(--text); }
.sb { background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: grid; gap: 10px; }
.sb-group { background: var(--card); border-radius: 10px; padding: 8px 10px; display: grid; gap: 6px; }
.sb-group .sb-group { background: transparent; padding: 0 0 0 8px; border-left: 2px solid var(--line); border-radius: 0; }
.sb-title { font-weight: 700; color: var(--accent); }
.sb-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sb-label { color: var(--dim); flex: none; }
.sb-value { min-width: 0; overflow-wrap: anywhere; }
.sb-bar { flex: 1; height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; min-width: 60px; }
.sb-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 99px; }
.sb-stage { font-size: 12px; padding: 0 6px; border-radius: 99px; background: var(--line); color: var(--text); flex: none; }
.sb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.sb-chip { background: var(--line); border-radius: 6px; padding: 0 6px; }
.sb-table { display: grid; gap: 4px; }
.sb-item { background: rgba(255, 255, 255, 0.04); border-radius: 6px; padding: 4px 8px; }
.sb-item-name { font-weight: 600; }
.sb-empty { color: var(--dim); font-size: 12px; }
`;

// Runtime: plain JS, no *, single quotes only. VIEW is filled in by statusBarHtml().
const RUNTIME = `
(function () {
  var VIEW = __VIEW__;
  var root = document.getElementById('sb');
  function opt() { return { type: 'message', message_id: getCurrentMessageId() }; }
  function read() {
    try { var v = getVariables(opt()); return v && v.stat_data ? v.stat_data : null; } catch (e) { return null; }
  }
  function at(data, path) {
    var cur = data;
    for (var i = 0; i < path.length; i++) { if (cur == null) return undefined; cur = cur[path[i]]; }
    return cur;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function show(v) {
    if (v == null || v === '') return '—';
    if (v === true) return '是';
    if (v === false) return '否';
    if (Array.isArray(v)) return v.join('、');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return k + '：' + show(v[k]); }).join('；');
    return String(v);
  }
  function row(label) {
    var r = el('div', 'sb-row');
    r.appendChild(el('span', 'sb-label', label));
    return r;
  }
  function draw(node, data) {
    var v = at(data, node.path);
    if (node.t === 'group') {
      var g = el('div', 'sb-group');
      g.appendChild(el('div', 'sb-title', node.label));
      node.kids.forEach(function (k) { g.appendChild(draw(k, data)); });
      return g;
    }
    var r = row(node.label);
    if (node.t === 'num') {
      if (node.min != null && node.max != null && node.max > node.min && typeof v === 'number') {
        var bar = el('div', 'sb-bar');
        var fill = el('div', 'sb-fill');
        var ratio = Math.min(Math.max((v - node.min) / (node.max - node.min), 0), 1);
        fill.style.width = (ratio / 0.01) + '%';
        bar.appendChild(fill);
        r.appendChild(bar);
      }
      r.appendChild(el('span', 'sb-value', show(v)));
      if (node.stage) r.appendChild(el('span', 'sb-stage', show(at(data, node.stage))));
      return r;
    }
    if (node.t === 'list') {
      var chips = el('div', 'sb-chips');
      (Array.isArray(v) ? v : []).forEach(function (x) { chips.appendChild(el('span', 'sb-chip', show(x))); });
      if (!chips.childNodes.length) chips.appendChild(el('span', 'sb-empty', '暂无'));
      r.appendChild(chips);
      return r;
    }
    if (node.t === 'table') {
      var box = el('div', 'sb-group');
      box.appendChild(el('div', 'sb-title', node.label));
      var list = el('div', 'sb-table');
      var names = v && typeof v === 'object' ? Object.keys(v) : [];
      names.forEach(function (name) {
        var item = el('div', 'sb-item');
        item.appendChild(el('span', 'sb-item-name', name));
        node.fields.forEach(function (f) {
          var fv = v[name] ? v[name][f.key] : undefined;
          if (fv == null || fv === '') return;
          item.appendChild(el('span', 'sb-label', '　' + f.label + '：'));
          item.appendChild(el('span', 'sb-value', show(fv)));
        });
        list.appendChild(item);
      });
      if (!names.length) list.appendChild(el('span', 'sb-empty', '暂无'));
      box.appendChild(list);
      return box;
    }
    r.appendChild(el('span', 'sb-value', show(v)));
    return r;
  }
  var last = null;
  function render() {
    var data = read();
    var key = JSON.stringify(data);
    if (key === last) return;
    last = key;
    root.replaceChildren();
    if (!data) { root.appendChild(el('div', 'sb-empty', '变量还没有准备好（需要酒馆助手和 MVU）')); return; }
    VIEW.forEach(function (n) { root.appendChild(draw(n, data)); });
  }
  render();
  setInterval(render, 2000);
  var waiting = typeof waitGlobalInitialized === 'function' ? waitGlobalInitialized('Mvu') : Promise.reject();
  waiting.then(function () {
    render();
    if (typeof eventOn === 'function' && window.Mvu) eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () { setTimeout(render, 0); });
  }).catch(function () {});
})();
`;

/** The front-end document for the status bar. */
export function statusBarHtml(view: ViewNode[]): string {
  const js = RUNTIME.replace('__VIEW__', safeJson(view));
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>${CSS}</style>\n</head>\n<body>\n<div id="sb" class="sb"></div>\n<script>${js}</script>\n</body>\n</html>`;
}

/** What the status bar regex replaces <StatusPlaceHolderImpl/> with. */
export const statusBarReplacement = (view: ViewNode[]) => '```html\n' + statusBarHtml(view) + '\n```';
