import { describe, expect, it } from 'vitest';
import { pickFaces, stFontCss, wantedFaces } from './stFonts';

const names = (html: string, extra = '') => pickFaces(html, extra).map((f) => f.file);

describe("SillyTavern's fonts in the preview page", () => {
  it('an ordinary message gets the common part of the three weights the chat uses', () => {
    expect(names('<p>白娅放下杯子，朝你笑了笑：<q>“今天来得挺早。”</q>……</p>')).toEqual([
      'NotoSans-400-core.woff2',
      'NotoSans-500-core.woff2',
      'NotoSans-700-core.woff2',
    ]);
  });

  it('italic, bold italic and code only when the message has them', () => {
    expect(wantedFaces('<p><em>轻声</em></p>').has('Noto Sans|500|italic')).toBe(true);
    expect(wantedFaces('<p><em>轻声</em></p>').has('Noto Sans|700|italic')).toBe(false);
    expect(wantedFaces('<p><strong><em>重</em></strong></p>').has('Noto Sans|700|italic')).toBe(true);
    const code = wantedFaces('<pre><code class="hljs"><span class="hljs-keyword">a</span></code></pre>');
    expect(code.has('Noto Sans Mono|500|normal')).toBe(true);
    expect(code.has('Noto Sans Mono|700|normal')).toBe(false);
    expect(wantedFaces('<pre><code><span class="hljs-meta">#!</span></code></pre>').has('Noto Sans Mono|700|normal')).toBe(true);
  });

  it('every face when the message brings its own styles (the code ones when it has code)', () => {
    expect(wantedFaces('<style>.x{font-weight:600}</style><p class="x">a</p>').size).toBe(6);
    expect(wantedFaces('<span style="font-style: italic">a</span><code>b</code>').size).toBe(9);
  });

  it("a face's rest only for a character from it (Greek, Cyrillic, accents), also in the name", () => {
    expect(names('<p>Σ(っ°Д°;)っ</p>')).toContain('NotoSans-500-ext.woff2');
    expect(names('<p>café</p>')).not.toContain('NotoSans-500-ext.woff2');
    expect(names('<p>你好</p>', 'Zoë')).not.toContain('NotoSans-700-ext.woff2');
    expect(names('<p>你好</p>', 'Žofie')).toContain('NotoSans-700-ext.woff2');
  });

  it('nothing until the font files have loaded', () => {
    expect(stFontCss('<p>a</p>')).toBe('');
  });
});
