// The assistant in the regex beautifier: it edits the regex list and the test message.
import { processText, skipReason } from '../lib/engine';
import type { Project, RegexScript } from '../lib/types';
import { useStore } from '../store';
import { lintReplace } from './lint';
import { previewLog, quote, type AiMode, type Change } from './mode';
import { regexTools, str, num, tool, type Tool } from './tools';

const ROLE = { 1: '用户输入', 2: 'AI 输出' } as const;

const tools: Tool<Project>[] = [
  ...regexTools<Project>(
    {
      list: (p) => p.scripts,
      save: (p, scripts) => ({ ...p, scripts }),
      test: (p) => ({ settings: p.settings, text: p.testText }),
    },
    { list: 'list_regexes', read: 'read_regex', update: 'update_regex', edit: 'edit_regex_text', add: 'add_regex', remove: 'delete_regex', move: 'move_regex' },
    '工程里的正则',
  ),
  tool<Project>('read_test_text', '读测试消息（模拟的一条 AI 回复原文，正则在它上面跑）', { start: num('从第几个字开始（默认 0）') }, [], (p, a) => {
    const from = Math.max(0, Number(a.start) || 0);
    const to = Math.min(p.testText.length, from + 12000);
    return { label: '读了测试消息', result: { total_chars: p.testText.length, from, to, text: p.testText.slice(from, to) } };
  }),
  tool<Project>('set_test_text', '整段换掉测试消息（写一条能让正则命中的 AI 回复，方便看效果）', { text: str('新的测试消息') }, ['text'], (p, a) => ({
    p: { ...p, testText: String(a.text ?? '') },
    label: '改了测试消息',
    result: { ok: true },
  })),
  tool<Project>(
    'check',
    '检查草稿：每条正则在测试消息里命中几处、正则错误、替换内容里会被酒馆弄坏的写法、最后显示出来的文字。改完一定要调用一次',
    {},
    [],
    (p) => {
      const r = processText(p.scripts, p.testText, p.settings);
      return {
        label: '检查了一遍',
        result: {
          test_text_empty: !p.testText.trim(),
          regexes: p.scripts.map((s) => {
            const st = r.stats[s.id];
            const skip = s.disabled ? '已禁用' : skipReason(s, p.settings);
            const warn = lintReplace(s.replaceString);
            return { id: s.id, name: s.scriptName, ...(skip ? { skipped: skip } : { hits: st?.hits ?? 0 }), ...(st?.err ? { error: st.err } : {}), ...(warn.length ? { warnings: warn } : {}) };
          }),
          shown_text: quote(r.display, 3000),
          preview_errors: previewLog.regex.length ? previewLog.regex.slice(0, 10) : undefined,
        },
      };
    },
  ),
];

function context(p: Project): string {
  const s = p.settings;
  const stats = p.testText.trim() ? processText(p.scripts, p.testText, s).stats : {};
  const sel = useStore.getState().selectedId;
  const cur = p.scripts.find((x) => x.id === sel);
  const lines = [
    `工程「${p.name}」。{{user}} = ${s.user}，{{char}} = ${s.char}。测试消息当作「${ROLE[s.role]}」，楼层深度 ${s.depth}。预览：${s.device === 'phone' ? '手机' : '电脑'}，${s.chatTheme === 'dark' ? '暗色' : '亮色'}聊天界面，${s.frontend ? '会' : '不会'}把 \`\`\`html 代码块显示成前端卡。`,
    '',
    p.scripts.length ? '正则（按执行顺序）：' : '工程里还没有正则。',
    ...p.scripts.map(
      (x, i) =>
        `${i + 1}. [${x.id}] ${x.scriptName}${x.disabled ? '（已禁用）' : ''} — 查找 ${quote(x.findRegex, 160)} — 替换内容 ${x.replaceString.length} 字${stats[x.id] ? `，命中 ${stats[x.id].hits} 处` : ''}`,
    ),
    cur ? `\n用户正在看的正则：[${cur.id}] ${cur.scriptName}` : '',
    '',
    p.testText.trim() ? `测试消息（${p.testText.length} 字）：\n"""\n${quote(p.testText, 1500)}\n"""` : '测试消息是空的。',
    previewLog.regex.length ? `\n预览最近报的错：\n${previewLog.regex.slice(0, 8).join('\n')}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

const FLAG: [keyof RegexScript, string][] = [
  ['scriptName', '名称'],
  ['disabled', '禁用'],
  ['markdownOnly', '仅格式显示'],
  ['promptOnly', '仅格式提示词'],
  ['runOnEdit', '编辑时运行'],
  ['placement', '作用范围'],
  ['trimStrings', '修剪掉'],
  ['substituteRegex', '正则中的宏'],
  ['minDepth', '最小深度'],
  ['maxDepth', '最大深度'],
];
const show = (v: unknown) => (typeof v === 'boolean' ? (v ? '开' : '关') : v === null || v === undefined ? '不限' : Array.isArray(v) ? v.join('、') || '无' : String(v));

/** What changed between two regex lists, for the review. */
export function regexChanges(a: RegexScript[], b: RegexScript[], where = ''): Change[] {
  const out: Change[] = [];
  const before = new Map(a.map((s) => [s.id, s]));
  const now = new Set(b.map((s) => s.id));
  for (const s of b) {
    const o = before.get(s.id);
    if (!o) {
      out.push({ title: `新建${where}正则「${s.scriptName}」`, diff: { a: '', b: `查找：${s.findRegex}\n\n${s.replaceString}` } });
      continue;
    }
    if (o.findRegex !== s.findRegex) out.push({ title: `${where}正则「${s.scriptName}」的查找正则`, diff: { a: o.findRegex, b: s.findRegex } });
    if (o.replaceString !== s.replaceString) out.push({ title: `${where}正则「${s.scriptName}」的替换内容`, diff: { a: o.replaceString, b: s.replaceString } });
    const flags = FLAG.filter(([k]) => JSON.stringify(o[k]) !== JSON.stringify(s[k])).map(([k, label]) => `${label} ${show(o[k])} → ${show(s[k])}`);
    if (flags.length) out.push({ title: `${where}正则「${s.scriptName}」：${flags.join('；')}` });
  }
  for (const s of a) if (!now.has(s.id)) out.push({ title: `删了${where}正则「${s.scriptName}」`, diff: { a: s.replaceString, b: '' } });
  const order = (l: RegexScript[]) => l.filter((s) => before.has(s.id) && now.has(s.id)).map((s) => s.id).join();
  if (order(a) !== order(b)) out.push({ title: `调整了${where}正则的顺序：${b.map((s) => s.scriptName).join(' → ')}` });
  return out;
}

export const regexMode: AiMode<Project> = {
  id: 'regex',
  intro:
    '用户在「正则美化」模式：给 AI 回复的纯文字做酒馆正则美化。工程是一串酒馆正则（和酒馆导出的字段一样）加一条测试消息，右边的预览按酒馆的方式显示测试消息被正则处理后的样子。',
  tools,
  context,
  current: () => useStore.getState().project,
  same: (a, b) => a.scripts === b.scripts && a.testText === b.testText && a.name === b.name,
  apply: (next) => useStore.getState().applyProject(next),
  revert: (applied) => {
    const st = useStore.getState();
    if (st.project.scripts !== applied.scripts || st.project.testText !== applied.testText) return false;
    st.undo();
    return true;
  },
  changes: (a, b) => [
    ...regexChanges(a.scripts, b.scripts),
    ...(a.testText !== b.testText ? [{ title: '测试消息', diff: { a: a.testText, b: b.testText } }] : []),
  ],
  macros: () => {
    const s = useStore.getState().project.settings;
    return { user: s.user, char: s.char };
  },
};
