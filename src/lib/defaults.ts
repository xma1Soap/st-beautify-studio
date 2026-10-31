import type { Project, RegexScript, Settings } from './types';
import { newId } from './id';

export const defaultSettings = (): Settings => ({
  user: 'User',
  char: 'Char',
  role: 2,
  depth: 0,
  frontend: true,
  chatTheme: 'dark',
  device: 'desktop',
});

const STARTER_HTML = `<div style="margin:8px 0;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#2b2440,#1e2a3a);border:1px solid #5b4b8a;color:#e8e4ff;box-shadow:0 4px 14px rgba(0,0,0,.25)">
  <div style="font-weight:700;letter-spacing:2px;color:#c9b8ff;margin-bottom:6px">✦ 状态栏 ✦</div>
  <div style="white-space:pre-line;line-height:1.7">$1</div>
</div>`;

export function newScript(name = '新美化'): RegexScript {
  return {
    id: newId(),
    scriptName: name,
    findRegex: '/<状态栏>\\s*([\\s\\S]*?)\\s*<\\/状态栏>/g',
    replaceString: STARTER_HTML,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

export function starterProject(): Project {
  return {
    name: '未命名工程',
    scripts: [newScript('状态栏美化')],
    testText: '{{char}}推开酒馆的门，风铃轻响。\n\n<状态栏>\n时间：黄昏\n地点：月影酒馆\n心情：期待\n</状态栏>',
    settings: defaultSettings(),
  };
}
