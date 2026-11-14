// The status bar page's helpers (M10), end to end in a real browser: colors used lately, the warning about words
// that are hard to read, palettes from the avatar, 我的组件 / 我的模板 between two cards, the picture of the status
// bar, and the guide for a first visit.
//
//   npm run dev            (in another terminal)
//   node e2e/studio-tools.mjs
//
// Uses the Chrome installed on this computer (playwright-core). STUDIO_URL changes the address.
import { chromium } from 'playwright-core';
import { strict as assert } from 'node:assert';

const URL = process.env.STUDIO_URL ?? 'http://localhost:1420/';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}\n    ${String(e.message ?? e).split('\n').slice(0, 6).join('\n    ')}`);
  }
};

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
// a returning user: the first-visit guide is checked on its own below
await page.addInitScript(() => {
  try {
    localStorage.setItem('stbs-tour-done', '1');
  } catch {}
});
page.on('pageerror', (e) => console.log('页面报错：', e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__studio);

/**
 * Opens a new card on the status bar page: the starter variables (ids made new each time, like another card),
 * `bar(S, p)` may give it its own status bar.
 */
const openCard = (name, extra = {}) =>
  page.evaluate(
    async ({ name, extra }) => {
      const S = window.__studio;
      if (S.useMode.getState().mode !== 'mvu') S.useMode.getState().setMode('mvu');
      await new Promise((r) => setTimeout(r, 300));
      const p = S.mvuCard.newCardProject();
      p.card = { ...p.card, name, greetings: ['夕阳从酒馆的窗子斜照进来。'] };
      p.vars = S.templates.starterVars();
      if (extra.avatar) {
        const c = document.createElement('canvas');
        c.width = 120;
        c.height = 120;
        const g = c.getContext('2d');
        g.fillStyle = '#203050';
        g.fillRect(0, 0, 120, 120);
        g.fillStyle = '#e06080';
        g.fillRect(30, 30, 60, 60);
        p.avatar = c.toDataURL('image/png').split(',')[1];
      }
      if (extra.lowText) {
        const bar = S.bar.defaultBar(p.vars);
        p.bar = { theme: bar.theme, root: { ...bar.root, children: [{ id: 'low', type: 'text', text: '看不清的字', style: { color: '#2b2938', bg: { a: '@card' } } }, ...bar.root.children] } };
      }
      S.useCard.getState().load(p, null);
      S.useCard.setState({ tab: 'bar', barSel: null, rightView: 'canvas' });
      return p.vars;
    },
    { name, extra },
  );
const idOf = (vars, ...path) => {
  let list = vars;
  let v;
  for (const n of path) {
    v = list.find((x) => x.name === n);
    list = v.children ?? [];
  }
  return v.id;
};
const project = () => page.evaluate(() => window.__studio.useCard.getState().project);

await check('取色器记住最近自己挑的颜色', async () => {
  await openCard('甲');
  const root = await page.evaluate(() => window.__studio.bar.barOf(window.__studio.useCard.getState().project).root.children[0].id);
  await page.evaluate((id) => window.__studio.useCard.setState({ barSel: id }), root);
  const field = page.locator('.field').filter({ hasText: /^背景/ }).first();
  await field.locator('.cbtn').first().click();
  await page.locator('.cpop input[type=color]').first().fill('#ff3366');
  await page.getByRole('button', { name: '好了' }).first().click();
  await field.locator('.cbtn').first().click();
  const recent = await page.locator('.cpop .csws.recent .csw').evaluateAll((l) => l.map((e) => e.title));
  assert.ok(recent.includes('#ff3366'), '最近用过里没有：' + recent.join(' '));
  await page.getByRole('button', { name: '好了' }).first().click();
});

await check('画布提醒看不清的字，点一下选中它', async () => {
  await openCard('乙', { lowText: true });
  const warn = page.locator('.cv-low .link');
  await warn.waitFor({ timeout: 8000 });
  assert.match(await warn.textContent(), /有 1 处/);
  await warn.click();
  await page.locator('.cv-low-list button').first().click();
  assert.equal(await page.evaluate(() => window.__studio.useCard.getState().barSel), 'low');
});

await check('从头像取色：配成一深一浅两套，点一下就用', async () => {
  await openCard('丙', { avatar: true });
  await page.getByRole('button', { name: '从头像取色' }).click();
  await page.getByRole('button', { name: '头像·浅色' }).click();
  const t = (await project()).bar.theme;
  assert.equal(t.preset, '头像·浅色');
  assert.ok(/^#f/.test(t.bg) || /^#e/.test(t.bg), '浅色的底不浅：' + t.bg);
});

await check('我的组件：存下来，在另一张卡里放进去，变量按名字对上', async () => {
  const a = await openCard('丁');
  const bar = await page.evaluate(() => window.__studio.bar.barOf(window.__studio.useCard.getState().project).root);
  // the card for 角色名 (it holds the 好感度 bar)
  const box = bar.children.find((k) => JSON.stringify(k).includes(idOfIn(a, '角色名', '好感度')));
  await page.evaluate((id) => window.__studio.useCard.setState({ barSel: id }), box.id);
  await page.getByRole('button', { name: '存为我的组件' }).click();
  assert.equal(await page.evaluate(() => window.__studio.useLibrary.getState().parts.length), 1);
  const b = await openCard('戊');
  await page.locator('.pal-mine .pal').first().click();
  const root = (await project()).bar.root;
  const added = root.children[root.children.length - 1];
  assert.ok(JSON.stringify(added).includes(idOfIn(b, '角色名', '好感度')), '没对上新卡的好感度');
  assert.ok(!JSON.stringify(added).includes(idOfIn(a, '角色名', '好感度')), '还连着旧卡的变量');
});

await check('我的模板：整个状态栏带配色存下来，别的卡一键用上', async () => {
  const a = await openCard('己');
  await page.evaluate(() => window.__studio.useCard.getState().editBar((b) => ({ ...b, theme: { ...b.theme, preset: '赛博', accent: '#00e5ff' } })));
  await page.getByRole('button', { name: '把现在的存成模板' }).click();
  const b = await openCard('庚');
  await page.locator('.pal-mine button.small').first().click();
  await page.getByRole('button', { name: '用', exact: true }).click();
  const bar = (await project()).bar;
  assert.equal(bar.theme.accent, '#00e5ff');
  assert.ok(JSON.stringify(bar.root).includes(idOfIn(b, '角色名', '好感度')));
  assert.ok(!JSON.stringify(bar.root).includes(idOfIn(a, '角色名', '好感度')));
});

await check('状态栏存成图片：按玩家看到的样子，两倍大', async () => {
  await openCard('辛');
  await page.waitForTimeout(1500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: '📷 存成图片' }).click()]);
  const file = await dl.path();
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const msgW = await page.locator('.cv-scaled iframe').evaluate((f) => f.getBoundingClientRect().width / parseFloat(getComputedStyle(f.parentElement).transform.split(',')[0].replace('matrix(', '') || '1'));
  assert.ok(Math.abs(w - (Math.round(msgW) + 24) * 2) <= 4, `图宽 ${w}，消息宽 ${msgW}`);
  assert.ok(h > 200, '图太矮：' + h);
});

await check('第一次打开带着走一遍，看完记住，「？」能再看', async () => {
  const fresh = await ctx.newPage();
  await fresh.addInitScript(() => {
    try {
      localStorage.removeItem('stbs-tour-done');
    } catch {}
  });
  await fresh.goto(URL);
  await fresh.waitForFunction(() => !!window.__studio);
  const bubble = fresh.locator('.tour-bubble');
  await bubble.waitFor({ timeout: 8000 });
  assert.match(await bubble.locator('.tour-title').textContent(), /变量/);
  for (let i = 0; i < 5; i++) await fresh.getByRole('button', { name: '下一步' }).click();
  assert.match(await bubble.locator('.tour-title').textContent(), /还有/);
  await fresh.getByRole('button', { name: '知道了' }).click();
  assert.equal(await bubble.count(), 0);
  assert.equal(await fresh.evaluate(() => localStorage.getItem('stbs-tour-done')), '1');
  await fresh.getByRole('button', { name: '？' }).click();
  await bubble.waitFor({ timeout: 3000 });
  await fresh.getByRole('button', { name: '跳过' }).click();
  await fresh.close();
});

function idOfIn(vars, ...path) {
  return idOf(vars, ...path);
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
