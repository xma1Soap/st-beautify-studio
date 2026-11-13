import { describe, expect, it } from 'vitest';
import { decorateCode, loadHighlighter } from './codeBlocks';

const ICON = '<i class="fa-solid fa-copy code-copy interactable" title="Copy code" tabindex="0"></i>';

describe('code blocks as SillyTavern shows them', () => {
  it('leaves a message without code blocks as it is', () => {
    const html = '<p>没有代码，只有 <code>行内</code> 的。</p>';
    expect(decorateCode(html)).toBe(html);
    expect(decorateCode('<p>纯文字</p>')).toBe('<p>纯文字</p>');
  });

  it('gives each block the copy icon, even before highlight.js has loaded', () => {
    const out = decorateCode('<pre><code>a = 1\n</code></pre>');
    expect(out).toBe(`<pre><code>a = 1\n${ICON}</code></pre>`);
  });

  it('colours the language named after ```, guesses when there is none, and skips one it does not know', async () => {
    await loadHighlighter();
    const js = decorateCode('<pre><code class="js language-js">const a = "x"; // hi\n</code></pre>');
    expect(js).toContain('class="js language-js hljs language-javascript" data-highlighted="yes"');
    expect(js).toContain('<span class="hljs-keyword">const</span>');
    expect(js).toContain('<span class="hljs-string">"x"</span>');
    expect(js).toContain('<span class="hljs-comment">// hi</span>');
    expect(js.endsWith(`${ICON}</code></pre>`)).toBe(true);

    const guessed = decorateCode('<pre><code>SELECT * FROM t WHERE id = 1;\n</code></pre>');
    expect(guessed).toMatch(/class="hljs language-\w+"/);

    const unknown = decorateCode('<pre><code class="foo language-foo">写了个没有的语言\n</code></pre>');
    expect(unknown).toBe(`<pre><code class="foo language-foo">写了个没有的语言\n${ICON}</code></pre>`);
  });

  it('keeps what is around the blocks', async () => {
    await loadHighlighter();
    const out = decorateCode('<p>前面</p>\n<pre><code class="language-yaml">a: 1\n</code></pre>\n<p>后面 <q>"引号"</q></p>');
    expect(out.startsWith('<p>前面</p>\n<pre><code class="language-yaml hljs" data-highlighted="yes">')).toBe(true);
    expect(out.endsWith('</code></pre>\n<p>后面 <q>"引号"</q></p>')).toBe(true);
  });
});
