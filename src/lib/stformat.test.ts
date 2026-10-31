import { describe, expect, it } from 'vitest';
import { fixMarkdown, formatMessage } from './stformat';

const fmt = (mes: string, blockExternalMedia = true) => formatMessage(mes, { charName: 'Char', isUser: false, blockExternalMedia });

describe('formatMessage: what SillyTavern does to a message before showing it', () => {
  it('adds custom- to class names and scopes <style> to the message', () => {
    const { html } = fmt('<style>.card{color:red}.row:has(.v:empty){display:none}</style><div class="card row">hi</div>');
    expect(html).toContain('class="custom-card custom-row"');
    expect(html).toContain('.mes_text .custom-card');
    expect(html).toContain('.mes_text .custom-row:has(.custom-v:empty)');
  });

  it('keeps animations and container queries', () => {
    const { html } = fmt('<style>@keyframes b1-glow{0%{opacity:.5}100%{opacity:1}}@container (max-width:400px){.a{gap:0}}</style><div class="a">x</div>');
    expect(html).toContain('@keyframes b1-glow');
    expect(html).toContain('@container (max-width:400px)');
  });

  it('drops @import', () => {
    const { html } = fmt('<style>@import url(x.css);.a{color:red}</style><div class="a">x</div>');
    expect(html).not.toContain('@import');
  });

  it('removes scripts and event handlers', () => {
    const { html } = fmt('<div onclick="alert(1)">a</div><script>alert(2)</script>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('blocks external images by default and reports them', () => {
    const r = fmt('<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA">');
    expect(r.html).not.toContain('example.com');
    expect(r.html).toContain('data:image/png');
    expect(r.blocked).toEqual(['https://example.com/a.png']);
  });

  it('keeps external images when media is allowed', () => {
    const r = fmt('<img src="https://example.com/a.png">', false);
    expect(r.html).toContain('https://example.com/a.png');
    expect(r.blocked).toEqual([]);
  });

  it('blocks http links inside <style>, but not inside style="" attributes', () => {
    const r = fmt('<style>.a{background:url(https://example.com/bg.png)}</style><div class="a" style="background:url(https://example.com/inline.png)">x</div>');
    expect(r.html).not.toContain('bg.png');
    expect(r.html).toContain('inline.png');
    expect(r.blocked).toEqual(['url(https://example.com/bg.png)']);
  });

  it('wraps quotes in <q> so they can be colored, but not quotes inside tags', () => {
    const { html } = fmt('他说“你好”。<span title="a">x</span>');
    expect(html).toContain('<q>“你好”</q>');
    expect(html).toContain('title="a"');
  });

  it('turns line breaks inside unknown tags into <br> and drops the tag itself', () => {
    const { html } = fmt('<status>\n时间：黄昏\n地点：酒馆\n</status>');
    expect(html).toBe('<p>时间：黄昏<br>地点：酒馆</p>');
  });

  it('shows a tag with a Chinese name as plain text when no regex replaced it', () => {
    expect(fmt('<状态栏>时间：黄昏</状态栏>').html).toContain('&lt;状态栏&gt;');
  });

  it('removes "Char:" at the start of later lines (the first line is already inside <p>)', () => {
    expect(fmt('你好\nChar: 再见').html).not.toContain('Char:');
  });

  it('shows indented HTML after a blank line as a code block (common mistake)', () => {
    const { html } = fmt('<section>a</section>\n\n    <b>x</b>');
    expect(html).toContain('<pre><code>&lt;b&gt;');
  });

  it('leaves indented HTML alone inside one block element', () => {
    const { html } = fmt('<div>\n<p>a</p>\n\n    <span>x</span>\n</div>');
    expect(html).not.toContain('<pre>');
  });
});

describe('fixMarkdown', () => {
  it('appends a * or " to lines where it is unpaired', () => {
    expect(fixMarkdown('a * b')).toBe('a * b*');
    expect(fixMarkdown('他说"你好')).toBe('他说"你好"');
    expect(fixMarkdown('*ok*')).toBe('*ok*');
  });
  it('removes spaces just inside * pairs', () => {
    expect(fixMarkdown('* 动作 *')).toBe('*动作*');
  });
});
