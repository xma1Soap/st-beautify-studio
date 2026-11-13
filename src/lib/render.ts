// Builds the chat-message page shown in the preview frame.
import type { Settings } from './types';
import { formatMessage } from './stformat';
import { CODE_CSS, decorateCode } from './codeBlocks';
import { stFontCss } from './stFonts';
import { fillVarMacros } from './thmacros';
import { frameLibsNow } from './frameLibs';
import { AFTER_LIBS, runtimeScript, type ChatEntry, type RuntimeCtx } from './thRuntime';
import { isLightLook, lookOf, type Look } from './stThemes';

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
  /** 点选修改 is on: elements numbered data-stbs-e can be clicked and dragged (the number = the one picked, -1 none) */
  pick?: number;
  /** the character's avatar (an image URL); without it a letter in a circle */
  avatar?: string;
  /** open the chat at its end, and stay there while cards grow (like SillyTavern); otherwise at its top */
  bottom?: boolean;
  /** one message (buildChat): its number in the chat, and that it is the greeting (not generated: no timer, no model icon) */
  id?: number;
  greeting?: boolean;
  /**
   * The browser window the chat sits in and where the chat is in it (px), for the background picture, which covers the
   * whole window. Missing: worked out from the frame (the chat column of a window with SillyTavern's bars around it).
   */
  win?: { w: number; h: number; x: number; y: number };
}

/** One message of a chat page (buildChatPage). */
export interface ChatMes {
  /** the text after the regexes, as shown (formatted here) */
  display: string;
  /** as stored (what front-end cards read) */
  raw: string;
  /** the character's (AI) message; otherwise the user's */
  ai: boolean;
  /** its MVU variables (what its front-end cards read); none = MVU keeps none for it */
  stat?: unknown;
  /** its number in the chat (#3 under the avatar, in themes that show it); missing = its place in the list */
  id?: number;
  /** written by the AI just now (a reply, not the greeting): themes may show how long it took and the model's icon */
  gen?: boolean;
}

/**
 * While 点选修改 is on, in the chat page and in every front-end card: outlines what the pointer is over, tells the
 * editor what was clicked (with how it looks now), and where an element was dragged to among its siblings.
 * A card's frame tells the chat page (its parent); the chat page (relay) passes that on to the editor, and passes
 * the editor's choice down to the cards, so whichever frame holds the element shows it as picked.
 */
export const pickScript = (sel: number, relay: boolean) => `(function(){
var SEL=${Math.round(sel)},RELAY=${relay ? 1 : 0};
function toFrames(d,skip){var f=document.querySelectorAll('iframe.th');for(var i=0;i<f.length;i++){var w=f[i].contentWindow;if(w&&w!==skip)w.postMessage(d,'*')}}
var css=document.createElement('style');css.id='stbs-css';
css.textContent='body{user-select:none;-webkit-user-select:none}[data-stbs-e]{cursor:pointer}[data-stbs-e] img,img[data-stbs-e]{-webkit-user-drag:none}.stbs-hov{outline:1px dashed #8b7cf6!important;outline-offset:1px}.stbs-sel{outline:1px dashed #6b4fe0!important;outline-offset:2px}#stbs-box{position:absolute;pointer-events:none;z-index:2147483646;border:2px solid #6b4fe0;border-radius:3px;box-sizing:border-box;display:none}#stbs-line{position:absolute;pointer-events:none;z-index:2147483647;background:#6b4fe0;display:none;border-radius:2px}';
document.head.appendChild(css);
var line=document.createElement('div');line.id='stbs-line';document.body.appendChild(line);
var box=document.createElement('div');box.id='stbs-box';document.body.appendChild(box);
var cur=null;
// a frame of its own, so a clip-path or overflow:hidden on the element can't hide that it is picked
function place(){if(!box.isConnected&&document.body){document.body.appendChild(box);document.body.appendChild(line)}if(!cur||!cur.isConnected){box.style.display='none';return}var r=cur.getBoundingClientRect();box.style.left=r.left+scrollX-3+'px';box.style.top=r.top+scrollY-3+'px';box.style.width=r.width+6+'px';box.style.height=r.height+6+'px';box.style.display='block'}
setInterval(place,250);
function el(t){return t&&t.closest?t.closest('[data-stbs-e]'):null}
function num(e){return +e.getAttribute('data-stbs-e')}
// the rules of the page's own <style> blocks that apply to it (with how many elements each one styles)
function rules(e){var out=[],seen={};function walk(l,at){for(var i=0;i<l.length;i++){var r=l[i];if(!r.selectorText){if(r.cssRules&&(r.media||r.conditionText!==undefined)){try{walk(r.cssRules,r.conditionText||(r.media&&r.media.mediaText)||'')}catch(x){}}continue}var ok=false;try{ok=e.matches(r.selectorText)}catch(x){}if(!ok||seen[at+'|'+r.selectorText])continue;seen[at+'|'+r.selectorText]=1;var c=0;try{c=document.querySelectorAll(r.selectorText).length}catch(x){}out.push({sel:r.selectorText,count:c,at:at})}}
var sh=document.styleSheets;for(var k=0;k<sh.length;k++){var o=sh[k].ownerNode;if(!o||o.tagName!=='STYLE'||o.id==='stbs-css')continue;try{walk(sh[k].cssRules,'')}catch(x){}}return out}
function info(e){var c=getComputedStyle(e);return{tag:e.tagName.toLowerCase(),text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),color:c.color,bg:c.backgroundColor,bgImage:c.backgroundImage,fontSize:c.fontSize,fontWeight:c.fontWeight,padding:c.padding,margin:c.margin,radius:c.borderRadius,border:c.borderTopWidth+' '+c.borderTopStyle+' '+c.borderTopColor,clip:c.clipPath,rules:rules(e)}}
function mark(n){var o=document.querySelectorAll('.stbs-sel');for(var i=0;i<o.length;i++)o[i].classList.remove('stbs-sel');cur=null;if(n>=0){var l=document.querySelectorAll('[data-stbs-e="'+n+'"]');for(var j=1;j<l.length;j++)l[j].classList.add('stbs-sel');cur=l[0]||null}place();return cur}
function tell(e,again){parent.postMessage({__stp:'pick',n:num(e),info:info(e),again:!!again},'*')}
var hov=null,drag=null;
document.addEventListener('mouseover',function(ev){var e=el(ev.target);if(hov&&hov!==e)hov.classList.remove('stbs-hov');hov=e;if(e)e.classList.add('stbs-hov')});
document.addEventListener('mouseout',function(ev){if(!ev.relatedTarget&&hov){hov.classList.remove('stbs-hov');hov=null}});
document.addEventListener('dragstart',function(ev){ev.preventDefault()},true);
document.addEventListener('click',function(ev){if(ev.altKey)return;ev.preventDefault();ev.stopPropagation();if(drag&&drag.moved)return;var e=el(ev.target),n=e?num(e):-1;mark(n);if(e)tell(e);else parent.postMessage({__stp:'pick',n:-1},'*');if(RELAY)toFrames({__stp:'mark',n:n})},true);
function isRow(e,o){var a=e.getBoundingClientRect(),b=o.getBoundingClientRect();return Math.abs(a.top-b.top)<Math.min(a.height,b.height)/2&&Math.abs(a.left-b.left)>1}
document.addEventListener('pointerdown',function(ev){var e=el(ev.target);if(!e||ev.button!==0||ev.altKey)return;drag={e:e,x:ev.clientX,y:ev.clientY,moved:false,to:null}},true);
document.addEventListener('pointermove',function(ev){if(!drag)return;if(!drag.moved&&Math.abs(ev.clientY-drag.y)+Math.abs(ev.clientX-drag.x)<6)return;drag.moved=true;ev.preventDefault();
var p=drag.e.parentElement,sib=[];if(p){for(var i=0;i<p.children.length;i++){var c=p.children[i];if(c!==drag.e&&c.hasAttribute('data-stbs-e'))sib.push(c)}}
if(!sib.length){line.style.display='none';drag.to=null;return}
var row=isRow(drag.e,sib[0]),v=row?ev.clientX:ev.clientY,best=null;
for(var k=0;k<sib.length;k++){var r=sib[k].getBoundingClientRect(),lo=row?r.left:r.top,hi=row?r.right:r.bottom,after=v>(lo+hi)/2,d=Math.abs(v-(after?hi:lo));if(!best||d<best.d)best={d:d,c:sib[k],after:after,r:r}}
drag.to=best;var q=best.r;
if(row){line.style.left=(best.after?q.right:q.left)-1+scrollX+'px';line.style.top=q.top+scrollY+'px';line.style.width='3px';line.style.height=q.height+'px'}
else{line.style.left=q.left+scrollX+'px';line.style.top=(best.after?q.bottom:q.top)-1+scrollY+'px';line.style.width=q.width+'px';line.style.height='3px'}
line.style.display='block'},true);
document.addEventListener('pointerup',function(){if(!drag)return;var d=drag;line.style.display='none';setTimeout(function(){drag=null},0);if(d.moved&&d.to)parent.postMessage({__stp:'move',n:num(d.e),ref:num(d.to.c),after:d.to.after},'*')},true);
addEventListener('message',function(ev){var d=ev.data;if(!d||typeof d!=='object')return;
if(ev.source===parent){if(d.__stp==='sel'){var e=mark(d.n);if(e)tell(e,true);if(RELAY)toFrames(d)}else if(d.__stp==='mark')mark(d.n);return}
if(!RELAY)return;
// from a card in this page: on to the editor; a click there unpicks what was picked here and in the other cards
if(d.__stp==='pick'||d.__stp==='move'){parent.postMessage(d,'*');if(d.__stp==='pick'&&!d.again){mark(+d.n);toFrames({__stp:'mark',n:d.n},ev.source)}}});
if(SEL>=0){var e0=mark(SEL);if(e0)tell(e0,true)}
})();`;

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

/**
 * A front-end card's page, put together the way TavernHelper does it: its page around, the card inside <body>.
 * `where`: the message it is in (its text, whose it is, its variables, or the whole chat and its place in it).
 */
function buildCard(code: string, where: Pick<RuntimeCtx, 'raw' | 'ai' | 'stat' | 'prev' | 'chat' | 'id'>, s: Settings, vh: number, o: ChatOpts): string {
  const rt = runtimeScript({ ...where, user: s.user, char: s.char, vh, charVars: o.charVars, card: o.card });
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
.user_avatar,.user-avatar{background-image:url('${USER_AVATAR}')}
.char_avatar,.char-avatar{background-image:url('${(o.avatar ?? letterAvatar(s.char)).replace(/'/g, '%27')}')}
</style>
<script>${inlineJs(rt)}<\/script>
${THIRD_PARTY_TOP}
${libs ? `<script>${inlineJs(libs)}<\/script>` : `<script src="${JQ}"><\/script><script src="${LODASH}"><\/script>`}
${THIRD_PARTY_REST}
<script>${AFTER_LIBS}<\/script>
</head>
<body>
${replaceMinHeightVh(code)}
${o.pick !== undefined ? `<script>${pickScript(o.pick, false)}<\/script>` : ''}
</body>
</html>
`;
}

/*
 * SillyTavern's default look ("Dark Lite", flat messages), measured in SillyTavern 1.19 (e2e/tavern): the message is
 * 10px in from the chat's edges, a 50px round avatar, 10px gap, then the text with 30px kept free on its right (for
 * the swipe arrows). On a computer the chat is half the window wide and always has its 0.7rem scrollbar (11px in
 * Chrome on Windows; it takes room there); on a phone the whole width, with a 1px border (a phone's scrollbar floats
 * over the chat and takes no room, so it isn't drawn). The name row is at least 22px high; on a phone its message
 * buttons (always shown there, 1.2× the font) make it 22.36px. The text is SillyTavern's own Noto Sans (stFonts.ts).
 * Other themes and message styles (bubbles, document) and the font scale: lib/stThemes.ts, measured the same way.
 */
/** A plain round avatar with the first letter of the name (SVG, so it works in any frame). */
function letterAvatar(name: string): string {
  const letter = escHtml((name || '?').slice(0, 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#6b4fe0"/><text x="50" y="66" font-size="46" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
const USER_AVATAR =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#3a8f6a"/><circle cx="50" cy="40" r="18" fill="#fff"/><rect x="22" y="64" width="56" height="30" rx="15" fill="#fff"/></svg>');

/**
 * SillyTavern's message buttons row (… and ✎ in its icon font) at a font size: [font px, row height] measured in 1.19;
 * the icon font rounds its line boxes, so the height is looked up (in between: drawn straight from the nearest two).
 * Width: … is .875em + 6, ✎ 1em + 6, 4 apart, 1px around.
 */
const BUTTON_ROW: [number, number][] = [
  [12, 16.23], [13.5, 17.52], [14.4, 18.69], [15, 19.8], [16.2, 21.02], [16.5, 21.08], [18, 22.36], [19.5, 23.64],
  [19.8, 24.69], [21.6, 26.03], [22.5, 27.2], [23.4, 28.38], [27, 32.03],
];
export function buttonRow(fs: number): { fs: number; h: number } {
  const f = Math.round(fs * 100) / 100;
  const at = BUTTON_ROW.findIndex(([x]) => x >= f);
  let h: number;
  if (at === 0) h = BUTTON_ROW[0][1] - (BUTTON_ROW[0][0] - f) * 1.02;
  else if (at < 0) h = BUTTON_ROW[BUTTON_ROW.length - 1][1] + (f - BUTTON_ROW[BUTTON_ROW.length - 1][0]) * 1.02;
  else {
    const [x0, y0] = BUTTON_ROW[at - 1];
    const [x1, y1] = BUTTON_ROW[at];
    h = x1 === f ? y1 : y0 + ((y1 - y0) * (f - x0)) / (x1 - x0);
  }
  return { fs: f, h: Math.round(h * 100) / 100 };
}

/*
 * The chat's background (measured in SillyTavern 1.19): the picture covers the whole window behind everything; the
 * chat column, 35px below the top bar and above the 40.5px (computer) / 73px (phone) input box, lays its tint over it
 * and blurs what is behind it (none in fast UI mode). "Classic" fitting covers the window from its top left corner; on
 * a phone every fitting is centered.
 */
const BAR_TOP = 35;
const BAR_BOTTOM = { desktop: 40.5, phone: 73 };
function bgCss(l: Look, phone: boolean, win?: ChatOpts['win']): string {
  const out: string[] = [];
  if (l.blur) out.push(`#chat{backdrop-filter:blur(${l.blur}px)}`);
  if (!l.bg) return out.join('\n');
  const fit = l.bg.fit;
  const size = fit === 'contain' ? 'contain' : fit === 'stretch' ? '100% 100%' : fit === 'center' ? 'auto' : 'cover';
  const pos = phone || fit !== 'classic' ? 'center' : '0% 0%';
  // the window: given, or the frame (the chat) with the bars around it (on a computer the chat is a centred column)
  const box = win
    ? `left:${-win.x}px;top:${-win.y}px;width:${win.w}px;height:${win.h}px`
    : phone
      ? `left:0;top:-${BAR_TOP}px;width:100vw;height:calc(100vh + ${BAR_TOP + BAR_BOTTOM.phone}px)`
      : `left:calc((100vw - 100vw * var(--winScale)) / 2);top:-${BAR_TOP}px;width:calc(100vw * var(--winScale));height:calc(100vh + ${BAR_TOP + BAR_BOTTOM.desktop}px)`;
  out.push(
    `#bg1{position:fixed;z-index:-1;${box};--winScale:${100 / l.theme.chatWidth};background-image:url("${l.bg.src.replace(/["\\\n]/g, (c) => encodeURIComponent(c))}");background-repeat:no-repeat;background-size:${size};background-position:${pos}}`,
  );
  return out.join('\n');
}

/** What a theme's message style and avatar shape change (SillyTavern's toggle-dependent.css, measured in 1.19). */
function lookCss(l: Look): string {
  const out: string[] = [];
  if (l.chatStyle === 1)
    out.push(
      '.mes{padding:10px;border-radius:10px;background-color:var(--SmartThemeBotMesBlurTintColor);margin-bottom:5px;border:1px solid var(--SmartThemeBorderColor)}',
      '.mes[is_user="true"]{background-color:var(--SmartThemeUserMesBlurTintColor)}',
    );
  if (l.chatStyle === 2)
    out.push(
      '.last_mes{padding-top:0}',
      '.mes .mes_text{padding:0;margin-left:20px}',
      '.mes .mes_block{margin-right:30px}',
      '.last_mes .mes_text{min-height:70px}',
      '.mes .mesAvatarWrapper,.mes .ch_name .name_text,.mes .ch_name .timestamp{display:none!important}',
      '.mes .ch_name{min-height:unset}',
    );
  if (l.avatarStyle === 1) out.push('.avatar{width:calc(var(--avatar-base-width) * 1.2);height:calc(var(--avatar-base-height) * 1.8);border-radius:10px}');
  if (l.avatarStyle === 2) out.push('.avatar,.avatar img{border-radius:2px!important}');
  if (l.avatarStyle === 3) out.push('.avatar,.avatar img{border-radius:10px!important}');
  return out.join('\n');
}

/**
 * The message buttons a theme with expand_message_actions shows beside the name instead of …: their icons' widths in
 * em (each 6px wider, 4 apart, in a 1px-padded row of their own), measured in SillyTavern 1.19 with its default
 * extensions (translate, image, voice, hide, vectors, checkpoint, branch, copy); drawn here as plain marks.
 */
const EXTRA_BUTTONS: [number, string][] = [[1.25, '译'], [1.125, '✦'], [1, '♪'], [1.125, '◌'], [0.875, '⧉'], [0.875, '☆'], [0.875, '⑂'], [0.875, '⎘']];
/** How long a reply took (themes with timer_enabled): a stand-in, it is as wide and tall as SillyTavern's. */
const TIMER = '3.2s';
/** The model's icon after a reply's time (timestamp_model_icon): 14px, a plain mark of our own. */
const MODEL_ICON = '<svg class="mi" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>';

/** A message's time as SillyTavern shows it in Chinese (moment's "LL LT"): 2026年11月13日 23:48. */
export const stTimestamp = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export interface ChatPage { html: string; blocked: string[] }

/** The chat page for one message (`s.role` says whose); `o.stat` / `o.prev` are its variables and the message before's. */
export function buildChat(display: string, raw: string, s: Settings, vh: number, o: ChatOpts = {}): ChatPage {
  const ai = s.role === 2;
  return buildChatPage([{ display, raw, ai, stat: o.stat, id: o.id, gen: ai && !o.greeting }], s, vh, o);
}

/**
 * The chat page for a whole chat, oldest message first; the last one is the newest (SillyTavern's .last_mes). Each
 * front-end card knows the chat and which message it is in; variable macros are filled from the newest message that
 * has variables (like TavernHelper). With one message, `o.prev` stands for the message before it.
 */
export function buildChatPage(list: ChatMes[], s: Settings, vh: number, o: ChatOpts = {}): ChatPage {
  const one = list.length === 1;
  const chat: ChatEntry[] = list.map((m) => ({ raw: m.raw, ai: m.ai, ...(m.stat !== undefined ? { stat: m.stat } : {}) }));
  // like TavernHelper: variable macros in a shown message are filled in after formatting, from the newest variables
  const newest = [...list].reverse().find((m) => m.stat !== undefined)?.stat;
  const look = lookOf(s);
  const t = look.theme;
  const phone = s.device === 'phone';
  // the message buttons (… and ✎) beside the name: always there, 1.2× the font on a phone
  const btn = buttonRow((phone ? 18 : 15) * look.fontScale);
  // the message buttons: … and ✎, or (themes that expand them) all of them, as wide as SillyTavern's icons
  const buttons = t.expandActions
    ? `<div class="mes_buttons x"><div class="extraMesButtons">${EXTRA_BUTTONS.map(([w, c]) => `<div class="mes_button" style="width:calc(${w}em + 6px)">${c}</div>`).join('')}</div><div class="mes_button b2">✎</div></div>`
    : '<div class="mes_buttons"><div class="mes_button b1">…</div><div class="mes_button b2">✎</div></div>';
  const blocked: string[] = [];
  const shown: string[] = [];
  const names = new Set<string>();
  const now = escHtml(stTimestamp(new Date()));
  const mes = list.map((m, i) => {
    const name = m.ai ? s.char : s.user;
    names.add(name);
    const f = formatMessage(m.display, { charName: s.char, isUser: !m.ai, blockExternalMedia: s.blockExternalMedia, fixMarkdown: s.fixMarkdown });
    blocked.push(...f.blocked);
    shown.push(f.html);
    let inner = newest === undefined ? f.html : fillVarMacros(f.html, { stat_data: newest });
    if (s.frontend) {
      const c = takeCards(inner);
      const where = one ? { raw: m.raw, ai: m.ai, stat: m.stat, prev: o.prev } : { raw: m.raw, ai: m.ai, chat, id: i };
      // the other code blocks coloured, with a copy icon; TavernHelper puts each card in a div.TH-render, the frame
      // inline and 100% wide
      inner = decorateCode(c.html).replace(/<stbs-card n="(\d+)"><\/stbs-card>/g, (_, n) =>
        `<div class="TH-render"><iframe class="th w-full" frameborder="0" style="height:80px" srcdoc="${escAttr(buildCard(c.cards[+n], where, s, vh, o))}"></iframe></div>`);
    } else inner = decorateCode(inner);
    const last = i === list.length - 1;
    const avatar = m.ai ? o.avatar ?? letterAvatar(name) : USER_AVATAR;
    const id = m.id ?? i;
    const gen = m.gen ?? (m.ai && i > 0);
    // what some themes add: under the avatar the message's number and how long a reply took; after the time the model's icon
    const under =
      (t.mesId ? `<div class="mesIDDisplay">#${id}</div>` : '') +
      (t.timer && gen ? `<div class="mes_timer">${TIMER}</div>` : '') +
      // a rough count stands in for the tokenizer's (the greeting has none)
      (t.tokenCount && (gen || !m.ai) ? `<div class="tokenCounterDisplay">${Math.max(1, Math.round(m.raw.length / 1.5))}t</div>` : '');
    const icon = t.modelIcon && gen ? MODEL_ICON : '';
    return `<div class="mes${last ? ' last_mes' : ''}" mesid="${id}" is_user="${m.ai ? 'false' : 'true'}"><div class="mesAvatarWrapper"><div class="avatar"><img src="${escAttr(avatar)}" alt=""></div>${under}</div>
<div class="mes_block"><div class="ch_name fc"><div class="fc flex1 aic"><div class="fc aib"><span class="name_text">${escHtml(name)}</span><small class="timestamp">${now}</small>${icon}</div></div>${buttons}</div><div class="mes_text">${inner}</div></div>${m.ai && last ? '<div class="swipe_right">›<small>1/1</small></div>' : ''}</div>`;
  });
  // like SillyTavern in a Chinese browser: the page's language is the UI's (it picks the fonts for Chinese text)
  const html = `<!doctype html><html lang="zh-cn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
${stFontCss(shown.join('\n'), [...names].join(' '))}
:root{color-scheme:light only;--SmartThemeBodyColor:${t.body};--SmartThemeEmColor:${t.em};--SmartThemeUnderlineColor:${t.underline};--SmartThemeQuoteColor:${t.quote};--SmartThemeBlurTintColor:${t.tint};--SmartThemeChatTintColor:${t.chatTint};--SmartThemeUserMesBlurTintColor:${t.userMes};--SmartThemeBotMesBlurTintColor:${t.botMes};--SmartThemeBorderColor:${t.border};--SmartThemeShadowColor:${t.shadow};--shadowWidth:${t.shadowWidth};--black30a:rgba(0,0,0,.3);--black70a:rgba(0,0,0,.7);--white70a:rgba(255,255,255,.7);--fontScale:${look.fontScale};--mainFontSize:calc(var(--fontScale) * 15px);--mainFontFamily:"Noto Sans",sans-serif;--monoFontFamily:'Noto Sans Mono','Courier New',Consolas,monospace;--mes-right-spacing:30px;--avatar-base-width:50px;--avatar-base-height:50px}
*,*::before,*::after{box-sizing:border-box${t.shadowWidth ? ';text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor)' : ''}}
html,body{margin:0;height:100%}
body{background-color:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor);font-family:var(--mainFontFamily);font-size:var(--mainFontSize);overflow:hidden;-webkit-font-smoothing:antialiased}
#chat{height:100%;overflow-x:hidden;overflow-y:${phone ? 'auto' : 'scroll'};padding-bottom:10px;background-color:var(--SmartThemeChatTintColor)}
${phone
    ? '#chat{scrollbar-width:none}'
    : '::-webkit-scrollbar{width:.7rem}\n::-webkit-scrollbar-thumb:vertical{background-color:rgba(175,175,175,.7);box-shadow:inset 0 0 0 1px rgba(0,0,0,.5);border-radius:10px;background-clip:content-box}'}
br{display:block;margin:2px 0}
${phone ? '#chat{border:1px solid var(--SmartThemeBorderColor);border-top:0}' : ''}
.mes{display:flex;align-items:flex-start;padding:10px 10px 0 10px;width:100%;position:relative}
.mesAvatarWrapper{flex:none}
.last_mes .mesAvatarWrapper{padding-bottom:var(--avatar-base-height)}
.last_mes{margin-bottom:0!important}
.avatar{width:var(--avatar-base-width);height:var(--avatar-base-height);border-radius:50%;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover;display:block}
.mes_block{padding-left:10px;width:100%;overflow-x:hidden;overflow-y:clip;min-width:0}
.fc{display:flex;gap:5px;flex-wrap:wrap}
.flex1{flex:1}
.aic{align-items:center}
.aib{align-items:baseline!important}
.ch_name{font-weight:bolder;justify-content:space-between;align-items:flex-start;min-height:22px;max-width:100%}
.mes_buttons{position:relative;display:flex;gap:4px;flex-wrap:nowrap;justify-content:flex-end;overflow:hidden;padding:1px;font-size:${btn.fs}px;height:${btn.h}px}
.mes_button{height:${btn.h - 2}px;padding:1px 3px;opacity:.3;font-weight:900;line-height:${btn.h - 4}px;text-align:center;overflow:hidden}
.mes_button.b1{width:calc(.875em + 6px)}
.mes_button.b2{width:calc(1em + 6px)}
.timestamp{font-size:calc(var(--mainFontSize) * .7);font-weight:400;opacity:.7${t.timestamps ? '' : ';display:none'}}
.mi{display:block;width:14px;height:14px;flex:none;opacity:.6}
.mesIDDisplay,.mes_timer,.tokenCounterDisplay{font-size:calc(var(--mainFontSize) * .9);font-weight:600;opacity:.7;text-align:center}
.mes_buttons.x{height:${btn.h + 2}px}
.extraMesButtons{display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden;padding:1px;height:${btn.h}px}
.mes_buttons.x .b2{height:${btn.h}px}
.mes_text{font-weight:500;line-height:calc(var(--mainFontSize) + .5rem);max-width:100%;overflow-wrap:anywhere;padding:5px var(--mes-right-spacing) 5px 0}
.mes q::before,.mes q::after{content:''}
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
code{font-family:var(--monoFontFamily);white-space:pre-wrap;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;background-color:var(--black70a);padding:0 3px;line-height:var(--mainFontSize);color:var(--white70a)}
.mes_text pre code{position:relative;display:block;overflow-x:auto;padding:1em}
${CODE_CSS}
.mes_text img{max-width:100%}
.mes_text hr{opacity:.4}
.TH-render iframe{width:100%;border:0}
.swipe_right{position:absolute;right:6px;bottom:0;display:flex;flex-direction:column;align-items:center;opacity:.5;font-size:20px;line-height:1}
.swipe_right small{font-size:11px;margin-top:2px}
${lookCss(look)}
${bgCss(look, phone, o.win)}
</style>
<script>
var BOTTOM=${o.bottom ? 1 : 0},stick=BOTTOM;
function chatEl(){return document.getElementById('chat')}
// like SillyTavern: the chat opens at its end, and stays there while the cards in it get their heights (until scrolled)
function toEnd(){var c=chatEl();if(c&&stick)c.scrollTop=c.scrollHeight}
addEventListener('message',function(e){var d=e.data;if(!d||!d.__stp)return;
if(d.__stp==='h'){var fs=document.querySelectorAll('iframe.th');for(var i=0;i<fs.length;i++){if(fs[i].contentWindow===e.source){fs[i].style.height=d.h+'px';break}}toEnd()}
else if(d.__stp==='err'||d.__stp==='slash'||d.__stp==='stat'||d.__stp==='toast'){parent.postMessage(d,'*')}});
addEventListener('error',function(e){parent.postMessage({__stp:'err',msg:'消息区：'+e.message},'*')});
function vh(){var fs=document.querySelectorAll('iframe.th');for(var i=0;i<fs.length;i++){var w=fs[i].contentWindow;if(w)w.postMessage({__stp:'vh',h:innerHeight},'*')}}
addEventListener('load',vh);addEventListener('resize',vh);
if(BOTTOM){addEventListener('DOMContentLoaded',function(){var c=chatEl();toEnd();c.addEventListener('wheel',function(){stick=0},{passive:true});c.addEventListener('touchmove',function(){stick=0},{passive:true});c.addEventListener('keydown',function(){stick=0});c.addEventListener('pointerdown',function(ev){if(ev.offsetX>c.clientWidth)stick=0});c.addEventListener('scroll',function(){if(c.scrollHeight-c.scrollTop-c.clientHeight<2)stick=1})});addEventListener('load',toEnd)}
<\/script></head><body>${look.bg ? '<div id="bg1"></div>' : ''}<div id="chat">${mes.join('\n')}</div>
${o.pick !== undefined ? `<script>${pickScript(o.pick, true)}<\/script>` : ''}</body></html>`;
  return { html, blocked };
}

export function emptyPage(msg: string, s: Settings): string {
  return `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui,'Microsoft YaHei';color:#888;background:${isLightLook(lookOf(s)) ? '#e9e6e0' : '#1a1a1e'};text-align:center;padding:20px;box-sizing:border-box">${escHtml(msg)}</body>`;
}
