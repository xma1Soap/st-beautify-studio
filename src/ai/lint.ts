// Things in a regex's replacement that SillyTavern's message formatting would break (see PLAN.md 五 / 九).
// The AI gets these from its check tool and fixes them itself.

const FENCE = /```html[\s\S]*?```/gi;

export function lintReplace(text: string): string[] {
  const out: string[] = [];
  if (!text.trim()) return out;
  const frontend = /```html/i.test(text);
  // a front-end card is a page of its own (TavernHelper shows it in an iframe), ST's formatting doesn't touch it
  const plain = text.replace(FENCE, '');
  if (frontend && !plain.trim()) return out;
  const hasTags = /<[a-z][\s\S]*?>/i.test(plain);

  const lines = plain.split('\n');
  lines.forEach((l, i) => {
    for (const ch of ['*', '"']) {
      const n = l.split(ch).length - 1;
      if (n % 2) out.push(`第 ${i + 1} 行的 ${ch} 是单数个，酒馆的「自动修 Markdown」会在行尾补一个 ${ch}（calc 里的乘号改成除法，或拆开写）`);
    }
  });
  if (hasTags && /\n[ \t]*\n/.test(plain.trim())) out.push('HTML 中间有空行：酒馆会把它拆成段落，样式可能断开。把 HTML 压成一行');
  else if (hasTags && plain.trim().includes('\n')) out.push('HTML 分成了多行：在不认识的标签里，换行会变成 <br>，可能多出空白。最好压成一行');
  if (/\sid\s*=\s*["']/i.test(plain)) out.push('用了 id：每条消息都有一份，会重复。改用 class');
  if (/<style\s+[^>]*>/i.test(plain)) out.push('<style> 带了属性：酒馆只认不带属性的 <style>');
  if (/@import/i.test(plain)) out.push('@import 会被酒馆删掉');
  if (/<script[\s>]/i.test(plain)) out.push('<script> 会被酒馆删掉：需要脚本就写成 ```html 前端卡');
  if (/\son[a-z]+\s*=/i.test(plain)) out.push('onclick 等事件属性会被酒馆删掉');
  if (/<(img|video|audio|source)\b[^>]*\ssrc\s*=\s*["']?https?:/i.test(plain) || /<style>[\s\S]*?url\(\s*["']?https?:[\s\S]*?<\/style>/i.test(plain))
    out.push('有外链图片或 <style> 里的外链：酒馆默认「禁止外部媒体」会拦掉。可以改成写在标签上的 style="background:url(…)"，或用 base64 图片');
  if (/:(has|not|is|where)\([^()]*\(/i.test(plain)) out.push(':has() 等的括号嵌套了：酒馆给 class 改名时处理不了');
  if (/\[[\w-]+[~|^$*]?=\s*["'][^"']*\.[^"']*["']\]/.test(plain)) out.push('属性选择器的值里有「.」：酒馆会把它当成 class 改名');
  return out;
}

