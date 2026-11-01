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
import { STILL, type CompiledBar, type VNode } from './bar';

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

// Drawing: plain JS, no *, single quotes only. VIEW, EDIT, UI (what the player clicked), OPEN (menus open now) and
// EUI (canvas: menus/folds to open and tab pages to show for the selection) are set before this.
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
  // a number as the author asked: units (1金 5银), percent of a range, divided, decimal places, commas
  function fmt(n, f, diff) {
    if (!f) return show(n);
    if (f.u) {
      var r = Math.round(Math.abs(n));
      var parts = [];
      for (var i = 0; i < f.u.length; i++) {
        var q = Math.floor(r / f.u[i][0]);
        r = r % f.u[i][0];
        if (q) parts.push(q + f.u[i][1]);
      }
      if (!parts.length) parts.push('0' + f.u[f.u.length - 1][1]);
      return (n < 0 ? '-' : '') + parts.join(' ');
    }
    if (f.pc) n = (diff ? n : n - f.pc[0]) / (f.pc[1] - f.pc[0]) / 0.01;
    if (f.dv) n = n / f.dv;
    var s;
    if (f.d != null) s = f.cm ? n.toLocaleString('en-US', { minimumFractionDigits: f.d, maximumFractionDigits: f.d }) : n.toFixed(f.d);
    else s = f.cm ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : show(n);
    return s + (f.pc ? '%' : '');
  }
  function src(s, ctx) {
    if (!s) return undefined;
    if (s.nm) return ctx.name;
    if (s.it) return ctx.item;
    if (s.r != null) return ctx.row ? ctx.row[s.r] : undefined;
    return at(ctx.data, s.p);
  }
  function head(e, node, ic) {
    ic = ic || node.ic;
    if (ic) e.appendChild(el('span', 'sb-icon', ic));
    if (node.lb) e.appendChild(el('span', 'sb-label', node.lb));
  }
  // the same value in the previous message (ctx.prev: its data, ctx.prow: the same table row there)
  function old(s, ctx) {
    if (!s || s.nm || s.it) return undefined;
    if (s.r != null) return ctx.prow ? ctx.prow[s.r] : undefined;
    return ctx.prev ? at(ctx.prev, s.p) : undefined;
  }
  // color, icon and words for a value: numbers take each from the last case at or below them, other values the case equal to them
  function pick(node, v) {
    var L = node.cs;
    if (!L || v == null || v === '') return null;
    if (typeof L[0].a === 'number') {
      var n = typeof v === 'number' ? v : parseFloat(v);
      if (isNaN(n)) return null;
      var r = { c: L[0].c, i: L[0].i, x: L[0].x };
      for (var i = 1; i < L.length; i++) {
        if (n < L[i].a) break;
        if (L[i].c) r.c = L[i].c;
        if (L[i].i) r.i = L[i].i;
        if (L[i].x) r.x = L[i].x;
      }
      if (node.sm) r.c = blend(L, n);
      return r;
    }
    for (var j = 0; j < L.length; j++) if (L[j].a === String(v)) return L[j];
    return null;
  }
  // smooth colors: each case's color is exact at its number, in between the two are mixed
  function blend(L, n) {
    var cs = L.filter(function (k) { return k.c; });
    if (n <= cs[0].a) return cs[0].c;
    for (var i = 1; i < cs.length; i++) {
      if (n < cs[i].a) {
        var t = (n - cs[i - 1].a) / (cs[i].a - cs[i - 1].a);
        return 'color-mix(in srgb, ' + cs[i].c + ' ' + Math.round(t / 0.01) + '%, ' + cs[i - 1].c + ')';
      }
    }
    return cs[cs.length - 1].c;
  }
  // up or down since the previous message (the canvas shows a sample when there is nothing to compare with)
  function change(e, node, v, ctx) {
    if (!node.df) return;
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) return;
    var p = old(node.s, ctx);
    var d = 1;
    if (p == null) { if (!EDIT) return; }
    else {
      p = typeof p === 'number' ? p : parseFloat(p);
      if (isNaN(p)) return;
      d = Math.round((n - p) / 0.01) / 100;
      if (!d) return;
    }
    var up = d > 0;
    var a = up ? '↑' : '↓';
    var dt = fmt(Math.abs(d), node.nf, 1);
    var t = node.df === 'a' ? a : node.df === 'n' ? (up ? '+' : '-') + dt : a + dt;
    e.appendChild(el('span', 'sb-diff ' + (up !== !!node.db ? 'sb-good' : 'sb-bad') + (p == null ? ' sb-ghost' : ''), t));
  }
  function face(e, node) {
    if (node.ic) e.appendChild(el('span', 'sb-icon', node.ic));
    if (node.x) e.appendChild(el('span', 'sb-tx', node.x));
  }
  function picOk(u) {
    if (typeof u !== 'string') return false;
    var l = u.slice(0, 11).toLowerCase();
    return l.indexOf('https://') === 0 || l.indexOf('http://') === 0 || l.indexOf('data:image/') === 0;
  }
  function kids(e, list, ctx) {
    list.forEach(function (k) { var x = draw(k, ctx); if (x) e.appendChild(x); });
  }
  function keep() {
    if (!KEY) return;
    try { localStorage.setItem(KEY, JSON.stringify(UI)); } catch (e) {}
  }
  function flip(k) {
    if (UI[k]) delete UI[k]; else UI[k] = 1;
    keep();
    paint();
  }
  // which copy of a part this is (inside repeats: the row name and the list item)
  function who(ctx) {
    return (ctx.name != null ? ctx.name : '') + '/' + (ctx.item != null ? show(ctx.item) : '');
  }
  // a part the player can pick: one at a time per group (its siblings, or a repeat's items), kept with the message
  function pickable(e, node, me, first) {
    var g = node.pk + 'p';
    var on = EDIT ? first && EUI.sel === node.i : UI[g] === me;
    e.className += ' sb-pk' + (on ? ' sb-sel' : '');
    if (EDIT) return;
    var was = e.onclick;
    e.onclick = function (ev) {
      if (was) was(ev);
      ev.stopPropagation();
      if (UI[g] === me) delete UI[g]; else UI[g] = me;
      keep();
      paint();
    };
  }
  function draw(node, ctx) {
    var e = null;
    var v;
    var id = node.c.split(' ')[0];
    var gone = node.h ? !UI[id + 'h'] : !!UI[id + 'h'];
    if (gone && !EDIT) return null;
    if (node.t === 'box') {
      e = el('div', 'sb-box ' + node.c);
      if (node.fw) {
        // free box: the parts sit on a stage drawn at the laid-out size, scaled to fit (fitFree)
        var sg = el('div', 'sb-fs');
        e.appendChild(sg);
        e.sbf = node.fw;
        if (EDIT && node.i) sg.setAttribute('data-stage', node.i);
        kids(sg, node.k, ctx);
      } else kids(e, node.k, ctx);
    } else if (node.t === 'rep') {
      e = el('div', 'sb-rep ' + node.c);
      v = src(node.s, ctx);
      var items = [];
      var pv = old(node.s, ctx);
      if (node.l === 'list') {
        (Array.isArray(v) ? v : []).forEach(function (x) { items.push({ data: ctx.data, prev: ctx.prev, name: ctx.name, row: ctx.row, prow: ctx.prow, item: x }); });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (n) { items.push({ data: ctx.data, prev: ctx.prev, name: n, row: v[n] || {}, prow: pv && typeof pv === 'object' ? pv[n] : undefined, item: ctx.item }); });
      }
      if (!items.length && node.he && !EDIT) return null;
      var ghost = false;
      if (!items.length && EDIT && node.g) {
        items.push({ data: ctx.data, name: node.g.name, row: node.g.row || {}, item: node.g.item });
        ghost = true;
      }
      items.forEach(function (it, ix) {
        var item = el('div', 'sb-item' + (ghost ? ' sb-ghost' : ''));
        kids(item, node.k, it);
        if (node.pk) pickable(item, node, id + '|' + who(it), !ix);
        e.appendChild(item);
      });
      if (!items.length && node.e) e.appendChild(el('div', 'sb-empty', node.e));
    } else if (node.t === 'text') {
      e = el('div', 'sb-text ' + node.c);
      e.appendChild(el('span', 'sb-tx', node.x));
    } else if (node.t === 'hr') {
      e = el('div', 'sb-hr ' + node.c);
      if (node.x) e.appendChild(el('span', '', node.x));
    } else if (node.t === 'btn') {
      e = el('button', 'sb-btn ' + node.c);
      face(e, node);
      var act = node.a;
      if (!EDIT && act) e.onclick = function (ev) { ev.stopPropagation(); OPEN = {}; press(act); };
    } else if (node.t === 'menu') {
      e = el('div', 'sb-menu ' + node.c);
      e.setAttribute('data-m', id);
      var mb = el('button', 'sb-btn sb-mbtn');
      face(mb, node);
      if (node.ar) mb.appendChild(el('span', 'sb-arrow', '▾'));
      e.appendChild(mb);
      if (EDIT ? EUI.open[node.i] : OPEN[id]) {
        var pop = el('div', 'sb-pop');
        kids(pop, node.k, ctx);
        e.appendChild(pop);
      }
      var me = e;
      if (!EDIT) mb.onclick = function (ev) {
        ev.stopPropagation();
        if (OPEN[id]) { delete OPEN[id]; paint(); return; }
        // keep the menus this one is in, close the rest
        var next = {};
        for (var p = me.parentNode; p && p !== root; p = p.parentNode) if (p.getAttribute && p.getAttribute('data-m')) next[p.getAttribute('data-m')] = 1;
        next[id] = 1;
        OPEN = next;
        paint();
      };
    } else if (node.t === 'tabs') {
      e = el('div', 'sb-tabs ' + node.c);
      var pg = EDIT ? EUI.page[node.i] : UI[id];
      if (pg == null || !node.k[pg]) pg = node.st;
      var tb = el('div', 'sb-tabbar');
      node.tl.forEach(function (t, i) {
        var b = el('button', 'sb-tab' + (i === pg ? ' sb-on' : ''), t);
        if (EDIT) { if (node.k[i] && node.k[i].i) b.setAttribute('data-tab', node.k[i].i); }
        else b.onclick = function () { UI[id] = i; keep(); paint(); };
        tb.appendChild(b);
      });
      e.appendChild(tb);
      if (node.k[pg]) { var pe = draw(node.k[pg], ctx); if (pe) e.appendChild(pe); }
    } else if (node.t === 'fold') {
      var open = EDIT ? !node.cl || !!EUI.open[node.i] : node.cl ? !!UI[id] : !UI[id];
      e = el('div', 'sb-fold ' + node.c + (open ? '' : ' sb-closed'));
      var fh = el('div', 'sb-fhead');
      face(fh, node);
      if (!EDIT) fh.onclick = function () { flip(id); };
      e.appendChild(fh);
      if (open) {
        var fb = el('div', 'sb-box sb-fbody' + node.bc);
        kids(fb, node.k, ctx);
        e.appendChild(fb);
      }
    } else if (node.t === 'val') {
      var raw = node.bad ? undefined : src(node.s, ctx);
      v = node.so ? src(node.st, ctx) : raw;
      var vc = pick(node, raw);
      e = el('div', 'sb-val ' + node.c);
      if (blank(v) && node.he) {
        if (!EDIT) return null;
        e.className += ' sb-ghost';
      }
      head(e, node, vc && vc.i);
      if (node.bad) {
        e.appendChild(el('span', 'sb-v sb-empty', '（' + node.bad + '）'));
      } else if (blank(v)) {
        e.appendChild(el('span', 'sb-v' + (node.pl ? ' sb-pill' : ''), node.em));
      } else if (typeof v === 'object' && node.la !== 'text') {
        var chips = el('span', 'sb-chips');
        (Array.isArray(v) ? v : Object.keys(v)).forEach(function (x) { chips.appendChild(el('span', 'sb-chip', show(x))); });
        e.appendChild(chips);
      } else {
        var text = v === true && node.y != null ? node.y : v === false && node.n != null ? node.n : typeof v === 'number' && node.nf ? fmt(v, node.nf) : show(v, node.sep);
        var ve = el('span', 'sb-v' + (node.pl ? ' sb-pill' : ''), (node.pre || '') + text + (node.suf || ''));
        if (vc && vc.c) {
          if (node.pl) ve.style.background = vc.c;
          else {
            ve.style.background = 'none';
            ve.style.color = vc.c;
            ve.style.setProperty('-webkit-text-fill-color', vc.c);
          }
        }
        e.appendChild(ve);
      }
      change(e, node, raw, ctx);
      if (vc && vc.x) e.appendChild(el('span', 'sb-stage', vc.x));
      else if (node.st && !node.so) {
        var sv = src(node.st, ctx);
        if (!blank(sv)) e.appendChild(el('span', 'sb-stage', show(sv)));
      }
    } else if (node.t === 'bar') {
      v = node.bad ? undefined : src(node.s, ctx);
      var n = typeof v === 'number' ? v : parseFloat(v);
      e = el('div', 'sb-barrow ' + node.c);
      var bc = pick(node, n);
      head(e, node, bc && bc.i);
      if (bc && bc.c) {
        e.style.setProperty('--fa', bc.c);
        e.style.setProperty('--fb', bc.c);
      }
      var ratio = isNaN(n) ? 0 : Math.min(Math.max((n - node.mn) / (node.mx - node.mn), 0), 1);
      var cnt = node.sc || 10;
      if (node.wh) ratio = Math.round(ratio / (1 / cnt)) / cnt;
      var pct = ratio / 0.01;
      var track;
      if (node.lk === 'seg') {
        track = el('div', 'sb-segs');
        var on = Math.round(ratio / (1 / cnt));
        if (on < 1 && ratio > 0) on = 1;
        for (var si = 0; si < cnt; si++) {
          var sg = el('div', 'sb-seg' + (si < on ? ' sb-on' : ''));
          // one gradient running across all the lit segments
          if (si < on && cnt > 1) {
            sg.style.backgroundSize = (cnt / 0.01) + '% 100%';
            sg.style.backgroundPosition = (si / (cnt - 1) / 0.01) + '% 0';
          }
          track.appendChild(sg);
        }
      } else if (node.lk === 'ring') {
        track = el('div', 'sb-ringw');
        var ring = el('div', 'sb-ring');
        ring.style.background = 'conic-gradient(var(--fa), var(--fb) ' + pct + '%, var(--tk) ' + pct + '%)';
        track.appendChild(ring);
      } else if (node.lk === 'sym') {
        track = el('span', 'sb-sym');
        var syms = '';
        for (var sj = 0; sj < cnt; sj++) syms += node.sy;
        track.appendChild(el('span', 'sb-syme', syms));
        var sf = el('span', 'sb-symf', syms);
        sf.style.width = pct + '%';
        track.appendChild(sf);
      } else {
        track = el('div', 'sb-track');
        var fill = el('div', 'sb-fill');
        fill.style.width = pct + '%';
        if (bc && bc.c) fill.style.background = bc.c;
        track.appendChild(fill);
      }
      var label = node.bad ? '（' + node.bad + '）' : isNaN(n) ? node.em : fmt(n, node.nf) + (node.ms && !(node.nf && node.nf.pc) ? ' / ' + fmt(node.mx, node.nf) : '');
      if (node.nm === 'inside') track.appendChild(el('span', 'sb-in', label));
      e.appendChild(track);
      if (node.nm === 'after' || node.bad) e.appendChild(el('span', 'sb-v', label));
      change(e, node, n, ctx);
      if (bc && bc.x) e.appendChild(el('span', 'sb-stage', bc.x));
      else if (node.st) {
        var st = src(node.st, ctx);
        if (!blank(st)) e.appendChild(el('span', 'sb-stage', show(st)));
      }
    } else if (node.t === 'img') {
      var u = node.u;
      if (node.s) {
        v = node.bad ? undefined : src(node.s, ctx);
        var key = v == null ? '' : String(v);
        var mu = node.m ? (Object.prototype.hasOwnProperty.call(node.m, key) ? node.m[key] : null) : key;
        if (picOk(mu)) u = mu;
      }
      if (picOk(u)) {
        e = el('img', 'sb-img ' + node.c);
        e.alt = '';
        var ie = e;
        ie.onerror = function () {
          if (!EDIT) { ie.style.display = 'none'; return; }
          var ph = el('div', 'sb-imgph ' + node.c, '图片打不开');
          if (node.i) ph.setAttribute('data-node', node.i);
          if (ie.parentNode) ie.parentNode.replaceChild(ph, ie);
        };
        e.src = u;
      } else {
        if (!EDIT) return null;
        e = el('div', 'sb-imgph ' + node.c, node.bad ? '（' + node.bad + '）' : node.s ? '图片（现在的值没有对应的图）' : '图片');
      }
    }
    if (e && node.pk && node.t !== 'rep') pickable(e, node, id + '|' + who(ctx), true);
    if (e && gone) e.className += ' sb-ghost';
    if (e && EDIT && node.i) e.setAttribute('data-node', node.i);
    return e;
  }
  // free boxes: the stage scaled evenly to the width the box has (or the parts one under another when it is narrow)
  function fitFree() {
    root.querySelectorAll('.sb-free').forEach(function (e) {
      var f = e.sbf;
      var sg = e.firstChild;
      if (!f || !sg) return;
      var cs = getComputedStyle(e);
      var cw = e.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      var narrow = f[2] && f[2] > cw;
      e.classList.toggle('sb-stack', !!narrow);
      if (narrow || !(cw > 0)) {
        sg.style.transform = '';
        sg.style.marginRight = '';
        sg.style.marginBottom = '';
        return;
      }
      sg.style.transform = 'scale(' + cw / f[0] + ')';
      sg.style.marginRight = cw - f[0] + 'px';
      sg.style.marginBottom = f[1] / (f[0] / cw) - f[1] + 'px';
    });
  }
  // open menus hang below the bar; make room for them, or the frame cuts them off
  function fitPops() {
    var b = root.getBoundingClientRect().bottom;
    var need = 0;
    root.querySelectorAll('.sb-pop').forEach(function (p) { need = Math.max(need, p.getBoundingClientRect().bottom - b); });
    if (need > 0) {
      var sp = el('div', 'sb-room');
      sp.style.height = Math.ceil(need + 8) + 'px';
      root.appendChild(sp);
    }
  }
`;

// In the card, what buttons do.
const PRESS = `
  function press(a) {
    if (a.ed) EDITING = a;
    else if (a.tg) { flip(a.f ? a.tg : a.tg + 'h'); return; }
    else if (a.pg) { UI[a.pg] = a.n; keep(); }
    else if (a.say != null) say(a);
    paint();
  }
  function say(a) {
    // a | would start the next command
    var t = String(a.say).split('|').join('\\\\|');
    try { triggerSlash(a.send ? '/send ' + t + ' | /trigger' : '/setinput ' + t); } catch (e) {}
  }
`;

// The players' edit form (only in cards that have an edit button). It takes the bar's place until saved or closed.
// Saving goes straight into the variables, past MVU's checks, so ranges, stages and empty rows are handled here.
const FORM = `
  function cp(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function setAt(o, p, v) {
    var cur = o;
    for (var i = 0; i < p.length - 1; i++) {
      if (cur[p[i]] == null || typeof cur[p[i]] !== 'object') cur[p[i]] = {};
      cur = cur[p[i]];
    }
    cur[p[p.length - 1]] = v;
  }
  function stageOf(sg, v) {
    var l = sg[0].l;
    sg.forEach(function (s) { if (v >= s.f) l = s.l; });
    return l;
  }
  function fix(m, v) {
    v = parseFloat(v);
    if (isNaN(v)) return null;
    if (m.int) v = Math.round(v);
    if (m.mn != null && v < m.mn) v = m.mn;
    if (m.mx != null && v > m.mx) v = m.mx;
    return v;
  }
  function inp(type, cls) { var e = el('input', cls); e.type = type; return e; }
  function numIn(m, val, put) {
    var w = el('span', 'sb-ed-num');
    var n = inp('number');
    var r = null;
    if (m.mn != null) n.min = m.mn;
    if (m.mx != null) n.max = m.mx;
    n.step = m.int ? '1' : 'any';
    n.value = typeof val === 'number' ? String(val) : '';
    if (m.mn != null && m.mx != null) {
      r = inp('range');
      r.min = m.mn;
      r.max = m.mx;
      r.step = m.int ? '1' : 'any';
      r.value = n.value;
      r.oninput = function () { var v = fix(m, r.value); n.value = v; put(v); };
      w.appendChild(r);
    }
    n.onchange = function () {
      var v = fix(m, n.value);
      if (v == null) return;
      n.value = v;
      if (r) r.value = v;
      put(v);
    };
    w.appendChild(n);
    return w;
  }
  function listIn(arr, put) {
    var w = el('div', 'sb-ed-list');
    function redo() {
      w.replaceChildren();
      arr.forEach(function (x, i) {
        var c = el('div', 'sb-ed-cell');
        var t = inp('text');
        t.value = x;
        t.oninput = function () { arr[i] = t.value; put(arr.slice()); };
        var del = el('button', 'sb-ed-x', '✕');
        del.title = '删掉';
        del.onclick = function () { arr.splice(i, 1); put(arr.slice()); redo(); };
        c.appendChild(t);
        c.appendChild(del);
        w.appendChild(c);
      });
      var add = el('div', 'sb-ed-add');
      var ni = inp('text');
      ni.placeholder = '新的一项';
      var ab = el('button', 'sb-ed-b', '添加');
      ab.onclick = function () {
        var v = ni.value.trim();
        if (!v) return;
        arr.push(v);
        put(arr.slice());
        redo();
      };
      add.appendChild(ni);
      add.appendChild(ab);
      w.appendChild(add);
    }
    redo();
    return w;
  }
  function field(m, val, put) {
    if (m.t === 'number') return numIn(m, val, put);
    if (m.t === 'list') return listIn(Array.isArray(val) ? val.slice() : [], put);
    if (m.t === 'bool') {
      var c = inp('checkbox');
      c.checked = !!val;
      c.onchange = function () { put(c.checked); };
      return c;
    }
    if (m.t === 'choice') {
      var s = el('select');
      (m.o || []).forEach(function (o) { var op = el('option', '', o); op.value = o; s.appendChild(op); });
      s.value = val == null ? '' : String(val);
      s.onchange = function () { put(s.value); };
      return s;
    }
    var t = inp('text');
    t.value = val == null ? '' : String(val);
    t.oninput = function () { put(t.value); };
    return t;
  }
  function tableIn(m, rows, put) {
    var w = el('div', 'sb-ed-table');
    var order = Object.keys(rows && typeof rows === 'object' ? rows : {}).map(function (k) { return { n: k, r: cp(rows[k]) || {} }; });
    function out() {
      var o = {};
      order.forEach(function (x) { if (x.n) o[x.n] = x.r; });
      put(o);
    }
    function redo() {
      w.replaceChildren();
      order.forEach(function (x, i) {
        var tr = el('div', 'sb-ed-trow');
        var nm = inp('text', 'sb-ed-rname');
        nm.value = x.n;
        nm.placeholder = m.rn;
        nm.onchange = function () { x.n = nm.value.trim(); out(); };
        tr.appendChild(nm);
        (m.f || []).forEach(function (f) {
          var c = el('label', 'sb-ed-cell');
          c.appendChild(el('span', 'sb-ed-name', f.n));
          c.appendChild(field(f, x.r[f.k], function (v) {
            x.r[f.k] = v;
            if (f.sg && typeof v === 'number') x.r[f.sn] = stageOf(f.sg, v);
            out();
          }));
          tr.appendChild(c);
        });
        var del = el('button', 'sb-ed-x', '✕');
        del.title = '删掉这一行';
        del.onclick = function () { order.splice(i, 1); out(); redo(); };
        tr.appendChild(del);
        w.appendChild(tr);
      });
      var ab = el('button', 'sb-ed-b', '＋ 添加一行');
      ab.onclick = function () {
        var r = {};
        (m.f || []).forEach(function (f) {
          r[f.k] = cp(f.d);
          if (f.sg && typeof r[f.k] === 'number') r[f.sn] = stageOf(f.sg, r[f.k]);
        });
        var name = '新' + m.rn;
        for (var k = 2; order.some(function (x) { return x.n === name; }); k++) name = '新' + m.rn + k;
        order.push({ n: name, r: r });
        out();
        redo();
      };
      w.appendChild(ab);
    }
    redo();
    return w;
  }
  function write(next) {
    return Promise.resolve().then(function () {
      if (window.Mvu && Mvu.getMvuData && Mvu.replaceMvuData) {
        var mv = Mvu.getMvuData(opt()) || {};
        mv.stat_data = next;
        return Mvu.replaceMvuData(mv, opt());
      }
      if (typeof updateVariablesWith === 'function') return updateVariablesWith(function (v) { v.stat_data = next; return v; }, opt());
      throw new Error('没找到酒馆助手');
    });
  }
  function editForm(a) {
    var work = cp(DATA) || {};
    var list = (a.vs ? a.vs.map(function (i) { return ED[i]; }) : ED).filter(function (m) { return m; });
    var box = el('div', 'sb-ed');
    box.appendChild(el('div', 'sb-ed-title', a.tt || '修改变量'));
    try {
      if (getCurrentMessageId() < getLastMessageId()) box.appendChild(el('div', 'sb-ed-note', '这是前面楼层的变量，改了只影响这一楼，不影响最新的剧情。'));
    } catch (e) {}
    list.forEach(function (m) {
      var wide = m.t === 'list' || m.t === 'table';
      var row = el(wide ? 'div' : 'label', 'sb-ed-row' + (wide ? ' sb-ed-wide' : ''));
      row.appendChild(el('span', 'sb-ed-name', m.n));
      var put = function (v) {
        setAt(work, m.p, v);
        if (m.sg && typeof v === 'number') setAt(work, m.p.slice(0, -1).concat([m.sn]), stageOf(m.sg, v));
      };
      row.appendChild(m.t === 'table' ? tableIn(m, at(work, m.p), put) : field(m, at(work, m.p), put));
      box.appendChild(row);
    });
    var msg = el('div', 'sb-ed-msg');
    box.appendChild(msg);
    var btns = el('div', 'sb-ed-btns');
    var no = el('button', 'sb-ed-b', '取消');
    var ok = el('button', 'sb-ed-b sb-ed-ok', '保存');
    no.onclick = function () { EDITING = null; paint(); };
    ok.onclick = function () {
      list.forEach(function (m) {
        var t = m.dz ? at(work, m.p) : null;
        if (t && typeof t === 'object') Object.keys(t).forEach(function (k) { if (!(t[k] && t[k][m.dz] > 0)) delete t[k]; });
      });
      ok.disabled = true;
      msg.textContent = '正在保存…';
      write(work).then(function () {
        EDITING = null;
        render(true);
      }, function (e) {
        ok.disabled = false;
        msg.textContent = '没保存上：' + ((e && e.message) || e);
      });
    };
    btns.appendChild(no);
    btns.appendChild(ok);
    box.appendChild(btns);
    return box;
  }
`;

// In the card: read this message's stat_data and redraw when MVU says it changed (and every 2 s, to be safe).
const CARD_BOOT = `
  var last = null;
  var DATA = null;
  try { UI = (KEY && JSON.parse(localStorage.getItem(KEY) || '{}')) || {}; } catch (e) { UI = {}; }
  function opt() { return { type: 'message', message_id: getCurrentMessageId() }; }
  function read() {
    try { var v = getVariables(opt()); return v && v.stat_data ? v.stat_data : null; } catch (e) { return null; }
  }
  // the variables of the message before (a few back at most: user messages may have none), for the up and down arrows
  var PREV = null;
  function readPrev() {
    try {
      var id = getCurrentMessageId();
      for (var j = id - 1; j >= 0 && j >= id - 6; j--) {
        var pv = getVariables({ type: 'message', message_id: j });
        if (pv && pv.stat_data) return pv.stat_data;
      }
    } catch (e) {}
    return null;
  }
  var fresh = 1;
  function paint() {
    root.replaceChildren();
    if (EDITING) { root.appendChild(editForm(EDITING)); return; }
    if (!DATA) { root.appendChild(el('div', 'sb-empty', '变量还没有准备好（需要酒馆助手和 MVU）')); return; }
    // entrance animations: only the first time, then the loops take over
    if (fresh) {
      fresh = 0;
      root.classList.add('sb-intro');
      setTimeout(function () { root.classList.remove('sb-intro'); }, 2400);
    }
    var e = draw(VIEW, { data: DATA, prev: PREV });
    if (e) root.appendChild(e);
    fitFree();
    fitPops();
  }
  function render(force) {
    if (EDITING) return;
    var data = read();
    var prev = NEED_PREV ? readPrev() : null;
    var key = JSON.stringify([data, prev]);
    if (key === last && !force) return;
    last = key;
    DATA = data;
    PREV = prev;
    paint();
  }
  // a click anywhere else closes open menus
  document.addEventListener('click', function () {
    if (!Object.keys(OPEN).length) return;
    OPEN = {};
    paint();
  });
  addEventListener('resize', function () { if (!EDITING) { fitFree(); } });
  render();
  setInterval(render, 2000);
  var waiting = typeof waitGlobalInitialized === 'function' ? waitGlobalInitialized('Mvu') : Promise.reject();
  waiting.then(function () {
    render();
    if (typeof eventOn === 'function' && window.Mvu) eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, function () { setTimeout(render, 0); });
  }).catch(function () {});
`;

// On the canvas: the editor sends the view, CSS, data and what to open; we report where each component is.
// z: how many menus deep (those are on top), tab: a tab label (it stands for its page).
const EDITOR_BOOT = `
  var data = {};
  var prev = null;
  var css = document.getElementById('sbcss');
  function depth(e) {
    var z = 0;
    for (var p = e.parentNode; p && p !== root; p = p.parentNode) if (p.classList && p.classList.contains('sb-pop')) z++;
    return z;
  }
  // a box's inside on the canvas, and how wide that is in its own px (it may be drawn scaled down)
  function inner(e, r) {
    var cs = getComputedStyle(e);
    var q = e.offsetWidth ? r.width / e.offsetWidth : 1;
    var l = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    var t = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    var w = e.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var h = e.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    return { x: r.left + l / (1 / q), y: r.top + t / (1 / q), w: w / (1 / q), h: h / (1 / q), u: w };
  }
  function report() {
    var list = [];
    document.querySelectorAll('[data-node]').forEach(function (e) {
      var r = e.getBoundingClientRect();
      var o = { id: e.getAttribute('data-node'), x: r.left, y: r.top, w: r.width, h: r.height, z: depth(e) };
      if (e.classList.contains('sb-box')) o.cb = inner(e, r);
      list.push(o);
    });
    document.querySelectorAll('[data-stage]').forEach(function (e) {
      if (e.parentNode.classList.contains('sb-stack')) return;
      var r = e.getBoundingClientRect();
      list.push({ id: e.getAttribute('data-stage'), stage: 1, x: r.left, y: r.top, w: r.width, h: r.height, z: depth(e) });
    });
    document.querySelectorAll('[data-tab]').forEach(function (e) {
      var r = e.getBoundingClientRect();
      list.push({ id: e.getAttribute('data-tab'), tab: 1, x: r.left, y: r.top, w: r.width, h: r.height, z: depth(e) });
    });
    // measure the bar itself (the page is as tall as the frame, so it would never shrink); a little extra for shadows
    var h = Math.ceil(root.getBoundingClientRect().bottom) + 12;
    parent.postMessage({ __sbc: 'layout', rects: list, h: h }, '*');
  }
  function paint() {
    root.replaceChildren();
    if (VIEW) { var e = draw(VIEW, { data: data, prev: prev }); if (e) root.appendChild(e); }
    fitFree();
    fitPops();
    report();
  }
  // motion is off on the canvas (it would move things away from their outlines) unless asked to play it once
  var still = document.getElementById('sbstill');
  var playing = 0;
  function play() {
    clearTimeout(playing);
    still.disabled = true;
    root.classList.add('sb-intro');
    paint();
    setTimeout(function () { root.classList.remove('sb-intro'); }, 2400);
    playing = setTimeout(function () { still.disabled = false; report(); }, 7000);
  }
  addEventListener('message', function (ev) {
    var d = ev.data;
    if (d && d.__sbc === 'play') { play(); return; }
    if (!d || d.__sbc !== 'set') return;
    VIEW = d.view;
    data = d.data || {};
    prev = d.prev || null;
    EUI = d.ui || { open: {}, page: {} };
    css.textContent = d.css;
    paint();
  });
  try { new ResizeObserver(function () { fitFree(); report(); }).observe(document.body); } catch (e) {}
  addEventListener('load', report);
  parent.postMessage({ __sbc: 'ready' }, '*');
`;

const program = (head: string, boot: string) =>
  `(function () {\n${head}\n  var UI = {};\n  var OPEN = {};\n  var EDITING = null;\n  var EUI = { open: {}, page: {} };\n  var root = document.getElementById('sb');\n${DRAW}${boot}})();`;

/** Does any component compare with the previous message? (Only then the runtime reads it.) */
function usesPrev(n: VNode): boolean {
  return ('df' in n && !!n.df) || ('k' in n && n.k.some(usesPrev));
}

/** The front-end document for the status bar. */
export function statusBarHtml(bar: CompiledBar): string {
  const head = [
    `  var VIEW = ${safeJson(bar.view)};`,
    '  var EDIT = false;',
    `  var KEY = ${safeJson(bar.key ? `stbs-ui-${bar.key}` : null)};`,
    `  var NEED_PREV = ${usesPrev(bar.view) ? 1 : 0};`,
    ...(bar.hasEdit ? [`  var ED = ${safeJson(bar.ed)};`] : []),
    // hand-written CSS may hold characters SillyTavern would change in the page, so it comes in as a string
    ...(bar.xcss ? [`  var XCSS = document.createElement('style');`, `  XCSS.textContent = ${safeJson(bar.xcss)};`, '  document.head.appendChild(XCSS);'] : []),
  ].join('\n');
  const js = program(head, PRESS + (bar.hasEdit ? FORM : '') + CARD_BOOT);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n${bar.css}\n</style>\n</head>\n<body>\n<div id="sb"></div>\n<script>${js}</script>\n</body>\n</html>`;
}

/** What the status bar regex replaces <StatusPlaceHolderImpl/> with. */
export const statusBarReplacement = (bar: CompiledBar) => '```html\n' + statusBarHtml(bar) + '\n```';

/** The canvas page: empty until the editor posts { __sbc: 'set', view, css, data, ui }. */
export function editorHtml(): string {
  const js = program('  var VIEW = null;\n  var EDIT = true;\n  var KEY = null;', EDITOR_BOOT);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style id="sbcss"></style>\n<style>html, body { overflow: hidden; } [data-node] { cursor: default; } button { pointer-events: none; }</style>\n<style id="sbstill">${STILL} { animation: none !important; transition: none !important; }</style>\n</head>\n<body>\n<div id="sb"></div>\n<script>${js}</script>\n</body>\n</html>`;
}
