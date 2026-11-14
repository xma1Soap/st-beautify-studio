// What a front-end card finds around it in SillyTavern (TavernHelper + MVU), rebuilt inside the preview frame.
// `thRuntime` is sent into the card as text and runs there, so it must not use anything from outside itself.

export interface RuntimeCtx {
  /** the message as stored (what getChatMessages gives) */
  raw: string;
  user: string;
  char: string;
  /** the message is the character's (otherwise the user's) */
  ai: boolean;
  /** chat height in px, for --TH-viewport-height */
  vh: number;
  /** MVU variables of this message (missing: no MVU in this preview) */
  stat?: unknown;
  /** MVU variables of the message before; when given, this message counts as the second one */
  prev?: unknown;
  /** the card's own TavernHelper variables, getVariables({ type: 'character' }) */
  charVars?: Record<string, unknown>;
  /** card fields for getCharData */
  card?: Record<string, string>;
  /**
   * The whole chat, oldest first, when the preview shows several messages: what each message stores and its MVU
   * variables (none on a message MVU keeps none for). This message is chat[id]; `raw`, `ai`, `stat`, `prev` are then
   * not needed.
   */
  chat?: ChatEntry[];
  id?: number;
}

/** One message of the chat around a card. */
export interface ChatEntry {
  raw: string;
  ai: boolean;
  stat?: unknown;
}

const jsStr = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');

/** The script that sets up the stand-ins, ready to put in a <script>. */
export const runtimeScript = (ctx: RuntimeCtx) => `(${thRuntime.toString()})(${jsStr(ctx)});`;

/** Runs after the libraries: reports pages and data that $.load / $.ajax couldn't fetch. */
export const AFTER_LIBS = `if(window.jQuery)jQuery(document).ajaxError(function(e,x,s){parent.postMessage({__stp:'err',msg:'没能载入 '+(s&&s.url)+'（'+(x&&x.status?'HTTP '+x.status:'网络不通或被拦截')+'）'},'*')});`;

function thRuntime(C: RuntimeCtx) {
  const w = window as any;
  const post = (m: any) => parent.postMessage(m, '*');
  const report = (m: unknown) => post({ __stp: 'err', msg: String(m).slice(0, 400) });

  // sandboxed frames can't use the browser's storage; give them one that lasts until the preview reloads
  ['localStorage', 'sessionStorage'].forEach((n) => {
    try {
      void w[n].length;
    } catch {
      let m: Record<string, string> = {};
      const S: any = {
        getItem: (k: string) => (Object.prototype.hasOwnProperty.call(m, String(k)) ? m[String(k)] : null),
        setItem: (k: string, v: unknown) => void (m[String(k)] = String(v)),
        removeItem: (k: string) => void delete m[String(k)],
        clear: () => void (m = {}),
        key: (i: number) => Object.keys(m)[i] ?? null,
      };
      Object.defineProperty(S, 'length', { get: () => Object.keys(m).length });
      try {
        Object.defineProperty(w, n, { configurable: true, value: S });
      } catch {}
    }
  });
  // like TavernHelper (adjust_viewport.js): the chat window's height, and again whenever that window is resized (a card
  // here can't read its parent's size itself, so the chat page sends it)
  document.documentElement.style.setProperty('--TH-viewport-height', C.vh + 'px');
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source === parent && d && d.__stp === 'vh' && Number(d.h) > 0) document.documentElement.style.setProperty('--TH-viewport-height', Number(d.h) + 'px');
  });

  /* ---------- small helpers (lodash comes later, so not that) ---------- */
  const cp = (o: any) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  const isObj = (x: any) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const merge = (a: any, b: any): any => {
    if (!isObj(a) || !isObj(b)) return cp(b);
    const o: any = { ...a };
    for (const k of Object.keys(b)) o[k] = k in o ? merge(o[k], b[k]) : cp(b[k]);
    return o;
  };
  const toPath = (p: any): string[] =>
    Array.isArray(p)
      ? p.map(String)
      : String(p)
          .replace(/\[(?:"([^"]*)"|'([^']*)'|([^\]]*))\]/g, (_m, a, b, c) => '.' + (a ?? b ?? c))
          .split('.')
          .filter((s) => s !== '');
  const getAt = (o: any, p: any) => toPath(p).reduce((x, k) => (x == null ? undefined : x[k]), o);
  const setAt = (o: any, p: any, v: any) => {
    const ks = toPath(p);
    let x = o;
    ks.slice(0, -1).forEach((k, i) => {
      if (x[k] === null || typeof x[k] !== 'object') x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
      x = x[k];
    });
    if (ks.length) x[ks[ks.length - 1]] = v;
  };
  const delAt = (o: any, p: any) => {
    const ks = toPath(p);
    const box = getAt(o, ks.slice(0, -1));
    if (box && typeof box === 'object' && ks.length && ks[ks.length - 1] in box) {
      delete box[ks[ks.length - 1]];
      return true;
    }
    return false;
  };
  const show = (v: any) => (typeof v === 'string' ? v : JSON.stringify(v));

  /* ---------- the chat: the whole chat given, or one message (two when there is a message before) ---------- */
  const CHAT = C.chat && C.chat.length ? C.chat : null;
  const mvu = CHAT ? CHAT.some((m) => m.stat !== undefined) : C.stat !== undefined;
  /** this message, and the newest one */
  const MID = CHAT ? Math.max(0, Math.min(Number(C.id) || 0, CHAT.length - 1)) : C.prev !== undefined ? 1 : 0;
  const LAST = CHAT ? CHAT.length - 1 : MID;

  /** MVU's own copy of what changed: display_data shows "old->new" where a value changed, delta_data only those. */
  const mvuData = (stat: any, before: any) => {
    const display = cp(stat) ?? {};
    const delta: any = {};
    const walk = (now: any, old: any, path: string[]) => {
      if (isObj(now) && isObj(old)) {
        for (const k of Object.keys(now)) walk(now[k], old[k], path.concat(k));
        return;
      }
      if (old === undefined || JSON.stringify(now) === JSON.stringify(old)) return;
      const s = `${show(old)}->${show(now)}`;
      setAt(display, path, s);
      setAt(delta, path, s);
    };
    if (before !== undefined) walk(stat, before, []);
    return { initialized_lorebooks: {}, stat_data: cp(stat) ?? {}, display_data: display, delta_data: delta };
  };
  const MSG: Record<number, any> = {};
  if (CHAT) {
    // MVU compares each message's variables with those of the message before that has some
    let before: any;
    CHAT.forEach((m, i) => {
      if (m.stat === undefined) return;
      MSG[i] = mvuData(m.stat, before);
      before = m.stat;
    });
  } else if (mvu) {
    if (MID === 1) MSG[0] = mvuData(C.prev, undefined);
    MSG[MID] = mvuData(C.stat, C.prev);
  }
  const STORE: Record<string, any> = { chat: {}, character: cp(C.charVars ?? {}), global: {}, script: {}, preset: {}, extension: {} };

  const msgId = (id: any) => {
    if (id === undefined || id === 'latest') return LAST;
    const n = Number(id);
    return n < 0 ? LAST + 1 + n : n;
  };
  /** The variables an option points at, TavernHelper style ({ type: 'chat' } when not said). */
  const bag = (o: any) => {
    const t = (o && o.type) || 'chat';
    if (t === 'message') {
      const id = msgId(o.message_id);
      return {
        get: () => MSG[id] ?? {},
        set: (v: any) => {
          MSG[id] = v;
          post({ __stp: 'stat' });
        },
      };
    }
    return {
      get: () => (STORE[t] ??= {}),
      set: (v: any) => void (STORE[t] = v),
    };
  };

  /* ---------- events ---------- */
  const ON: Record<string, ((...a: any[]) => any)[]> = {};
  const emit = (n: string, ...a: any[]) => {
    for (const f of (ON[n] ?? []).slice()) {
      try {
        f(...a);
      } catch (e: any) {
        report(e && e.message);
      }
    }
    return Promise.resolve();
  };
  const on = (first: boolean, once: boolean) => (n: string, f: (...a: any[]) => any) => {
    const g: (...a: any[]) => any = once ? (...a: any[]) => (off(n, g), f(...a)) : f;
    const l = (ON[n] ??= []);
    if (first) l.unshift(g);
    else l.push(g);
    return { stop: () => off(n, g) };
  };
  const off = (n: string, f: any) => void (ON[n] = (ON[n] ?? []).filter((x) => x !== f));
  const names = new Proxy({}, { get: (_t, k) => String(k).toLowerCase() });
  Object.assign(w, {
    eventOn: on(false, false),
    eventMakeLast: on(false, false),
    eventMakeFirst: on(true, false),
    eventOnce: on(false, true),
    eventOnButton: on(false, false),
    eventEmit: emit,
    eventEmitAndWait: emit,
    eventRemoveListener: off,
    eventClearEvent: (n: string) => void delete ON[n],
    eventClearListener: (f: any) => Object.keys(ON).forEach((n) => off(n, f)),
    eventClearAll: () => Object.keys(ON).forEach((n) => delete ON[n]),
    tavern_events: names,
    iframe_events: names,
  });

  /* ---------- variables (TavernHelper) ---------- */
  Object.assign(w, {
    getVariables: (o?: any) => cp(bag(o).get()),
    getAllVariables: () => merge(merge(merge(STORE.global, STORE.character), STORE.chat), MSG[MID] ?? {}),
    replaceVariables: (v: any, o?: any) => (bag(o).set(cp(v ?? {})), Promise.resolve()),
    insertOrAssignVariables: (v: any, o?: any) => {
      const b = bag(o);
      const r = merge(b.get(), v ?? {});
      b.set(r);
      return Promise.resolve(cp(r));
    },
    insertVariables: (v: any, o?: any) => {
      const b = bag(o);
      const r = merge(v ?? {}, b.get());
      b.set(r);
      return Promise.resolve(cp(r));
    },
    deleteVariable: (p: any, o?: any) => {
      const b = bag(o);
      const v = b.get();
      const done = delAt(v, p);
      b.set(v);
      return Promise.resolve({ variables: cp(v), delete_occurred: done });
    },
    updateVariablesWith: (f: (v: any) => any, o?: any) => {
      const b = bag(o);
      const v = cp(b.get());
      const r = f(v) ?? v;
      return Promise.resolve(r).then((x) => (b.set(cp(x)), cp(x)));
    },
  });

  /* ---------- MVU ---------- */
  const latest = (o: any) => o ?? { type: 'message', message_id: 'latest' };
  if (mvu)
    w.Mvu = {
      events: {
        VARIABLE_INITIALIZED: 'mag_variable_initialized',
        VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
        VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
        COMMAND_PARSED: 'mag_command_parsed',
        BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
      },
      getMvuData: (o?: any) => {
        const d = cp(bag(latest(o)).get());
        return { initialized_lorebooks: {}, stat_data: {}, display_data: {}, delta_data: {}, ...d };
      },
      replaceMvuData: (d: any, o?: any) => {
        bag(latest(o)).set(cp(d));
        return emit('mag_variable_update_ended', cp(d), cp(d));
      },
      getMvuVariable: (d: any, p: any, o?: any) => {
        const v = getAt(d && d[((o && o.category) || 'stat') + '_data'], p);
        return v === undefined ? o && o.default_value : v;
      },
      setMvuVariable: (d: any, p: any, v: any, o?: any) => {
        if (!d || typeof d !== 'object') return Promise.resolve(false);
        d.stat_data ??= {};
        const old = getAt(d.stat_data, p);
        setAt(d.stat_data, p, v);
        const s = `${show(old)}->${show(v)}${o && o.reason ? ` (${o.reason})` : ''}`;
        setAt((d.display_data ??= {}), p, s);
        setAt((d.delta_data ??= {}), p, s);
        return Promise.resolve(true);
      },
      // replies are worked out by the tool's simulator outside the card; here the data just stays
      parseMessage: (_m: string, old: any) => Promise.resolve(cp(old)),
      isDuringExtraAnalysis: () => false,
    };

  /* ---------- chat and character ---------- */
  const macros = (s: unknown) =>
    String(s ?? '')
      .replace(/\{\{user\}\}/gi, C.user)
      .replace(/\{\{char\}\}/gi, C.char)
      .replace(/\{\{lastMessageId\}\}/gi, String(LAST))
      .replace(/\{\{newline\}\}/gi, '\n')
      .replace(/\{\{trim\}\}/gi, '');
  const message = (i: number) => {
    const mine = i === MID;
    const text = CHAT ? CHAT[i]?.raw ?? '' : mine ? C.raw : '';
    const ai = CHAT ? CHAT[i]?.ai ?? true : mine ? C.ai : true;
    return { message_id: i, name: ai ? C.char : C.user, role: ai ? 'assistant' : 'user', is_hidden: false, message: text, data: cp(MSG[i] ?? {}), extra: {}, swipe_id: 0, swipes: [text], swipes_data: [cp(MSG[i] ?? {})] };
  };
  const range = (r: any): [number, number] => {
    if (r === undefined || r === null) return [0, LAST];
    if (typeof r === 'number') return [msgId(r), msgId(r)];
    const m = macros(r).match(/^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/);
    if (!m) return [0, LAST];
    const a = msgId(Number(m[1]));
    return [a, m[2] === undefined ? a : msgId(Number(m[2]))];
  };
  const card = { name: C.char, avatar: '', description: '', personality: '', scenario: '', first_mes: '', ...(C.card ?? {}) };
  const ctx: any = {
    name1: C.user,
    name2: C.char,
    characterId: '0',
    this_chid: '0',
    groupId: null,
    chatId: 'preview',
    get chat() {
      return Array.from({ length: LAST + 1 }, (_x, i) => {
        const m = message(i);
        return { name: m.name, is_user: m.role === 'user', is_system: false, mes: m.message, swipe_id: 0, swipes: m.swipes, variables: m.swipes_data, extra: {} };
      });
    },
    characters: [{ ...card, data: { ...card, extensions: {} } }],
    chatMetadata: { get variables() { return STORE.chat; } },
    extensionSettings: {},
    substituteParams: macros,
    substituteParamsExtended: macros,
    getContext: () => ctx,
    eventSource: { on: w.eventOn, once: w.eventOnce, makeFirst: w.eventMakeFirst, makeLast: w.eventMakeLast, emit, removeListener: off },
    eventTypes: names,
    event_types: names,
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveSettingsDebounced: () => {},
    saveChat: () => Promise.resolve(),
    saveMetadata: () => Promise.resolve(),
    getCurrentChatId: () => 'preview',
    registerMacro: () => {},
    unregisterMacro: () => {},
  };
  w.SillyTavern = ctx;
  const toast = (kind: string) => (msg: unknown, title?: unknown) => {
    post({ __stp: 'toast', kind, msg: (title ? String(title) + '：' : '') + String(msg ?? '') });
    return { remove() {} };
  };
  const nothing = () => Promise.resolve(null);
  Object.assign(w, {
    toastr: { success: toast('success'), info: toast('info'), warning: toast('warning'), error: toast('error'), clear() {}, remove() {}, options: {} },
    getCurrentMessageId: () => MID,
    getLastMessageId: () => LAST,
    getMessageId: (name: string) => Number(String(name).match(/--(\d+)--/)?.[1] ?? MID),
    getIframeName: () => `TH-message--${MID}--0`,
    getScriptId: () => '',
    getChatMessages: (r?: any) => {
      const [a, b] = range(r);
      const out = [];
      for (let i = Math.max(0, a); i <= Math.min(LAST, b); i++) out.push(message(i));
      return out;
    },
    getCharData: () => cp(ctx.characters[0]),
    getCharAvatarPath: () => '',
    getCurrentCharacterName: () => C.char,
    substitudeMacros: macros,
    substituteMacros: macros,
    formatAsDisplayedMessage: (t: string) => t,
    errorCatched:
      (f: (...a: any[]) => any) =>
      (...a: any[]) => {
        try {
          const r = f(...a);
          if (r && typeof r.catch === 'function') r.catch((e: any) => report(e && e.message ? e.message : e));
          return r;
        } catch (e: any) {
          report(e && e.message ? e.message : e);
        }
      },
    waitGlobalInitialized: () => Promise.resolve(),
    // the version whose page setup render.ts copies
    getTavernHelperVersion: () => '4.12.0',
    getTavernVersion: () => '1.13.5',
    triggerSlash: (c: unknown) => (post({ __stp: 'slash', cmd: String(c) }), Promise.resolve('')),
    triggerSlashWithResult: (c: unknown) => (post({ __stp: 'slash', cmd: String(c) }), Promise.resolve('')),
    getCharLorebooks: () => Promise.resolve({ primary: null, additional: [] }),
    getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    getCurrentCharPrimaryLorebook: nothing,
    getChatLorebook: nothing,
    getLorebookEntries: () => Promise.resolve([]),
    getWorldbook: () => Promise.resolve([]),
  });
  // these change the real chat, which the preview doesn't have
  ['setChatMessage', 'setChatMessages', 'createChatMessages', 'deleteChatMessages', 'rotateChatMessages', 'refreshOneMessage', 'reloadIframe'].forEach((n) => (w[n] = () => Promise.resolve()));

  /* ---------- tell the tool what went wrong, in words a card author understands ---------- */
  const why = (m: string) => {
    const missing = m.match(/^(?:Uncaught )?ReferenceError: (\S+) is not defined/) ?? m.match(/^(\S+) is not defined/);
    return missing ? `${m}（预览里没有模拟酒馆的「${missing[1]}」，这张卡在酒馆里可能用得到它）` : m;
  };
  addEventListener('error', (e: ErrorEvent) => report(why(e.message) + (e.lineno ? `（第 ${e.lineno} 行）` : '')));
  // scripts and style sheets that couldn't load (those errors don't reach window)
  addEventListener(
    'error',
    (e: Event) => {
      const t = e.target as any;
      if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) report(`没能载入 ${t.src || t.href}（网络不通或地址失效）`);
    },
    true,
  );
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => report('Promise: ' + why(String((e.reason && e.reason.message) || e.reason))));
  // cards often catch their own errors and only log them
  const ce = console.error.bind(console);
  console.error = (...a: any[]) => {
    ce(...a);
    report(a.map((x) => (x instanceof Error ? x.message : typeof x === 'object' ? (() => { try { return JSON.stringify(x).slice(0, 200); } catch { return String(x); } })() : String(x))).join(' '));
  };

  // TavernHelper sets these for Vue (pinia 4 needs the first one)
  Object.assign(w, { __VUE_PROD_DEVTOOLS__: true, __VUE_OPTIONS_API__: true, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false });

  /*
   * ---------- size: the chat page sets the frame's height from this ----------
   * Exactly when TavernHelper measures (adjust_iframe_height.js): body.scrollHeight once the page is ready, then again
   * only when the body changes size, each time on the next frame. So, like in SillyTavern, a frame measured while
   * something was sticking out (an entrance animation still moving) keeps that height until the body resizes.
   */
  let scheduled = false;
  let posted = 0;
  const measure = () => {
    scheduled = false;
    const h = document.body?.scrollHeight ?? 0;
    if (Number.isFinite(h) && h > 0) post({ __stp: 'h', h: (posted = h) });
  };
  const later = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  };
  document.addEventListener('DOMContentLoaded', () => {
    later();
    try {
      new ResizeObserver(later).observe(document.body);
    } catch {}
  });
  // A card scrolled out of sight (an older message in the whole chat) gets no frames and no resize callbacks here (the
  // preview's frames are sandboxed; TavernHelper's aren't): while that lasts, the size is checked on a timer instead,
  // and measured when the body or what is in it changed size. (A timer can miss a short change, like the status bar's
  // 1px nudge to be measured again, so the content's height counts too.)
  // (one frame asked for each time, not every frame: that would change when the frame measures while it is in sight)
  let lastFrame = performance.now();
  let size = '';
  setInterval(() => {
    requestAnimationFrame(() => (lastFrame = performance.now()));
    if (performance.now() - lastFrame < 1200 || !document.body) return;
    const r = document.body.getBoundingClientRect();
    const k = `${r.width}x${r.height}`;
    if (k === size && document.body.scrollHeight === posted) return;
    size = k;
    measure();
  }, 500);
}
