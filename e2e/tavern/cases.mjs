// The cards the real-SillyTavern check runs. `project(name)` runs in the studio page (window.__studio) and gives the
// card project; `reply` (or `replies`, one per round) is what the stand-in AI answers; `greeting` the greeting to
// swipe to first; `device` 'desktop' (default) or 'phone'; `checks` are extra checks for the case; `wholeChat`: after
// the rounds the chat is opened again and every message is compared with the studio's preview of the whole chat;
// `bg` ({ fitting }) puts a test picture behind the chat (e2e/tavern/bg.mjs); `look.extra` is SillyTavern settings.
//
// `project` is sent to the studio page as source text, so it can't use anything from this file.

const UPDATE = (analysis, ops) => `<UpdateVariable>\n<Analysis>${analysis}</Analysis>\n<JSONPatch>\n${JSON.stringify(ops, null, 2)}\n</JSONPatch>\n</UpdateVariable>`;

/** A new card with the starter variables (世界: 日期 时间 地点; 角色名: 好感度 心情 当前想法). */
const starter = (name) => {
  const S = window.__studio;
  const p = S.mvuCard.newCardProject();
  p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
  p.vars = S.templates.starterVars();
  return p;
};

const REPLY =
  '白娅放下杯子，朝你笑了笑："今天来得挺早。"\n\n她的耳尖有点红。\n\n' +
  UPDATE('打招呼，好感小幅上升，心情变好，时间推进到傍晚', [
    { op: 'delta', path: '/角色名/好感度', value: 5 },
    { op: 'replace', path: '/角色名/心情', value: '开心' },
    { op: 'replace', path: '/角色名/当前想法', value: '他今天怎么这么早' },
    { op: 'replace', path: '/世界/时间', value: '傍晚' },
  ]);

/** A status bar a card author wrote by hand: a front-end page that reads MVU's data itself, like most cards do. */
const OWN_BAR = `\`\`\`html
<!DOCTYPE html>
<html><head><style>
body{margin:0;font-family:sans-serif}
.panel{background:linear-gradient(135deg,#2d1b3d,#1a1a2e);border:1px solid #6a4c93;border-radius:10px;padding:12px 14px;color:#eee}
.panel h3{margin:0 0 8px;font-size:14px;color:#d4a5ff;letter-spacing:2px}
.row{display:flex;justify-content:space-between;margin:6px 0;font-size:13px}
.track{height:8px;background:#333;border-radius:4px;overflow:hidden}
.fill{height:100%;background:linear-gradient(90deg,#e86a92,#ffb3c8);width:0}
.tag{display:inline-block;padding:1px 8px;border-radius:9px;background:#6a4c93;font-size:12px}
</style></head><body>
<div class="panel">
  <h3>✦ 白娅</h3>
  <div class="row"><span>好感度</span><span id="aff">-</span></div>
  <div class="track"><div class="fill" id="fill"></div></div>
  <div class="row"><span>心情</span><span class="tag" id="mood">-</span></div>
  <div class="row"><span>时间</span><span id="time">-</span></div>
</div>
<script>
$(async () => {
  await waitGlobalInitialized('Mvu');
  const s = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() }).stat_data;
  $('#aff').text(s.白娅.好感度 + ' / 100');
  $('#fill').css('width', s.白娅.好感度 + '%');
  $('#mood').text(s.白娅.心情);
  $('#time').text(s.世界.时间);
});
</script>
</body></html>
\`\`\``;

export const CASES = [
  {
    name: '默认状态栏',
    project: starter,
    user: '我推门进来，向她点点头。',
    reply: REPLY,
    checks: [
      async ({ prompt, check }) => {
        const all = (prompt?.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
        check('发给 AI 的内容里有变量更新规则', /变量更新规则|什么时候变|更新规则/.test(all) || all.includes('好感度'), all.slice(0, 600));
        check('发给 AI 的内容里有输出格式（UpdateVariable）', all.includes('UpdateVariable'), all.slice(0, 600));
        check('发给 AI 的内容里没有状态栏的占位符', !all.includes('StatusPlaceHolderImpl'), all.slice(0, 600));
      },
    ],
  },
  {
    name: '备选开场白自己的初始值',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.vars = S.templates.starterVars();
      const id = (...path) => {
        let list = p.vars;
        let v;
        for (const n of path) {
          v = list.find((x) => x.name === n);
          list = v.children ?? [];
        }
        return v.id;
      };
      p.card = {
        ...p.card,
        name,
        greetings: ['清晨的酒馆还没什么人，白娅在擦桌子。', '夜深了，白娅正准备打烊，看见你又推门进来。'],
        greetingVars: [{}, { [id('世界', '时间')]: '深夜', [id('角色名', '好感度')]: 55, [id('角色名', '心情')]: '紧张' }],
      };
      return p;
    },
    greeting: 1,
    user: '我在吧台前坐下。',
    reply: '她叹了口气，还是给你倒了杯热茶。\n\n' + UPDATE('留下来陪她，好感上升', [{ op: 'delta', path: '/角色名/好感度', value: 3 }, { op: 'replace', path: '/角色名/心情', value: '平静' }]),
  },
  {
    name: '开场白不显示状态栏',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.settings = { ...p.settings, barOnGreeting: false };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '纯文字状态栏',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.textBar = { on: true, title: '状态' };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '不合规矩的更新',
    project: starter,
    user: '我送了她一大束花。',
    reply:
      '白娅愣住了。\n\n' +
      UPDATE('各种不合规矩的写法', [
        { op: 'delta', path: '/角色名/好感度', value: 150 },
        { op: 'replace', path: '/角色名/心情', value: '狂喜' },
        { op: 'replace', path: '/世界/不存在的变量', value: 1 },
        { op: 'replace', path: '/角色名/当前想法', value: 123 },
        { op: 'delta', path: '/世界/地点', value: 2 },
        { op: 'replace', path: '/世界/时间', value: '夜晚' },
        { op: 'remove', path: '/世界/日期' },
      ]),
  },
  {
    name: '玩家修改变量',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      const role = p.vars.find((v) => v.name === '角色名');
      role.children = role.children.map((v) => (v.name === '好感度' || v.name === '心情' ? { ...v, playerEditable: true } : v));
      p.settings = { ...p.settings, allowPlayerEdit: true };
      const bar = S.bar.defaultBar(p.vars);
      p.bar = { root: { ...bar.root, children: [...bar.root.children, S.bar.editButton()] }, theme: bar.theme };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
    checks: [
      async ({ page, id, check, log, ai, send, file }) => {
        // the player opens the form in the newest reply's status bar, changes two values and saves
        const bar = page.frameLocator(`#chat .mes[mesid="${id}"] .mes_text iframe`).first();
        await bar.getByText('修改', { exact: false }).last().click();
        const row = (n) => bar.locator('.sb-ed-row').filter({ has: bar.locator('.sb-ed-name', { hasText: n }) });
        await row('好感度').locator('input[type=number]').fill('42');
        await row('好感度').locator('input[type=number]').blur();
        await row('心情').locator('select').selectOption('害羞');
        await page.screenshot({ path: file('st-修改面板.png') });
        await bar.locator('.sb-ed-ok').click();
        await page.waitForTimeout(2500);
        const after = await page.evaluate((i) => window.TavernHelper.getVariables({ type: 'message', message_id: i })?.stat_data, id);
        log.push('玩家保存后的变量：' + JSON.stringify(after));
        check('玩家改的值存进了这一楼（阶段名跟着变）', after?.角色名?.好感度 === 42 && after?.角色名?.心情 === '害羞' && after?.角色名?.$好感度阶段 === '朋友', after);
        const shown = await bar.locator('body').innerText();
        check('状态栏马上显示改过的值', /42/.test(shown) && shown.includes('害羞'), shown.slice(0, 200));
        // the next round starts from what the player set
        ai.queue.push('她低下头，脸更红了。\n\n<UpdateVariable>\n<JSONPatch>\n[{"op":"delta","path":"/角色名/好感度","value":1}]\n</JSONPatch>\n</UpdateVariable>');
        const next = await send(page, '我看着她。');
        const v = await page.evaluate((i) => window.TavernHelper.getVariables({ type: 'message', message_id: i })?.stat_data, next);
        log.push('下一轮的变量：' + JSON.stringify(v));
        check('下一轮 MVU 接着玩家改的值算（42 + 1）', v?.角色名?.好感度 === 43 && v?.角色名?.心情 === '害羞', v);
        const sent = JSON.stringify(ai.requests[ai.requests.length - 1]);
        check('下一轮发给 AI 的当前变量是玩家改过的', sent.includes('好感度: 42'), sent.slice(0, 400));
      },
    ],
  },
  {
    name: '没配对的星号和引号',
    project: starter,
    user: '我推门进来。',
    reply:
      '她靠在吧台边，*轻轻哼着歌\n\n"你来啦，我等了好久\n\n**今天的特调**是*桂花酒*，_要尝尝吗_？\n\n' +
      UPDATE('打招呼', [{ op: 'delta', path: '/角色名/好感度', value: 1 }]),
  },
  {
    name: '代码块（上色和复制图标）',
    project: starter,
    user: '教我写个小程序。',
    reply:
      [
        '她在纸上写了几行：',
        '',
        '```js',
        'function greet(name) {',
        '  // 打个招呼',
        '  return `你好，${name}！` + 42;',
        '}',
        '```',
        '',
        '又写了一段设置：',
        '',
        '```yaml',
        '名字: 白娅',
        '好感度: 5',
        'ok: true',
        '```',
        '',
        '还有一段不知道是什么的：',
        '',
        '```',
        '<div class="a">hi</div>',
        'SELECT * FROM t WHERE id = 1;',
        '```',
        '',
        '```foo',
        '写了个没有的语言',
        '```',
        '',
        '行内的 `code` 也有。',
        '',
        '',
      ].join('\n') +
      UPDATE('教写程序', [{ op: 'delta', path: '/角色名/好感度', value: 1 }]),
  },
  {
    name: '两轮回复',
    project: starter,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [
      REPLY,
      '你们聊了很久，窗外已经全黑了。\n\n' +
        UPDATE('聊天，好感继续上升，时间到夜晚', [
          { op: 'delta', path: '/角色名/好感度', value: 18 },
          { op: 'replace', path: '/角色名/心情', value: '害羞' },
          { op: 'replace', path: '/世界/时间', value: '夜晚' },
          { op: 'replace', path: '/世界/日期', value: '第2天' },
        ]),
    ],
  },
  {
    name: '整段聊天（三轮，重开聊天后逐楼对照）',
    project: starter,
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。', '我说明天还会来。'],
    replies: [
      REPLY,
      '你们聊了很久，窗外已经全黑了。\n\n' +
        UPDATE('聊天，好感继续上升，时间到夜晚', [
          { op: 'delta', path: '/角色名/好感度', value: 18 },
          { op: 'replace', path: '/角色名/心情', value: '害羞' },
          { op: 'replace', path: '/世界/时间', value: '夜晚' },
        ]),
      '她点点头，把你送到门口。\n\n' + UPDATE('道别', [{ op: 'replace', path: '/角色名/当前想法', value: '明天他还会来吗' }]),
    ],
  },
  {
    name: '整段聊天：纯文字状态栏只在最新回复',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.textBar = { on: true, title: '状态' };
      return p;
    },
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [REPLY, '你们聊了很久。\n\n' + UPDATE('聊天', [{ op: 'delta', path: '/角色名/好感度', value: 18 }, { op: 'replace', path: '/世界/时间', value: '夜晚' }])],
  },
  {
    name: '整段聊天：按深度和作用范围的正则（气泡）',
    look: { theme: 'Cappuccino' },
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      const rx = (id, scriptName, findRegex, replaceString, o) => ({
        id, scriptName, findRegex, replaceString, trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...o,
      });
      p.base = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        name,
        data: {
          name,
          extensions: {
            regex_scripts: [
              // only shown on the player's messages
              rx('u1', '玩家的话加粗', '/我/g', '<b>我</b>', { placement: [1] }),
              // only on older replies (depth 3 and up)
              rx('d1', '旧回复里的名字加框', '/白娅/g', '【白娅】', { minDepth: 3 }),
              // only on the newest two (depth 0–1)
              rx('d2', '最新回复的提示', '/$/', '\n\n<small>（最新）</small>', { maxDepth: 1 }),
              // rewrites the stored reply when it arrives: no depth then, so every reply has it (only in the replies:
              // the first chat's greeting is made before the player allows the card's regexes)
              rx('s1', '存的时候换字', '/笑了笑/g', '笑了一下', { markdownOnly: false, maxDepth: 0 }),
            ],
          },
        },
      };
      return p;
    },
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [REPLY, '你们聊了很久，白娅笑个不停。\n\n' + UPDATE('聊天', [{ op: 'delta', path: '/角色名/好感度', value: 18 }])],
  },
  {
    name: '整段聊天：主题 Celestial Macaron（楼层号、计时、按钮全展开）',
    look: { theme: 'Celestial Macaron' },
    project: starter,
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [REPLY, '你们聊了很久。\n\n' + UPDATE('聊天', [{ op: 'delta', path: '/角色名/好感度', value: 18 }])],
  },
  {
    name: '整段聊天：主题 Dark V 1.0（不显示时间）',
    look: { theme: 'Dark V 1.0' },
    project: starter,
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [REPLY, '你们聊了很久。\n\n' + UPDATE('聊天', [{ op: 'delta', path: '/角色名/好感度', value: 18 }])],
  },
  {
    name: '整段聊天：手机 Azure（长方头像、楼层号、计时）',
    device: 'phone',
    look: { theme: 'Azure' },
    project: starter,
    wholeChat: true,
    user: ['我推门进来，向她点点头。', '我陪她聊到了天黑。'],
    replies: [REPLY, '你们聊了很久。\n\n' + UPDATE('聊天', [{ op: 'delta', path: '/角色名/好感度', value: 18 }])],
  },
  {
    name: '聊天背景图（Azure：半透明、模糊）',
    look: { theme: 'Azure' },
    bg: { fitting: 'classic' },
    project: starter,
    wholeChat: true,
    user: ['我推门进来，向她点点头。'],
    replies: [REPLY],
  },
  {
    name: '聊天背景图（填满，快速界面不模糊）',
    look: { theme: 'Celestial Macaron', extra: { fast_ui_mode: true } },
    bg: { fitting: 'cover' },
    project: starter,
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '聊天背景图（手机，完整显示）',
    device: 'phone',
    look: { theme: 'Azure' },
    bg: { fitting: 'contain' },
    project: starter,
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '变量更新：展开、改标题、跟着主题的框（Cappuccino）',
    look: { theme: 'Cappuccino' },
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.settings = { ...p.settings, updateFold: { show: 'open', title: '📊 数值变化 *$1*', look: 'box' } };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '变量更新：藏起来',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.settings = { ...p.settings, updateFold: { show: 'hide' } };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '状态栏背景图、纹理、毛玻璃',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      // a picture drawn here, so the card carries it inside (like a picture picked from the computer)
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 200;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 320, 200);
      gr.addColorStop(0, '#203a6e');
      gr.addColorStop(1, '#c0507a');
      g.fillStyle = gr;
      g.fillRect(0, 0, 320, 200);
      g.fillStyle = '#ffd166';
      for (let i = 0; i < 12; i++) g.fillRect((i * 53) % 300, (i * 37) % 180, 18, 18);
      const bar = S.bar.defaultBar(p.vars);
      const root = { ...bar.root, style: { ...bar.root.style, bgImg: c.toDataURL('image/png'), bgDim: 0.25, texture: 'paper', texColor: '#ffffff33' } };
      root.children = root.children.map((k) => ({ ...k, style: { ...k.style, bg: { a: '#1f1d2b99' }, glass: 6, texture: k === root.children[0] ? 'dots' : 'stripes' } }));
      p.bar = { root, theme: bar.theme };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '手机',
    device: 'phone',
    project: starter,
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '分页加古风皮肤',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      const layout = S.barTemplates.LAYOUTS.find((l) => l.key === 'tabs').make(p.vars);
      const skin = S.barTemplates.SKINS.find((s) => s.name === '古风');
      const out = S.barTemplates.applySkin(layout, S.bar.defaultTheme(), skin);
      p.bar = { root: out.root, theme: out.theme };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '自由摆放加形状',
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      const v = (...path) => {
        let list = p.vars;
        let x;
        for (const n of path) {
          x = list.find((y) => y.name === n);
          list = x.children ?? [];
        }
        return { var: x.id };
      };
      const shape = (k, d) => S.shape.SHAPE_PRESETS.find((s) => s.key === k).make(d);
      const free = {
        id: 'free',
        type: 'box',
        dir: 'free',
        freeW: 520,
        freeH: 190,
        stackBelow: 300,
        style: { bg: { a: '@card', b: '@bg', angle: 135 }, shape: shape('cut', 14), borderW: 1, borderColor: '@accent', pad: 12, enter: 'up' },
        children: [
          { id: 't', type: 'text', text: '白娅', at: { x: 0, y: 0, w: 200 }, style: { size: 20, bold: true, textGrad: { a: '@accent', b: '@accent2', angle: 90 }, ls: 2 } },
          { id: 'tm', type: 'value', bind: v('世界', '时间'), label: '', pill: true, at: { x: 380, y: 2, w: 116 }, style: { align: 'right' } },
          { id: 'ring', type: 'bar', bind: v('角色名', '好感度'), barLook: 'ring', height: 86, label: '', num: 'inside', at: { x: 0, y: 44, w: 100, h: 100 } },
          { id: 'hex', type: 'value', bind: v('角色名', '心情'), label: '心情', stack: true, at: { x: 120, y: 50, w: 150, h: 70 }, style: { shape: shape('hex', 18), bg: { a: '@line' }, pad: 10, align: 'center', glow: '@accent', glowR: 6 } },
          { id: 'say', type: 'value', bind: v('角色名', '当前想法'), label: '在想', at: { x: 290, y: 60, w: 206 }, style: { size: 13 } },
          { id: 'line', type: 'bar', bind: v('角色名', '好感度'), barLook: 'seg', count: 10, height: 8, label: '', num: 'none', at: { x: 120, y: 140, w: 376 } },
        ],
      };
      const bar = S.bar.defaultBar(p.vars);
      p.bar = { root: { id: 'root', type: 'box', dir: 'col', children: [free] }, theme: { ...bar.theme, ...S.bar.THEME_PRESETS.find((t) => t.name === '暗金')?.colors } };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '自由摆放加形状（手机，窄了改上下排）',
    device: 'phone',
    project: (name) => window.__e2eFree(name),
    setup: async (studio) => studio.evaluate((src) => void (window.__e2eFree = (0, eval)('(' + src + ')')), CASES.find((c) => c.name === '自由摆放加形状').project.toString()),
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  { name: '主题 Azure（气泡、长方头像、文字阴影、半透明）', look: { theme: 'Azure' }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '主题 Cappuccino', look: { theme: 'Cappuccino' }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '主题 Celestial Macaron（聊天栏 58%）', look: { theme: 'Celestial Macaron' }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '主题 Dark V 1.0（聊天栏 55%）', look: { theme: 'Dark V 1.0' }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '文档样式', look: { theme: 'Dark Lite', extra: { chat_display: 2 } }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '字号 1.2', look: { theme: 'Dark Lite', extra: { font_scale: 1.2 } }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  { name: '手机字号 1.2（名字那行折成两行）', device: 'phone', look: { theme: 'Dark Lite', extra: { font_scale: 1.2 } }, project: starter, user: '我推门进来，向她点点头。', reply: REPLY },
  {
    name: '主题 Azure + 纯文字状态栏（手机）',
    device: 'phone',
    look: { theme: 'Azure' },
    project: (name) => {
      const S = window.__studio;
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。'] };
      p.vars = S.templates.starterVars();
      p.textBar = { on: true, title: '状态' };
      return p;
    },
    user: '我推门进来，向她点点头。',
    reply: REPLY,
  },
  {
    name: '自带前端状态栏的卡',
    project: (name) => {
      const S = window.__studio;
      const rx = (id, scriptName, findRegex, replaceString, o = {}) => ({
        id, scriptName, findRegex, replaceString, trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...o,
      });
      const card = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        name,
        data: {
          name,
          description: '酒馆的看板娘白娅。',
          first_mes: '夕阳从酒馆的窗子斜照进来，白娅擦着杯子，抬头看了你一眼。\n\n<StatusPlaceHolderImpl/>',
          alternate_greetings: [],
          extensions: {
            regex_scripts: [
              rx('a1', '隐藏变量更新', '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm', '', { markdownOnly: true }),
              rx('a2', '对 AI 隐藏状态栏', '<StatusPlaceHolderImpl/>', '', { promptOnly: true }),
              rx('a3', '状态栏', '<StatusPlaceHolderImpl/>', window.__e2eOwnBar, { markdownOnly: true }),
            ],
            tavern_helper: {
              scripts: [{ type: 'script', id: 's1', name: 'MVU', enabled: true, content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';", info: '', button: { enabled: false, buttons: [] }, data: {} }],
              variables: {},
            },
          },
          character_book: {
            name: name + '的书',
            entries: [
              { id: 0, keys: [], comment: '[InitVar]初始化', content: '白娅:\n  好感度: 12\n  心情: 平静\n世界:\n  时间: 傍晚\n', enabled: false, constant: false, extensions: {} },
              { id: 1, keys: [], comment: '世界观', content: '小镇上的一家酒馆。', enabled: true, constant: true, extensions: { position: 0 } },
            ],
          },
        },
      };
      return S.mvuCard.importCard(card).project;
    },
    setup: async (studio) => studio.evaluate((bar) => void (window.__e2eOwnBar = bar), OWN_BAR),
    user: '我推门进来，向她点点头。',
    reply:
      '白娅放下杯子，朝你笑了笑："今天来得挺早。"\n\n' +
      UPDATE('打招呼', [
        { op: 'delta', path: '/白娅/好感度', value: 6 },
        { op: 'replace', path: '/白娅/心情', value: '开心' },
        { op: 'replace', path: '/世界/时间', value: '夜晚' },
      ]),
  },
];
