// 点选修改, end to end in a real browser: clicking inside a front-end card (regex mode and an imported MVU card's
// own status bar), changing one element, and changing a whole <style> rule (「改所有同类」).
//
//   npm run dev            (in another terminal)
//   node e2e/studio-pick.mjs
//
// Uses the Chrome installed on this computer (playwright-core, no browser download). STUDIO_URL changes the address.
import { chromium } from 'playwright-core';
import { strict as assert } from 'node:assert';

const URL = process.env.STUDIO_URL ?? 'http://localhost:1420/';

const BAR = [
  '```html',
  '<body>',
  '<style>.sb{background:linear-gradient(135deg,#1e2a44,#3a2350);border:1px solid #c79bff;border-radius:12px;padding:10px 14px;color:#f4ecff;font-size:14px}.sb .hd{color:#ffd27a;font-weight:bold;margin-bottom:6px}.sb .it{display:flex;justify-content:space-between;padding:3px 0}</style>',
  '<div class="sb">',
  '  <div class="hd">❀ 白娅的状态 ❀</div>',
  '  <div class="it"><span>好感度</span><span id="fav">--</span></div>',
  '  <div class="it"><span>心情</span><span id="mood">--</span></div>',
  '</div>',
  '<script>',
  '(async function(){await waitGlobalInitialized("Mvu");var d=getVariables({type:"message",message_id:getCurrentMessageId()}).stat_data||{};document.getElementById("fav").textContent=d["好感度"];document.getElementById("mood").textContent=d["心情"];})();',
  '</script>',
  '</body>',
  '```',
].join('\n');

const CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  name: '白娅',
  data: {
    name: '白娅',
    first_mes: '白娅抬起头看着你。',
    alternate_greetings: [],
    extensions: {
      regex_scripts: [{ id: 'bar1', scriptName: '白娅状态栏', findRegex: '<StatusPlaceHolderImpl/>', replaceString: BAR, placement: [2], markdownOnly: true }],
      tavern_helper: { scripts: [], variables: {} },
    },
    character_book: { name: '白娅', entries: [{ id: 0, keys: [], comment: '[initvar]变量初始化勿开', content: '好感度: 35\n心情: 平静', enabled: false, constant: false, insertion_order: 100, extensions: {} }] },
  },
};

/** A row of the pick panel by its label (exactly). */
const row = (scope, label) => scope.locator('.pick-row').filter({ has: scope.page().locator('.pick-label', { hasText: new RegExp('^' + label + '$') }) });

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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
// a 1280 screen (chat column 640) fits the preview panel unscaled: clicks can't reach into a scaled frame
await page.addInitScript(() => {
  try {
    localStorage.setItem('stbs-desktop', '0');
  } catch {}
});
page.on('pageerror', (e) => console.log('页面报错：', e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__studio);

/* ---------- MVU card: the card's own status bar ---------- */
await page.evaluate(async (card) => {
  const s = window.__studio;
  if (s.useMode.getState().mode !== 'mvu') s.useMode.getState().setMode('mvu');
  await new Promise((r) => setTimeout(r, 500));
  const r = s.mvuCard.importCard(card);
  s.useCard.getState().load(r.project, null, r.notes);
  s.useCard.setState({ tab: 'bar', rightView: 'chat' });
}, CARD);

const preview = page.locator('.mvu-preview');
const cardFrame = () => preview.frameLocator('iframe').first().frameLocator('iframe.th').first();
const cardSrc = () => page.evaluate(() => window.__studio.mvuCard.cardRegexes(window.__studio.useCard.getState().project)[0].replaceString);

await check('MVU：导入的卡自带的状态栏有「点选修改」', async () => {
  await preview.getByRole('button', { name: '✎ 点选修改' }).click();
  await cardFrame().getByText('好感度', { exact: true }).waitFor({ timeout: 15000 });
});

await check('MVU：点卡片里的元素能选中，面板显示它', async () => {
  await cardFrame().getByText('❀ 白娅的状态 ❀').click();
  await preview.locator('.pick-panel').waitFor({ timeout: 5000 });
  assert.match(await preview.locator('.pick-head').innerText(), /白娅的状态/);
});

await check('MVU：改文字写回卡自己的正则', async () => {
  const box = row(preview, '文字').locator('textarea');
  await box.fill('✿ 白娅 · 今日状态 ✿');
  await page.waitForTimeout(400);
  assert.match(await cardSrc(), /<div class="hd">✿ 白娅 · 今日状态 ✿<\/div>/);
  // the preview is drawn again with the new text: wait for it before clicking on
  await cardFrame().getByText('✿ 白娅 · 今日状态 ✿').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
});

await check('MVU：点一行，能选「改所有 .sb .it」，改了写进 <style> 规则', async () => {
  await cardFrame().getByText('心情', { exact: true }).click();
  await page.waitForTimeout(300);
  // the row's span was picked: go out one level to the row
  await preview.locator('.pick-head').getByRole('button', { name: '外层' }).click();
  await preview.locator('.pick-head code').filter({ hasText: '<div>' }).waitFor({ timeout: 5000 });
  const chip = row(preview, '改哪里').getByRole('button', { name: /\.sb \.it · 2 个/ });
  await chip.click();
  const bg = row(preview, '背景').locator('input:not([type=color])');
  await bg.fill('#334455');
  await bg.press('Enter');
  await page.waitForTimeout(400);
  const src = await cardSrc();
  assert.match(src, /\.sb \.it\{display:flex;justify-content:space-between;padding:3px 0;background:#334455\}/);
  assert.doesNotMatch(src, /class="it" style=/);
});

await check('MVU：改完预览里两行都变了', async () => {
  await page.waitForTimeout(1200);
  const bgs = await cardFrame().locator('.it').evaluateAll((l) => l.map((e) => getComputedStyle(e).backgroundColor));
  assert.deepEqual(bgs, ['rgb(51, 68, 85)', 'rgb(51, 68, 85)']);
});

await check('MVU：撤销一步回到改规则之前', async () => {
  await page.evaluate(() => window.__studio.useCard.getState().undo());
  assert.doesNotMatch(await cardSrc(), /#334455/);
});

/* ---------- regex mode: a front-end card ---------- */
await page.evaluate(async () => {
  const s = window.__studio;
  s.useMode.getState().setMode('regex');
  await new Promise((r) => setTimeout(r, 500));
  const card = [
    '```html',
    '<html><head><style>.box{background:#2a2440;border-radius:10px;padding:10px;color:#eee}.tag{background:#6b4fe0;color:#fff;padding:2px 8px;border-radius:99px}</style></head><body>',
    '<div class="box">',
    '  <span class="tag">时间：$1</span>',
    '  <span class="tag">地点：$2</span>',
    '</div>',
    '</body></html>',
    '```',
  ].join('\n');
  const sc = s.importer.normalizeScript({ scriptName: '测试前端卡', findRegex: '/<状态栏>时间：(.*?)\\n地点：(.*?)<\\/状态栏>/s', replaceString: card, placement: [2] });
  s.useStore.getState().appendScripts([sc]);
  s.useStore.getState().setText('推开酒馆的门……\n\n<状态栏>时间：黄昏\n地点：酒馆</状态栏>');
  s.useStore.getState().select(sc.id);
  s.useStore.getState().setPreviewTab('render');
});
const rpv = page.locator('section.preview').first();
const regexFrame = () => rpv.frameLocator('iframe').first().frameLocator('iframe.th').first();
const regexSrc = () => page.evaluate(() => {
  const st = window.__studio.useStore.getState();
  return st.project.scripts.find((x) => x.id === st.selectedId).replaceString;
});

await check('正则：前端卡不再被拒，能点进去', async () => {
  await rpv.getByRole('button', { name: '✎ 点选修改' }).click();
  await regexFrame().getByText('时间：黄昏').click({ timeout: 15000 });
  await rpv.locator('.pick-panel').waitFor({ timeout: 5000 });
  assert.match(await row(rpv, '文字').innerText(), /\$1/);
});

await check('正则：只改这一个 → 写进元素自己的 style', async () => {
  const bg = row(rpv, '背景').locator('input:not([type=color])');
  await bg.fill('#c0392b');
  await bg.press('Enter');
  await page.waitForTimeout(300);
  assert.match(await regexSrc(), /<span class="tag" style="background: #c0392b">时间：\$1<\/span>/);
});

await check('正则：改所有 .tag → 写进 <style>', async () => {
  await row(rpv, '改哪里').getByRole('button', { name: /^\.tag · 2 个/ }).click();
  const color = row(rpv, '文字颜色').locator('input:not([type=color])');
  await color.fill('gold');
  await color.press('Enter');
  await page.waitForTimeout(300);
  assert.match(await regexSrc(), /\.tag\{background:#6b4fe0;color:gold;/);
});

/* ---------- the preview changing size: like TavernHelper, the cards follow without being loaded again ---------- */
await check('窗口变高：卡片的 min-height: 50vh 跟着变，卡片没有重新载入', async () => {
  await rpv.getByRole('button', { name: '✎ 点选修改' }).click();
  await page.evaluate(() => {
    const s = window.__studio;
    const sc = s.importer.normalizeScript({
      scriptName: '跟着窗口高',
      findRegex: '/<高>/g',
      replaceString: '```html\n<body><div id="tall" style="min-height:50vh;background:#334">半屏高</div></body>\n```',
      placement: [2],
    });
    s.useStore.getState().appendScripts([sc]);
    s.useStore.getState().setText('<高>');
    s.useStore.getState().select(sc.id);
  });
  const tall = regexFrame().locator('#tall');
  await tall.waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await tall.evaluate(() => void (window.__same = 1));
  const before = await tall.evaluate((e) => e.getBoundingClientRect().height);
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.waitForTimeout(1500);
  const after = await tall.evaluate((e) => e.getBoundingClientRect().height);
  assert.equal(await tall.evaluate(() => window.__same ?? 0), 1, '卡片被重新载入了');
  assert.ok(after < before - 50, `高度没跟着变：${before} → ${after}`);
  await page.setViewportSize({ width: 1600, height: 1000 });
});

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
