// What a chat preview page needs besides its own code, loaded once (each part on its own, the first time a preview
// is built): the libraries front-end cards get, highlight.js for code blocks and SillyTavern's fonts.
import { loadFrameLibs } from './frameLibs';
import { loadHighlighter } from './codeBlocks';
import { loadStFonts } from './stFonts';

/** Loads them; resolves (never fails) with what couldn't be loaded, said for the person using the tool. */
export async function loadPreviewAssets(): Promise<string[]> {
  const errors: string[] = [];
  await Promise.all([
    loadFrameLibs().catch(() => errors.push('没能载入卡片要用的 jQuery / lodash / zod，改用网上的 jQuery 和 lodash')),
    loadHighlighter().catch(() => errors.push('没能载入代码块上色用的 highlight.js，预览里的代码块不上色')),
    loadStFonts().catch(() => errors.push('没能载入酒馆用的字体（Noto Sans），预览里的英文、数字和标点用的是电脑自带的字体')),
  ]);
  return errors;
}
