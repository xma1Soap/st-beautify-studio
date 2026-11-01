import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { starterProject } from '../lib/defaults';
import { useStore } from '../store';
import { starterCard, useCard } from '../cardStore';
import { barOf } from '../mvu/bar';
import { applyDraft, discardDraft, newChat, revertApplied, send, useAiChat } from './agent';
import { cardChanges, cardMode } from './cardMode';
import { chat } from './client';
import { diffCount, hunks, textDiff } from './diff';
import { lintReplace } from './lint';
import { fillMacros, parsePreset } from './preset';
import { regexMode } from './regexMode';
import { endpoint, useAiSettings, type AiSettings } from './settings';
import { replaceText } from './tools';

const run = <P,>(mode: { tools: { def: { function: { name: string } }; run: (p: P, a: any) => any }[] }, p: P, name: string, args: any = {}) => {
  const t = mode.tools.find((x) => x.def.function.name === name);
  if (!t) throw new Error('no tool ' + name);
  return t.run(p, args);
};

describe('endpoint', () => {
  it('fills in what people leave out', () => {
    expect(endpoint('api.example.com', 'chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    expect(endpoint('https://api.example.com/', 'models')).toBe('https://api.example.com/v1/models');
    expect(endpoint('https://a.com/v1/', 'chat/completions')).toBe('https://a.com/v1/chat/completions');
    expect(endpoint('https://a.com/v1/chat/completions', 'models')).toBe('https://a.com/v1/models');
    expect(endpoint('http://127.0.0.1:3000/openai', 'chat/completions')).toBe('http://127.0.0.1:3000/openai/chat/completions');
    expect(endpoint('127.0.0.1:3000', 'models')).toBe('http://127.0.0.1:3000/v1/models');
    expect(endpoint('localhost:3000/v1', 'models')).toBe('http://localhost:3000/v1/models');
    expect(endpoint('  ', 'models')).toBe('');
  });
});

describe('SillyTavern presets', () => {
  const json = {
    prompts: [
      { identifier: 'main', name: '主提示', role: 'system', content: '你是{{char}}，和{{user}}聊天' },
      { identifier: 'off', name: '关掉的', role: 'system', content: '不该出现' },
      { identifier: 'charDescription', name: '角色描述', marker: true },
      { identifier: 'chatHistory', name: '聊天记录', marker: true },
      { identifier: 'jb', name: '破限', role: 'user', content: '继续{{// 注释}}' },
      { identifier: 'deep', name: '深度注入', role: 'system', content: '注入', injection_position: 1 },
    ],
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'main', enabled: true }] },
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'off', enabled: false },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'deep', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jb', enabled: true },
        ],
      },
    ],
  };

  it('keeps the enabled entries in order, split at the chat history', () => {
    const p = parsePreset(json, '测试');
    expect(p.before.map((x) => x.name)).toEqual(['主提示']);
    expect(p.after.map((x) => x.name)).toEqual(['深度注入', '破限']);
    expect(p.after[1].role).toBe('user');
  });

  it('says what is wrong with other files', () => {
    expect(() => parsePreset({ foo: 1 }, 'x')).toThrow(/prompts/);
    expect(() => parsePreset({ prompts: [{ identifier: 'a', content: '', role: 'system' }] }, 'x')).toThrow(/没有启用/);
  });

  it('fills the macros that make sense here', () => {
    expect(fillMacros('你是{{char}}，和{{user}}{{// 注释}}聊{{setvar::a::1}}天{{newline}}好', { user: '我', char: '她' })).toBe('你是她，和我聊天\n好');
    expect(fillMacros('{{random::a,b}}', { user: '', char: '' })).toBe('{{random::a,b}}');
  });
});

describe('diff', () => {
  it('finds the changed lines', () => {
    const rows = textDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(diffCount(rows)).toEqual({ add: 2, del: 1 });
    expect(rows.filter((r) => r.t !== ' ').map((r) => r.t + r.s)).toEqual(['-b', '+B', '+e']);
  });

  it('breaks long one-line HTML so a small change stays small', () => {
    const a = '<div style="color:red;">' + '<span>x</span>'.repeat(30) + '</div>';
    const b = a.replace('color:red;', 'color:blue;');
    const c = diffCount(textDiff(a, b));
    expect(c.add).toBe(1);
    expect(c.del).toBe(1);
  });

  it('folds the unchanged parts', () => {
    const a = Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n');
    const rows = hunks(textDiff(a, a.replace('line 20', 'LINE 20')));
    expect(rows.some((r) => r.t === 'gap')).toBe(true);
    expect(rows.length).toBeLessThan(12);
  });
});

describe('lint for replace text', () => {
  it('warns about what SillyTavern breaks', () => {
    expect(lintReplace('<div id="a">x</div>').join()).toMatch(/id/);
    expect(lintReplace('<div>*粗体</div>').join()).toMatch(/\*/);
    expect(lintReplace('<div>\n\n<b>x</b></div>').length).toBeGreaterThan(0);
    expect(lintReplace('<script>alert(1)</script>').join()).toMatch(/script/);
  });
  it('leaves front-end cards and clean HTML alone', () => {
    expect(lintReplace('```html\n<div id="a">\n\n<script>1</script></div>\n```')).toEqual([]);
    expect(lintReplace('<div class="custom-a" style="color:red">$1</div>')).toEqual([]);
  });
});

describe('replace by original text', () => {
  it('needs the text to be there once', () => {
    expect(replaceText('aXbXc', 'X', 'Y', true)).toEqual({ text: 'aYbYc', n: 2 });
    expect(() => replaceText('aXbXc', 'X', 'Y', false)).toThrow(/2 次/);
    expect(() => replaceText('a  b', 'a b', 'c', false)).toThrow(/空格/);
    expect(replaceText('a$1b', 'b', '$&', false).text).toBe('a$1$&');
  });
});

describe('regex tools', () => {
  beforeEach(() => useStore.getState().loadProject(starterProject(), null));

  it('lists, adds, edits and checks regexes on a draft', () => {
    const p0 = useStore.getState().project;
    const list = run(regexMode, p0, 'list_regexes').result as any[];
    expect(list.length).toBe(p0.scripts.length);
    const add = run(regexMode, p0, 'add_regex', { scriptName: '心情', findRegex: '/心情：(.+)/g', replaceString: '<b class="custom-m">$1</b>' });
    expect(add.result.hits).toBe(1);
    const p1 = add.p;
    expect(p1.scripts.length).toBe(p0.scripts.length + 1);
    expect(useStore.getState().project).toBe(p0); // the project itself is untouched
    const edit = run(regexMode, p1, 'edit_regex_text', { id: add.result.id, old_text: '<b', new_text: '<i' });
    expect(edit.p.scripts.at(-1).replaceString).toBe('<i class="custom-m">$1</b>');
    expect(() => run(regexMode, p1, 'update_regex', { id: add.result.id, findRegex: '/(/g' })).toThrow(/查找正则有错/);
    const check = run(regexMode, edit.p, 'check').result;
    expect(check.regexes.at(-1)).toMatchObject({ name: '心情', hits: 1 });
    expect(regexMode.changes(p0, edit.p).map((c) => c.title).join()).toMatch(/心情/);
  });
});

describe('card tools', () => {
  beforeEach(() => useCard.getState().load(starterCard(), null));

  it('edits the status bar and the theme', () => {
    const p0 = useCard.getState().project;
    const root = barOf(p0).root;
    const add = run(cardMode, p0, 'add_component', { parent_id: root.id, node: { type: 'text', text: '你好' } });
    expect(barOf(add.p).root.children!.at(-1)).toMatchObject({ type: 'text', text: '你好' });
    const id = add.result.id;
    const up = run(cardMode, add.p, 'update_component', { id, set: { style: { color: '#ff0000' } } });
    expect(barOf(up.p).root.children!.find((n) => n.id === id)!.style).toMatchObject({ color: '#ff0000' });
    expect(() => run(cardMode, up.p, 'update_component', { id, set: { type: 'bar' } })).toThrow();
    expect(() => run(cardMode, up.p, 'set_theme', { colors: { accent: 'red' } })).toThrow(/#rrggbb/);
    const th = run(cardMode, up.p, 'set_theme', { colors: { accent: '#ff7a59' } });
    expect(barOf(th.p).theme.accent).toBe('#ff7a59');
    const titles = cardChanges(p0, th.p).map((c) => c.title).join('|');
    expect(titles).toMatch(/组件/);
    expect(titles).toMatch(/配色|主题/);
  });

  it('adds a regex to a card that has none yet', () => {
    const p0 = useCard.getState().project;
    const add = run(cardMode, p0, 'add_card_regex', { scriptName: '美化', findRegex: '/a/g', replaceString: 'b' });
    const list = run(cardMode, add.p, 'list_card_regexes').result as any[];
    expect(list.map((x) => x.name)).toEqual(['美化']);
  });
});

/* ---------- talking to an endpoint (the browser path, with fetch mocked) ---------- */

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
function reply(body: string, status = 200, pieces = 7) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      // cut at odd places so lines and characters get split
      for (let i = 0; i < body.length; i += pieces) c.enqueue(enc.encode(body.slice(i, i + pieces)));
      c.close();
    },
  });
  return new Response(stream, { status });
}

const settings: AiSettings = { url: 'https://api.test/v1', key: 'sk-test', model: 'm', temperature: null, stream: true, builtin: true, skills: [], preset: null, presetOn: false };

describe('chat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts a streamed reply back together, tool calls too', async () => {
    const body = sse([
      { choices: [{ delta: { reasoning_content: '想一' } }] },
      { choices: [{ delta: { reasoning_content: '想' } }] },
      { choices: [{ delta: { content: '好的，' } }] },
      { choices: [{ delta: { content: '我来改' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'list_', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'regexes', arguments: '{"a"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'check', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    ]);
    const f = vi.fn(async () => reply(body));
    vi.stubGlobal('fetch', f);
    const r = await chat(settings, [{ role: 'user', content: 'hi' }], [], new AbortController().signal);
    expect(r.content).toBe('好的，我来改');
    expect(r.reasoning).toBe('想一想');
    expect(r.toolCalls.map((t) => [t.id, t.function.name, t.function.arguments])).toEqual([
      ['c1', 'list_regexes', '{"a":1}'],
      ['c2', 'check', '{}'],
    ]);
    expect(r.finish).toBe('tool_calls');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect((init.headers as any).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm', stream: true });
  });

  it('reads a whole JSON reply and explains errors', async () => {
    vi.stubGlobal('fetch', async () => reply(JSON.stringify({ choices: [{ message: { content: '整段' }, finish_reason: 'stop' }] })));
    expect((await chat(settings, [], [], new AbortController().signal)).content).toBe('整段');
    vi.stubGlobal('fetch', async () => reply(JSON.stringify({ error: { message: 'bad key' } }), 401));
    await expect(chat(settings, [], [], new AbortController().signal)).rejects.toThrow(/401.*密钥.*bad key/);
  });
});

describe('the assistant end to end', () => {
  beforeEach(async () => {
    useStore.getState().loadProject(starterProject(), null);
    useAiSettings.getState().set({ ...settings, stream: false });
    await newChat('regex');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs the tools on a draft, then applies and reverts it', async () => {
    const answers = [
      { choices: [{ message: { content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'add_regex', arguments: JSON.stringify({ scriptName: 'AI 加的', findRegex: '/黄昏/g', replaceString: '<b>黄昏</b>' }) } }] } }] },
      { choices: [{ message: { content: '加好了' } }] },
    ];
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return reply(JSON.stringify(answers.shift()));
    });
    const before = useStore.getState().project;
    await send('regex', '加一条');
    const c = useAiChat.getState().chats.regex;
    expect(c.error).toBeNull();
    expect(c.msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(c.notes.t1.ok).toBe(true);
    expect(c.draft).not.toBeNull();
    expect(useStore.getState().project).toBe(before);
    // the system prompt comes first and the second request carries the tool result
    expect(sent[0].messages[0].role).toBe('system');
    expect(sent[0].tools.length).toBeGreaterThan(5);
    expect(sent[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 't1' });

    await applyDraft('regex');
    expect(useStore.getState().project.scripts.at(-1)!.scriptName).toBe('AI 加的');
    revertApplied('regex');
    expect(useStore.getState().project.scripts.length).toBe(before.scripts.length);
    expect(useAiChat.getState().chats.regex.pending.length).toBe(1);
  });

  it('tells the AI when its draft was thrown away', async () => {
    const answers = [
      { choices: [{ message: { tool_calls: [{ id: 't1', type: 'function', function: { name: 'set_test_text', arguments: '{"text":"新的"}' } }] } }] },
      { choices: [{ message: { content: '改了' } }] },
      { choices: [{ message: { content: '好' } }] },
    ];
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return reply(JSON.stringify(answers.shift()));
    });
    await send('regex', '改测试消息');
    discardDraft('regex');
    expect(useAiChat.getState().chats.regex.draft).toBeNull();
    await send('regex', '那算了');
    expect(sent[2].messages.at(-1).content).toMatch(/放弃了[\s\S]*那算了/);
  });
});
