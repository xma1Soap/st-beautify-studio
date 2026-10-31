// The status bar shown under each AI message: an ```html front-end (rendered by TavernHelper) that reads this
// message's MVU variables and draws the components laid out on the canvas (bar.ts compiles them into VIEW + CSS).
//
// The HTML ends up in a regex replacement and then goes through ST's message formatting, so it must survive:
// - ST's markdown auto-fix: every line needs an even number of * and " (it appends one otherwise, even in code)
// - regex replacement: no $ followed by a digit or <, no {{macros}}
// - the ``` fence: no backticks
// The runtime below is written without * and with single quotes; data is embedded with safeJson(), and bar.ts
// only lets checked values into the CSS.
//
// The same drawing code runs on the canvas, with a different start-up part (EDITOR_BOOT) that takes the view and
// the data from the editor and reports where every component ended up.
import type { CompiledBar } from './bar';

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

// Drawing: plain JS, no *, single quotes only. VIEW and EDIT are set by the start-up part.
const DRAW = `
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
  function blank(v) {
    return v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  }
  function show(v, sep) {
    if (v == null || v === '') return '';
    if (v === true) return '是';
    if (v === false) return '否';
    if (typeof v === 'number') return String(Math.round(v / 0.01) / 100);
    if (Array.isArray(v)) return v.map(function (x) { return show(x); }).join(sep || '、');
    if (typeof v === 'object') return Object.keys(v).join(sep || '、');
    return String(v);
  }
  function src(s, ctx) {
    if (!s) return undefined;
    if (s.nm) return ctx.name;
    if (s.it) return ctx.item;
    if (s.r != null) return ctx.row ? ctx.row[s.r] : undefined;
    return at(ctx.data, s.p);
  }
  function head(e, node) {
    if (node.ic) e.appendChild(el('span', 'sb-icon', node.ic));
    if (node.lb) e.appendChild(el('span', 'sb-label', node.lb));
  }
  function kids(e, list, ctx) {
    list.forEach(function (k) { var x = draw(k, ctx); if (x) e.appendChild(x); });
  }
  function draw(node, ctx) {
    var e = null;
    var v;
    if (node.t === 'box') {
      e = el('div', 'sb-box ' + node.c);
      kids(e, node.k, ctx);
    } else if (node.t === 'rep') {
      e = el('div', 'sb-rep ' + node.c);
      v = src(node.s, ctx);
      var items = [];
      if (node.l === 'list') {
        (Array.isArray(v) ? v : []).forEach(function (x) { items.push({ data: ctx.data, name: ctx.name, row: ctx.row, item: x }); });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (n) { items.push({ data: ctx.data, name: n, row: v[n] || {}, item: ctx.item }); });
      }
      var ghost = false;
      if (!items.length && EDIT && node.g) {
        items.push({ data: ctx.data, name: node.g.name, row: node.g.row || {}, item: node.g.item });
        ghost = true;
      }
      items.forEach(function (it) {
        var item = el('div', 'sb-item' + (ghost ? ' sb-ghost' : ''));
        kids(item, node.k, it);
        e.appendChild(item);
      });
      if (!items.length && node.e) e.appendChild(el('div', 'sb-empty', node.e));
    } else if (node.t === 'text') {
      e = el('div', 'sb-text ' + node.c, node.x);
    } else if (node.t === 'hr') {
      e = el('div', 'sb-hr ' + node.c);
      if (node.x) e.appendChild(el('span', '', node.x));
    } else if (node.t === 'val') {
      v = node.bad ? undefined : src(node.s, ctx);
      if (node.so) v = src(node.st, ctx);
      e = el('div', 'sb-val ' + node.c);
      if (blank(v) && node.he) {
        if (!EDIT) return null;
        e.className += ' sb-ghost';
      }
      head(e, node);
      if (node.bad) {
        e.appendChild(el('span', 'sb-v sb-empty', '（' + node.bad + '）'));
      } else if (blank(v)) {
        e.appendChild(el('span', 'sb-v' + (node.pl ? ' sb-pill' : ''), node.em));
      } else if (typeof v === 'object' && node.la !== 'text') {
        var chips = el('span', 'sb-chips');
        (Array.isArray(v) ? v : Object.keys(v)).forEach(function (x) { chips.appendChild(el('span', 'sb-chip', show(x))); });
        e.appendChild(chips);
      } else {
        var text = v === true && node.y != null ? node.y : v === false && node.n != null ? node.n : show(v, node.sep);
        e.appendChild(el('span', 'sb-v' + (node.pl ? ' sb-pill' : ''), (node.pre || '') + text + (node.suf || '')));
      }
      if (node.st && !node.so) {
        var sv = src(node.st, ctx);
        if (!blank(sv)) e.appendChild(el('span', 'sb-stage', show(sv)));
      }
    } else if (node.t === 'bar') {
      v = node.bad ? undefined : src(node.s, ctx);
      var n = typeof v === 'number' ? v : parseFloat(v);
      e = el('div', 'sb-barrow ' + node.c);
      head(e, node);
      var track = el('div', 'sb-track');
      var fill = el('div', 'sb-fill');
      var ratio = isNaN(n) ? 0 : Math.min(Math.max((n - node.mn) / (node.mx - node.mn), 0), 1);
      fill.style.width = (ratio / 0.01) + '%';
      track.appendChild(fill);
      var label = node.bad ? '（' + node.bad + '）' : isNaN(n) ? node.em : show(n) + (node.ms ? ' / ' + node.mx : '');
      if (node.nm === 'inside') track.appendChild(el('span', 'sb-in', label));
      e.appendChild(track);
      if (node.nm === 'after' || node.bad) e.appendChild(el('span', 'sb-v', label));
      if (node.st) {
        var st = src(node.st, ctx);
        if (!blank(st)) e.appendChild(el('span', 'sb-stage', show(st)));
      }
    }
    if (e && EDIT && node.i) e.setAttribute('data-node', node.i);
    return e;
  }
`;

// In the card: read this message's stat_data and redraw when MVU says it changed (and every 2 s, to be safe).
const CARD_BOOT = `
  var last = null;
  function opt() { return { type: 'message', message_id: getCurrentMessageId() }; }
  function read() {
    try { var v = getVariables(opt()); return v && v.stat_data ? v.stat_data : null; } catch (e) { return null; }
  }
  function render() {
    var data = read();
    var key = JSON.stringify(data);
    if (key === last) return;
    last = key;
    root.replaceChildren();
    if (!data) { root.appendChild(el('div', 'sb-empty', '变量还没有准备好（需要酒馆助手和 MVU）')); return; }
    var e = draw(VIEW, { data: data });
    if (e) root.appendChild(e);
  }
  render();
  setInterval(render, 2000);
  var waiting = typeof waitGlobalInitialized === 'function' ? waitGlobalInitialized('Mvu') : Promise.reject();
  waiting.then(function () {
    render();
    if (typeof eventOn === 'function' && window.Mvu) eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () { setTimeout(render, 0); });
  }).catch(function () {});
`;

// On the canvas: the editor sends the view, CSS and data; we report where each component is.
const EDITOR_BOOT = `
  var data = {};
  var css = document.getElementById('sbcss');
  function report() {
    var list = [];
    document.querySelectorAll('[data-node]').forEach(function (e) {
      var r = e.getBoundingClientRect();
      list.push({ id: e.getAttribute('data-node'), x: r.left, y: r.top, w: r.width, h: r.height });
    });
    // measure the bar itself (the page is as tall as the frame, so it would never shrink); a little extra for shadows
    var h = Math.ceil(root.getBoundingClientRect().bottom) + 12;
    parent.postMessage({ __sbc: 'layout', rects: list, h: h }, '*');
  }
  function render() {
    root.replaceChildren();
    if (VIEW) { var e = draw(VIEW, { data: data }); if (e) root.appendChild(e); }
    report();
  }
  addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__sbc !== 'set') return;
    VIEW = d.view;
    data = d.data || {};
    css.textContent = d.css;
    render();
  });
  try { new ResizeObserver(report).observe(document.body); } catch (e) {}
  addEventListener('load', report);
  parent.postMessage({ __sbc: 'ready' }, '*');
`;

const program = (view: string, edit: boolean, boot: string) =>
  `(function () {\n  var VIEW = ${view};\n  var EDIT = ${edit};\n  var root = document.getElementById('sb');\n${DRAW}${boot}})();`;

/** The front-end document for the status bar. */
export function statusBarHtml(bar: CompiledBar): string {
  const js = program(safeJson(bar.view), false, CARD_BOOT);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n${bar.css}\n</style>\n</head>\n<body>\n<div id="sb"></div>\n<script>${js}</script>\n</body>\n</html>`;
}

/** What the status bar regex replaces <StatusPlaceHolderImpl/> with. */
export const statusBarReplacement = (bar: CompiledBar) => '```html\n' + statusBarHtml(bar) + '\n```';

/** The canvas page: empty until the editor posts { __sbc: 'set', view, css, data }. */
export function editorHtml(): string {
  const js = program('null', true, EDITOR_BOOT);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style id="sbcss"></style>\n<style>html, body { overflow: hidden; } [data-node] { cursor: default; }</style>\n</head>\n<body>\n<div id="sb"></div>\n<script>${js}</script>\n</body>\n</html>`;
}
