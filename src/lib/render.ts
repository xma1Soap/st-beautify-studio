// Builds the chat-message page shown in the preview frame.
import type { Settings } from './types';
import { formatMessage } from './stformat';

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

const jsStr = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Runs first inside every card: viewport height, TavernHelper stand-ins, error + height reporting. */
function cardRuntime(raw: string, s: Settings, vh: number, statData?: unknown): string {
  return `(function(){
document.documentElement.style.setProperty('--TH-viewport-height', ${vh} + 'px');
var RAW=${jsStr(raw)},USER=${jsStr(s.user)},CHAR=${jsStr(s.char)},AI=${s.role === 2},STAT=${statData === undefined ? 'undefined' : jsStr(statData)};
window.getCurrentMessageId=window.getLastMessageId=function(){return 0};
window.getChatMessages=function(){return [{message_id:0,name:AI?CHAR:USER,role:AI?'assistant':'user',is_hidden:false,message:RAW,data:{},extra:{},swipe_id:0,swipes:[RAW]}]};
var ON={};function emit(n){var a=[].slice.call(arguments,1);(ON[n]||[]).forEach(function(f){try{f.apply(null,a)}catch(e){report(e.message)}});return Promise.resolve()}
function cp(o){return o===undefined?o:JSON.parse(JSON.stringify(o))}
function setStat(d){STAT=cp(d);parent.postMessage({__stp:'stat'},'*');emit('mag_variable_update_ended',{stat_data:STAT})}
window.getVariables=function(o){return STAT!==undefined&&(!o||o.type==='message')?{stat_data:cp(STAT)}:{}};
window.replaceVariables=function(v,o){if(STAT!==undefined&&(!o||o.type==='message'))setStat(v&&v.stat_data);return Promise.resolve()};
window.updateVariablesWith=function(f,o){var v=window.getVariables(o);var r=f(v)||v;return window.replaceVariables(r,o).then(function(){return r})};
if(STAT!==undefined)window.Mvu={events:{VARIABLE_INITIALIZED:'mag_variable_initialized',VARIABLE_UPDATE_STARTED:'mag_variable_update_started',VARIABLE_UPDATE_ENDED:'mag_variable_update_ended'},getMvuData:function(){return {stat_data:cp(STAT)}},replaceMvuData:function(d){setStat(d&&d.stat_data);return Promise.resolve()}};
window.triggerSlash=window.triggerSlashWithResult=function(c){parent.postMessage({__stp:'slash',cmd:String(c)},'*');return Promise.resolve('')};
['setChatMessage','setChatMessages','createChatMessages','deleteChatMessages','insertOrAssignVariables','insertVariables','deleteVariable'].forEach(function(n){window[n]=function(){return Promise.resolve()}});
['eventOn','eventMakeFirst','eventMakeLast','eventOnce'].forEach(function(n){window[n]=function(e,f){(ON[e]=ON[e]||[]).push(f);return {stop:function(){ON[e]=(ON[e]||[]).filter(function(x){return x!==f})}}}});
['eventOnButton','eventRemoveListener','eventClearEvent','eventClearListener','eventClearAll'].forEach(function(n){window[n]=function(){return {stop:function(){}}}});
window.eventEmit=emit;
window.waitGlobalInitialized=function(){return Promise.resolve()};
window.tavern_events=window.iframe_events=new Proxy({},{get:function(t,k){return String(k)}});
window.SillyTavern=window.SillyTavern||{name1:USER,name2:CHAR,chat:[],getContext:function(){return this}};
function report(m){parent.postMessage({__stp:'err',msg:String(m)},'*')}
addEventListener('error',function(e){report(e.message+(e.lineno?' (第 '+e.lineno+' 行)':''))});
addEventListener('unhandledrejection',function(e){report('Promise: '+((e.reason&&e.reason.message)||e.reason))});
function size(){var b=document.body;if(!b)return;var cs=getComputedStyle(b);
var h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height)+parseFloat(cs.marginTop||0)+parseFloat(cs.marginBottom||0));
parent.postMessage({__stp:'h',h:h},'*')}
document.addEventListener('DOMContentLoaded',function(){size();try{new ResizeObserver(size).observe(document.body)}catch(e){}});
addEventListener('load',size);setInterval(size,700);
})();`;
}

function buildCard(code: string, raw: string, s: Settings, vh: number, statData?: unknown): string {
  // TavernHelper swaps vh for the chat viewport height so cards don't grow forever
  const doc = code.replace(/(\d+(?:\.\d+)?)vh\b/g, (_, n) => `calc(var(--TH-viewport-height) * ${n} / 100)`);
  const inject = `<script>${cardRuntime(raw, s, vh, statData)}<\/script><script src="${JQ}"><\/script><script src="${LODASH}"><\/script>`;
  const m = doc.match(/<head\b[^>]*>/i) || doc.match(/<html\b[^>]*>/i) || doc.match(/^\s*<!doctype[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return doc.slice(0, at) + inject + doc.slice(at);
  }
  return inject + doc;
}

/* SillyTavern's default theme colors and its rules for message text (public/style.css) */
const ST_THEME = {
  dark: { body: 'rgb(220, 220, 210)', em: 'rgb(145, 145, 145)', underline: 'rgb(188, 231, 207)', quote: 'rgb(225, 138, 36)', tint: 'rgba(23, 23, 23, 1)', border: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.5)', page: '#1a1a1e', mes: 'rgba(255,255,255,.035)', mesLine: '#2c2c33', code: '#111114' },
  light: { body: 'rgb(38, 38, 38)', em: 'rgb(110, 110, 110)', underline: 'rgb(40, 130, 90)', quote: 'rgb(184, 94, 18)', tint: 'rgba(240, 237, 230, 1)', border: 'rgba(0, 0, 0, 0.2)', shadow: 'rgba(0, 0, 0, 0.15)', page: '#e9e6e0', mes: 'rgba(255,255,255,.75)', mesLine: '#d8d4cc', code: '#f3f1ec' },
};

export interface ChatPage { html: string; blocked: string[] }

/** `statData`: MVU variables the stand-in TavernHelper hands to front-end cards (MVU card preview). */
export function buildChat(display: string, raw: string, s: Settings, vh: number, statData?: unknown): ChatPage {
  const ai = s.role === 2;
  const name = ai ? s.char : s.user;
  const f = formatMessage(display, { charName: s.char, isUser: !ai, blockExternalMedia: s.blockExternalMedia });
  let inner = f.html;
  if (s.frontend) {
    const c = takeCards(inner);
    inner = c.html.replace(/<stbs-card n="(\d+)"><\/stbs-card>/g, (_, n) =>
      `<iframe class="th" style="height:80px" srcdoc="${escAttr(buildCard(c.cards[+n], raw, s, vh, statData))}"></iframe>`);
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
else if(d.__stp==='err'||d.__stp==='slash'||d.__stp==='stat'){parent.postMessage(d,'*')}});
addEventListener('error',function(e){parent.postMessage({__stp:'err',msg:'消息区：'+e.message},'*')});
<\/script></body></html>`;
  return { html, blocked: f.blocked };
}

export function emptyPage(msg: string, s: Settings): string {
  return `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui,'Microsoft YaHei';color:#888;background:${s.chatTheme === 'dark' ? '#1a1a1e' : '#e9e6e0'};text-align:center;padding:20px;box-sizing:border-box">${escHtml(msg)}</body>`;
}
