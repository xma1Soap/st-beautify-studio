// Builds the chat-message page shown in the preview frame.
import type { Settings } from './types';
import { formatMessage } from './stformat';
import { fillVarMacros } from './thmacros';
import { frameLibsNow } from './frameLibs';
import { AFTER_LIBS, runtimeScript } from './thRuntime';

const JQ = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js';
const LODASH = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js';

export const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/* same test TavernHelper uses to decide a code block is a front-end card */
const isFrontend = (s: string) => ['html>', '<head>', '<body'].some((t) => s.includes(t));

/** Like TavernHelper: code blocks that hold a whole HTML page are taken out and shown as cards. */
function takeCards(html: string): { html: string; cards: string[] } {
  const t = document.createElement('template');
  t.innerHTML = html;
  const cards: string[] = [];
  t.content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code')?.textContent ?? '';
    if (!isFrontend(code)) return;
    const ph = document.createElement('stbs-card');
    ph.setAttribute('n', String(cards.length));
    cards.push(code);
    pre.replaceWith(ph);
  });
  return { html: t.innerHTML, cards };
}

/** A script's text made safe to sit inside <script>…</script>. */
export const inlineJs = (js: string) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/** What the card frames get besides the message: MVU variables and the card's own data. */
export interface ChatOpts {
  /** MVU variables the stand-in TavernHelper hands to front-end cards (MVU card preview) */
  stat?: unknown;
  /** the previous message's variables (the message then counts as the second one) */
  prev?: unknown;
  /** the card's own TavernHelper variables */
  charVars?: Record<string, unknown>;
  /** card fields, for getCharData */
  card?: Record<string, string>;
}

/**
 * Like TavernHelper (replaceVhInContent): only `min-height` in vh is switched to the chat's height, so a card
 * that fills "100vh" doesn't grow with its own frame forever. Other vh values stay as they are.
 */
export function replaceMinHeightVh(content: string): string {
  const toVar = (v: string) =>
    v.replace(/(\d+(?:\.\d+)?)vh\b/gi, (m, n) => {
      const x = parseFloat(n);
      if (!isFinite(x)) return m;
      return x === 100 ? 'var(--TH-viewport-height)' : `calc(var(--TH-viewport-height) * ${x / 100})`;
    });
  if (!/min-height\s*:\s*[^;{}]*\d+(?:\.\d+)?vh/i.test(content) && !/\.style\.minHeight\s*=|setProperty\s*\(\s*(["'])min-height\1/i.test(content)) return content;
  return content
    .replace(/(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/gi, (_m, p: string, v: string) => p + toVar(v))
    .replace(/(style\s*=\s*(["']))([^"']*?)(\2)/gi, (m, p: string, _q: string, css: string, end: string) =>
      /min-height\s*:\s*[^;]*vh/i.test(css) ? p + css.replace(/(min-height\s*:\s*)([^;]*?\d+(?:\.\d+)?vh)/gi, (_x, a: string, b: string) => a + toVar(b)) + end : m,
    )
    .replace(/(\.style\.minHeight\s*=\s*(["']))([\s\S]*?)(\2)/gi, (m, p: string, _q: string, v: string, end: string) => (/\b\d+(?:\.\d+)?vh\b/i.test(v) ? p + toVar(v) + end : m))
    .replace(/(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?)(\3\s*\))/gi, (m, p: string, _a: string, _b: string, v: string, end: string) =>
      /\b\d+(?:\.\d+)?vh\b/i.test(v) ? p + toVar(v) + end : m,
    );
}

/** What TavernHelper 4.x loads into every message card from jsDelivr (its own jQuery is replaced by our bundled one). */
const TH_CDN = 'https://testingcf.jsdelivr.net';
const THIRD_PARTY_TOP = `<link rel="stylesheet" href="${TH_CDN}/npm/@fortawesome/fontawesome-free/css/all.min.css" />
<script src="${TH_CDN}/gh/N0VI028/JS-Slash-Runner@4.12.0/lib/tailwindcss.min.js"><\/script>`;
const THIRD_PARTY_REST = `<script src="${TH_CDN}/npm/jquery-ui/dist/jquery-ui.min.js"><\/script>
<link rel="stylesheet" href="${TH_CDN}/npm/jquery-ui/themes/base/theme.min.css" />
<script src="${TH_CDN}/npm/jquery-ui-touch-punch"><\/script>
<script src="${TH_CDN}/npm/vue/dist/vue.runtime.global.prod.min.js"><\/script>
<script src="${TH_CDN}/npm/vue-router/dist/vue-router.global.prod.min.js"><\/script>`;

/** A front-end card's page, put together the way TavernHelper does it: its page around, the card inside <body>. */
function buildCard(code: string, raw: string, s: Settings, vh: number, o: ChatOpts): string {
  const rt = runtimeScript({ raw, user: s.user, char: s.char, ai: s.role === 2, vh, stat: o.stat, prev: o.prev, charVars: o.charVars, card: o.card });
  // the libraries go in as text once loaded (works offline); before that, from the CDN
  const libs = frameLibsNow();
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}
</style>
<script>${inlineJs(rt)}<\/script>
${THIRD_PARTY_TOP}
${libs ? `<script>${inlineJs(libs)}<\/script>` : `<script src="${JQ}"><\/script><script src="${LODASH}"><\/script>`}
${THIRD_PARTY_REST}
<script>${AFTER_LIBS}<\/script>
</head>
<body>
${replaceMinHeightVh(code)}
</body>
</html>
`;
}

/* SillyTavern's default theme colors and its rules for message text (public/style.css) */
const ST_THEME = {
  dark: { body: 'rgb(220, 220, 210)', em: 'rgb(145, 145, 145)', underline: 'rgb(188, 231, 207)', quote: 'rgb(225, 138, 36)', tint: 'rgba(23, 23, 23, 1)', border: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.5)', page: '#1a1a1e', mes: 'rgba(255,255,255,.035)', mesLine: '#2c2c33', code: '#111114' },
  light: { body: 'rgb(38, 38, 38)', em: 'rgb(110, 110, 110)', underline: 'rgb(40, 130, 90)', quote: 'rgb(184, 94, 18)', tint: 'rgba(240, 237, 230, 1)', border: 'rgba(0, 0, 0, 0.2)', shadow: 'rgba(0, 0, 0, 0.15)', page: '#e9e6e0', mes: 'rgba(255,255,255,.75)', mesLine: '#d8d4cc', code: '#f3f1ec' },
};

export interface ChatPage { html: string; blocked: string[] }

export function buildChat(display: string, raw: string, s: Settings, vh: number, o: ChatOpts = {}): ChatPage {
  const ai = s.role === 2;
  const name = ai ? s.char : s.user;
  const f = formatMessage(display, { charName: s.char, isUser: !ai, blockExternalMedia: s.blockExternalMedia });
  // like TavernHelper: variable macros in the shown message are filled in after formatting
  let inner = o.stat === undefined ? f.html : fillVarMacros(f.html, { stat_data: o.stat });
  if (s.frontend) {
    const c = takeCards(inner);
    inner = c.html.replace(/<stbs-card n="(\d+)"><\/stbs-card>/g, (_, n) =>
      `<iframe class="th" style="height:80px" srcdoc="${escAttr(buildCard(c.cards[+n], raw, s, vh, o))}"></iframe>`);
  }
  const t = ST_THEME[s.chatTheme];
  const phone = s.device === 'phone';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--SmartThemeBodyColor:${t.body};--SmartThemeEmColor:${t.em};--SmartThemeUnderlineColor:${t.underline};--SmartThemeQuoteColor:${t.quote};--SmartThemeBlurTintColor:${t.tint};--SmartThemeChatTintColor:${t.tint};--SmartThemeBorderColor:${t.border};--SmartThemeShadowColor:${t.shadow};--black30a:rgba(0,0,0,.3);--fontScale:1;--mainFontSize:calc(var(--fontScale) * 15px)}
html,body{margin:0}
body{background:${t.page};color:var(--SmartThemeBodyColor);font-family:"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;font-size:var(--mainFontSize);padding:${phone ? '8px 6px' : '14px'}}
.mes{display:flex;gap:${phone ? 8 : 12}px;padding:${phone ? '10px 8px' : '12px 14px'};border-radius:10px;background:${t.mes};border:1px solid ${t.mesLine}}
.avatar{flex:none;width:${phone ? 34 : 46}px;height:${phone ? 34 : 46}px;border-radius:50%;background:${ai ? '#6b4fe0' : '#3a8f6a'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${phone ? 14 : 18}px}
.main{flex:1;min-width:0}
.name{font-weight:700;margin-bottom:4px}
.mes_text{font-weight:500;line-height:calc(var(--mainFontSize) + .5rem);max-width:100%;overflow-wrap:anywhere;padding:5px 0}
.mes_text p{margin-top:0;margin-bottom:10px}
.mes_text p:last-child{margin-bottom:0}
.mes_text ol,.mes_text ul{margin-top:5px;margin-bottom:5px}
.mes_text table{border-spacing:0;border-collapse:collapse;margin-bottom:10px}
.mes_text td,.mes_text th{border:1px solid;border-collapse:collapse;padding:.25em}
.mes_text i,.mes_text em{color:var(--SmartThemeEmColor)}
.mes_text q i,.mes_text q em{color:inherit}
.mes_text u{color:var(--SmartThemeUnderlineColor)}
.mes_text q{color:var(--SmartThemeQuoteColor)}
.mes_text font[color] em,.mes_text font[color] i,.mes_text font[color] u,.mes_text font[color] q{color:inherit}
.mes_text blockquote{border-left:3px solid var(--SmartThemeQuoteColor);padding-left:10px;background-color:var(--black30a);margin:0}
.mes_text strong em,.mes_text strong,.mes_text h2,.mes_text h1{font-weight:bold}
.mes_text pre{background:${t.code};border-radius:6px;white-space:pre-wrap;word-break:break-all;font-size:12.5px}
.mes_text pre code{position:relative;display:block;overflow-x:auto;padding:1em}
.mes_text img{max-width:100%}
.mes_text hr{opacity:.4}
iframe.th{display:block;width:100%;border:0;margin:6px 0}
</style></head><body><div class="mes"><div class="avatar">${escHtml((name || '?').slice(0, 1))}</div>
<div class="main"><div class="name">${escHtml(name)}</div><div class="mes_text">${inner}</div></div></div>
<script>
addEventListener('message',function(e){var d=e.data;if(!d||!d.__stp)return;
if(d.__stp==='h'){var fs=document.querySelectorAll('iframe.th');for(var i=0;i<fs.length;i++){if(fs[i].contentWindow===e.source){fs[i].style.height=d.h+'px';break}}}
else if(d.__stp==='err'||d.__stp==='slash'||d.__stp==='stat'||d.__stp==='toast'){parent.postMessage(d,'*')}});
addEventListener('error',function(e){parent.postMessage({__stp:'err',msg:'消息区：'+e.message},'*')});
<\/script></body></html>`;
  return { html, blocked: f.blocked };
}

export function emptyPage(msg: string, s: Settings): string {
  return `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui,'Microsoft YaHei';color:#888;background:${s.chatTheme === 'dark' ? '#1a1a1e' : '#e9e6e0'};text-align:center;padding:20px;box-sizing:border-box">${escHtml(msg)}</body>`;
}
