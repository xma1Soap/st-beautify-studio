// Builds the chat-message page shown in the preview frame.
import type { Settings } from './types';

const JQ = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js';
const LODASH = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js';

export const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/* same test TavernHelper uses to decide a code block is a front-end card */
const isFrontend = (s: string) => ['html>', '<head>', '<body'].some((t) => s.includes(t));

function inlineMd(ln: string): string {
  return ln
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/“[^”\n]*”/g, (m) => `<q>${m}</q>`);
}

/** Rough stand-in for ST's markdown pass: text lines get <br>, HTML lines pass through. */
function textToHtml(t: string): string {
  t = t.replace(/<script\b[\s\S]*?<\/script>/gi, ''); // ST strips scripts from messages
  const keep: string[] = [];
  t = t.replace(/<(style|pre|textarea)\b[\s\S]*?<\/\1>/gi, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  const lines = t.split('\n');
  let out = '';
  // like showdown, lines inside an open block-level HTML element are left untouched
  const BLOCK = 'div|section|article|aside|header|footer|nav|table|thead|tbody|tr|td|th|ul|ol|li|dl|details|summary|blockquote|figure|form|fieldset|p|h[1-6]';
  const openRe = new RegExp(`<(${BLOCK})\\b[^>]*?(?<!/)>`, 'gi');
  const closeRe = new RegExp(`</(${BLOCK})\\s*>`, 'gi');
  let depth = 0;
  lines.forEach((ln, k) => {
    const tr = ln.trim();
    const last = k === lines.length - 1;
    const inside = depth > 0;
    depth = Math.max(0, depth + (ln.match(openRe)?.length ?? 0) - (ln.match(closeRe)?.length ?? 0));
    if (inside || /^\u0000\d+\u0000$/.test(tr) || tr.startsWith('<') || tr.endsWith('>')) out += ln + '\n';
    else out += inlineMd(ln) + (last ? '' : '<br>\n');
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n]);
}

function splitFences(s: string): { type: 'text' | 'code'; text: string }[] {
  const parts: { type: 'text' | 'code'; text: string }[] = [];
  const re = /```[^\n`]*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ type: 'text', text: s.slice(last, m.index) });
    parts.push({ type: 'code', text: m[1] });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ type: 'text', text: s.slice(last) });
  return parts;
}

const jsStr = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Runs first inside every card: viewport height, TavernHelper stand-ins, error + height reporting. */
function cardRuntime(raw: string, s: Settings, vh: number): string {
  return `(function(){
document.documentElement.style.setProperty('--TH-viewport-height', ${vh} + 'px');
var RAW=${jsStr(raw)},USER=${jsStr(s.user)},CHAR=${jsStr(s.char)},AI=${s.role === 2};
window.getCurrentMessageId=window.getLastMessageId=function(){return 0};
window.getChatMessages=function(){return [{message_id:0,name:AI?CHAR:USER,role:AI?'assistant':'user',is_hidden:false,message:RAW,data:{},extra:{},swipe_id:0,swipes:[RAW]}]};
window.getVariables=function(){return {}};
window.triggerSlash=window.triggerSlashWithResult=function(){return Promise.resolve('')};
['setChatMessage','setChatMessages','createChatMessages','deleteChatMessages','insertOrAssignVariables','replaceVariables','updateVariablesWith','insertVariables','deleteVariable'].forEach(function(n){window[n]=function(){return Promise.resolve()}});
['eventOn','eventOnce','eventOnButton','eventMakeFirst','eventMakeLast','eventRemoveListener','eventClearEvent','eventClearListener','eventClearAll'].forEach(function(n){window[n]=function(){return {stop:function(){}}}});
window.eventEmit=function(){return Promise.resolve()};
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

function buildCard(code: string, raw: string, s: Settings, vh: number): string {
  // TavernHelper swaps vh for the chat viewport height so cards don't grow forever
  const doc = code.replace(/(\d+(?:\.\d+)?)vh\b/g, (_, n) => `calc(var(--TH-viewport-height) * ${n} / 100)`);
  const inject = `<script>${cardRuntime(raw, s, vh)}<\/script><script src="${JQ}"><\/script><script src="${LODASH}"><\/script>`;
  const m = doc.match(/<head\b[^>]*>/i) || doc.match(/<html\b[^>]*>/i) || doc.match(/^\s*<!doctype[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return doc.slice(0, at) + inject + doc.slice(at);
  }
  return inject + doc;
}

export function buildChat(display: string, raw: string, s: Settings, vh: number): string {
  let inner = '';
  for (const p of splitFences(display)) {
    if (p.type === 'text') inner += textToHtml(p.text);
    else if (s.frontend && isFrontend(p.text)) inner += `<iframe class="th" style="height:80px" srcdoc="${escAttr(buildCard(p.text, raw, s, vh))}"></iframe>`;
    else inner += `<pre><code>${escHtml(p.text)}</code></pre>`;
  }
  const dark = s.chatTheme === 'dark';
  const ai = s.role === 2;
  const phone = s.device === 'phone';
  const name = ai ? s.char : s.user;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0}
body{background:${dark ? '#1a1a1e' : '#e9e6e0'};color:${dark ? '#dcdcd2' : '#262626'};font:${phone ? 14 : 15}px/1.65 "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;padding:${phone ? '8px 6px' : '14px'}}
.mes{display:flex;gap:${phone ? 8 : 12}px;padding:${phone ? '10px 8px' : '12px 14px'};border-radius:10px;background:${dark ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.75)'};border:1px solid ${dark ? '#2c2c33' : '#d8d4cc'}}
.avatar{flex:none;width:${phone ? 34 : 46}px;height:${phone ? 34 : 46}px;border-radius:50%;background:${ai ? '#6b4fe0' : '#3a8f6a'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${phone ? 14 : 18}px}
.main{flex:1;min-width:0}
.name{font-weight:700;margin-bottom:4px}
.mes_text{overflow-wrap:anywhere}
.mes_text em{color:${dark ? '#9a9a9a' : '#777'}}
.mes_text q{quotes:none;color:${dark ? '#e18a24' : '#b85e12'}}
iframe.th{display:block;width:100%;border:0;margin:6px 0}
pre{background:${dark ? '#111114' : '#f3f1ec'};padding:10px;border-radius:6px;overflow:auto;font-size:12.5px;white-space:pre-wrap;word-break:break-all}
</style></head><body><div class="mes"><div class="avatar">${escHtml((name || '?').slice(0, 1))}</div>
<div class="main"><div class="name">${escHtml(name)}</div><div class="mes_text">${inner}</div></div></div>
<script>
addEventListener('message',function(e){var d=e.data;if(!d||!d.__stp)return;
if(d.__stp==='h'){var fs=document.querySelectorAll('iframe.th');for(var i=0;i<fs.length;i++){if(fs[i].contentWindow===e.source){fs[i].style.height=d.h+'px';break}}}
else if(d.__stp==='err'){parent.postMessage(d,'*')}});
addEventListener('error',function(e){parent.postMessage({__stp:'err',msg:'消息区：'+e.message},'*')});
<\/script></body></html>`;
}

export function emptyPage(msg: string, s: Settings): string {
  return `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui,'Microsoft YaHei';color:#888;background:${s.chatTheme === 'dark' ? '#1a1a1e' : '#e9e6e0'};text-align:center;padding:20px;box-sizing:border-box">${escHtml(msg)}</body>`;
}
