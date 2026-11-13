// Code blocks in a message, as SillyTavern shows them: once a message is on the page it colours each `pre code` with
// highlight.js (all of its languages; the block's ```language, or a guess when there is none) and puts a copy icon in
// its top right corner. Same library as SillyTavern 1.19 (highlight.js 11, BSD-3-Clause) and the same colours (its
// "Bright" theme, MIT).
import type { HLJSApi } from 'highlight.js';

let hljs: HLJSApi | null = null;
let loading: Promise<HLJSApi> | undefined;

/** highlight.js with every language is about 1 MB, so it is loaded on its own, the first time a preview is built. */
export function loadHighlighter(): Promise<HLJSApi> {
  loading ??= import('highlight.js').then(
    (m) => {
      hljs = m.default;
      // SillyTavern leaves this on too, so highlight.js may write to the console; the preview has no use for it
      hljs.configure({ ignoreUnescapedHTML: true });
      return hljs;
    },
    (e) => {
      loading = undefined;
      throw e;
    },
  );
  return loading;
}

/**
 * The message HTML with its code blocks coloured and given the copy icon, as SillyTavern's page has it. Until
 * highlight.js has loaded (loadHighlighter) the blocks only get the icon.
 */
export function decorateCode(html: string): string {
  if (!html.includes('<code')) return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const blocks = doc.body.querySelectorAll('pre code');
  if (!blocks.length) return html;
  for (const code of blocks) {
    hljs?.highlightElement(code as HTMLElement);
    const copy = doc.createElement('i');
    copy.classList.add('fa-solid', 'fa-copy', 'code-copy', 'interactable');
    copy.title = 'Copy code';
    // SillyTavern makes everything clickable reachable with Tab
    copy.tabIndex = 0;
    code.appendChild(copy);
  }
  return doc.body.innerHTML;
}

/** The "Bright" colours, and the copy icon (Font Awesome Free's "copy", CC BY 4.0) at 40%, 22px square, 4px in. */
export const CODE_CSS = `pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{color:#e0e0e0;background:#000}.hljs-comment{color:#b0b0b0}.hljs-tag{color:#d0d0d0}.hljs-operator,.hljs-punctuation,.hljs-subst{color:#e0e0e0}.hljs-operator{opacity:.7}.hljs-bullet,.hljs-deletion,.hljs-name,.hljs-selector-tag,.hljs-template-variable,.hljs-variable{color:#fb0120}.hljs-attr,.hljs-link,.hljs-literal,.hljs-number,.hljs-symbol,.hljs-variable.constant_{color:#fc6d24}.hljs-class .hljs-title,.hljs-title,.hljs-title.class_{color:#fda331}.hljs-strong{font-weight:700;color:#fda331}.hljs-addition,.hljs-code,.hljs-string,.hljs-title.class_.inherited__{color:#a1c659}.hljs-built_in,.hljs-doctag,.hljs-keyword.hljs-atrule,.hljs-quote,.hljs-regexp{color:#76c7b7}.hljs-attribute,.hljs-function .hljs-title,.hljs-section,.hljs-title.function_,.ruby .hljs-property{color:#6fb3d2}.diff .hljs-meta,.hljs-keyword,.hljs-template-tag,.hljs-type{color:#d381c3}.hljs-emphasis{color:#d381c3;font-style:italic}.hljs-meta,.hljs-meta .hljs-keyword,.hljs-meta .hljs-string{color:#be643c}.hljs-meta .hljs-keyword,.hljs-meta-keyword{font-weight:700}
.code-copy{position:absolute;top:0;right:0;width:22px;height:22px;margin:4px;opacity:.4;display:flex;align-items:center;justify-content:center;cursor:pointer;font-style:normal;line-height:1;-webkit-font-smoothing:antialiased}
.code-copy:hover{opacity:.8}
.code-copy::before{content:'';width:.875em;height:1em;background-color:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 448 512'%3E%3Cpath transform='matrix(1 0 0 -1 0 448)' d='M208 448H332Q352 448 366 434L434 366Q448 352 448 332V112Q447 92 434 78Q420 65 400 64H208Q188 65 174 78Q161 92 160 112V400Q161 420 174 434Q188 447 208 448ZM48 320H128V256H64V0H256V32H320V-16Q319 -36 306 -50Q292 -63 272 -64H48Q28 -63 14 -50Q1 -36 0 -16V272Q1 292 14 306Q28 319 48 320Z'/%3E%3C/svg%3E") center/contain no-repeat}`;
