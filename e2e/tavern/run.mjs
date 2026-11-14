// Real SillyTavern vs the studio's preview. For each case: the studio builds a card, a test SillyTavern (with
// TavernHelper) imports it and opens a chat; the greeting, and then a reply from a stand-in AI, are compared with the
// studio's preview of the same card and text: what MVU stored against the studio's simulation, and both messages
// photographed and compared pixel by pixel (e2e/out/<case>/).
//
// Needs: a test SillyTavern with TavernHelper (ST_URL, default http://127.0.0.1:8001) and the studio dev server
// (STUDIO_URL, default http://localhost:1420). Uses the Chrome installed on this computer.
//
//   node e2e/tavern/run.mjs [case name …]
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startFakeAi } from './fake-ai.mjs';
import { closeDrawers, configure, importCard, messageVars, openCharacter, readLook, removeCharacters, restoreLook, send, setLook, stSession, swipeGreeting } from './st.mjs';
import { CASES } from './cases.mjs';
import { clearBackground, setBackground, testBackground } from './bg.mjs';
import { diffPng } from './diff.mjs';

const ST = process.env.ST_URL ?? 'http://127.0.0.1:8001';
const STUDIO = process.env.STUDIO_URL ?? 'http://localhost:1420/';
const OUT = new URL('../out/', import.meta.url);
const PREFIX = 'E2E ';
const only = process.argv.slice(2);

/** The browsers the cases run in: a computer, or a phone (SillyTavern's mobile layout). Both Chinese, like the players'. */
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  },
};

const ai = await startFakeAi(Number(process.env.FAKE_AI_PORT ?? 8790));
const st = await stSession(ST);
await configure(st, ai.url);
// the look a new SillyTavern has; cases with a `look` change it, the others (and the end) put it back
const baseLook = await readLook(st);
await removeCharacters(st, PREFIX);
await clearBackground(st);
// the background picture for the cases with one (`bg`), as SillyTavern gets it and as the studio's preview gets it
const BG = testBackground();
const BG_URL = 'data:image/png;base64,' + Buffer.from(BG).toString('base64');

// On a computer scrollbars are shown, like Chrome on Windows (SillyTavern's chat always has one, and it takes room).
// On a phone they float over the page and take none, as headless Chrome has them; and a phone never draws text with
// coloured (LCD) edges, while Chrome on Windows does it for some parts of a page and not others, depending on how it
// happens to split the page into layers, so the phone browser draws all text grey-edged, like a phone.
const launch = (phone) =>
  chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    args: ['--proxy-bypass-list=127.0.0.1;localhost', ...(phone ? ['--disable-lcd-text'] : [])],
    ...(phone ? {} : { ignoreDefaultArgs: ['--hide-scrollbars'] }),
  });
const browsers = { desktop: await launch(false), phone: await launch(true) };
/**
 * The studio, once as on a computer and once as on a phone: Chrome draws text differently on a phone (no colored
 * sub-pixel edges), so the preview is photographed the way SillyTavern is for the case.
 */
async function openStudio(phone) {
  const ctx = await browsers[phone ? 'phone' : 'desktop'].newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  await page.goto(STUDIO);
  await page.waitForFunction(() => !!window.__studio);
  const missing = await page.evaluate(() => window.__studio.previewAssets.loadPreviewAssets());
  if (missing.length) throw new Error('工坊没能载入预览要用的东西：' + missing.join('；'));
  return page;
}
const studios = { desktop: await openStudio(false), phone: await openStudio(true) };
const studio = studios.desktop;

/** Measures a message's text box and what is in it (for the log, to see where a difference comes from). */
const layout = (e) => {
  const box = (x) => {
    if (!x) return null;
    const r = x.getBoundingClientRect();
    const c = getComputedStyle(x);
    return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), pad: c.padding, margin: c.margin, font: `${c.fontSize}/${c.lineHeight} ${c.fontWeight} ${c.fontFamily.slice(0, 40)}` };
  };
  return { mes_text: box(e), frame: box(e.querySelector('iframe')), p: box(e.querySelector('p')) };
};

/** A message's HTML with each front-end card's frame left out (what is around them has to match exactly). */
const textHtml = (e) => {
  const c = e.cloneNode(true);
  for (const x of c.querySelectorAll('.TH-render')) x.replaceWith('[前端卡]');
  return c.innerHTML.replace(/\s+/g, ' ').trim();
};

/**
 * Shows a message in the studio's preview the way the preview panel does (a sandboxed frame as wide as SillyTavern's
 * chat column) and photographs its text. `steps`: the AI replies so far (none = the greeting).
 */
async function studioShot(project, { steps, own, greeting, device, look, where, file }) {
  const studio = studios[device];
  const pv = await studio.evaluate(
    async ({ p, steps, own, greeting, device, look, where }) => {
      const { width, left, height, win } = where;
      const S = window.__studio;
      const sim = S.sim.simulate(p.vars, steps, {}, own);
      const settings = S.preview.previewSettings(p.card.name, device, look);
      const regexes = S.preview.previewRegexes(p);
      const reply = steps.length > 0;
      const text = reply ? steps[steps.length - 1] : greeting;
      // like the preview panel: under a greeting the bar shows only when the card puts MVU's placeholder there
      const page = S.preview.previewPage(regexes, text, settings, 800, { stat: sim.data, prev: sim.before, ...S.preview.cardExtras(p), win }, reply || S.mvuCard.barOnGreeting(p));
      document.getElementById('e2e-host')?.remove();
      const host = document.createElement('div');
      host.id = 'e2e-host';
      // where SillyTavern's chat column is, to the fraction of a pixel (text is drawn a little differently otherwise)
      host.style.cssText = `position:fixed;left:${left}px;top:0;z-index:99999;background:#000`;
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
      f.style.cssText = `width:${width}px;height:${height}px;border:0;display:block`;
      f.srcdoc = page.html;
      host.appendChild(f);
      document.body.appendChild(host);
      return { data: sim.data, results: sim.results, readErrors: sim.readErrors, display: page.display };
    },
    { p: project, steps, own, greeting, device, look, where },
  );
  await studio.waitForTimeout(3000);
  const mes = studio.frameLocator('#e2e-host iframe').locator('.mes_text');
  // and the message just where it is in SillyTavern's chat, to the fraction of a pixel (lines 23.8px apart land on
  // other rows; the background picture stays put while the chat scrolls)
  await mes.evaluate(runAlign, { at: where.at, src: alignTo.toString() }).catch(() => {});
  await studio.waitForTimeout(200);
  await mes.screenshot({ path: file }).catch(() => {});
  pv.html = await mes.innerHTML().catch(() => '');
  pv.text = await mes.evaluate(textHtml).catch((e) => e.message);
  pv.frames = await frameTexts(mes);
  pv.layout = await mes.evaluate(layout).catch((e) => e.message);
  return pv;
}

/**
 * The studio's preview of the whole chat (the greeting, then what the player said and each reply), in a frame as wide
 * as SillyTavern's chat column, like the preview panel shows it.
 */
async function studioChat(project, { replies, users, own, greeting, device, look, where }) {
  const studio = studios[device];
  const floors = await studio.evaluate(
    ({ p, replies, users, own, greeting, device, look, where }) => {
      const { width, left, height, win } = where;
      const S = window.__studio;
      const sim = S.sim.simulate(p.vars, replies, {}, own);
      const settings = S.preview.previewSettings(p.card.name, device, look);
      const floors = S.preview.simFloors({ greeting, barOnGreeting: S.mvuCard.barOnGreeting(p), start: sim.start, replies, users, after: sim.after });
      const page = S.preview.previewChat(S.preview.previewRegexes(p), floors, settings, 800, { ...S.preview.cardExtras(p), bottom: true, win });
      document.getElementById('e2e-host')?.remove();
      const host = document.createElement('div');
      host.id = 'e2e-host';
      host.style.cssText = `position:fixed;left:${left}px;top:0;z-index:99999;background:#000`;
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
      f.style.cssText = `width:${width}px;height:${height}px;border:0;display:block`;
      f.srcdoc = page.html;
      host.appendChild(f);
      document.body.appendChild(host);
      return floors.map((x) => x.stat ?? null);
    },
    { p: project, replies, users, own, greeting, device, look, where },
  );
  await studio.waitForTimeout(2000);
  const frame = studio.frameLocator('#e2e-host iframe');
  await settle(frame);
  return { floors, frame };
}

/**
 * Waits until the front-end cards in a chat have their heights and the chat has stopped growing (at most `ms`): with
 * many cards loading at once some take a few seconds.
 */
async function settle(frame, ms = 20000) {
  const end = Date.now() + ms;
  let last = '';
  let same = 0;
  while (Date.now() < end) {
    const now = await frame
      .locator('#chat')
      .evaluate((c) => [...c.querySelectorAll('iframe')].map((f) => f.getBoundingClientRect().height).join(',') + '|' + c.scrollHeight)
      .catch(() => '');
    same = now && now === last ? same + 1 : 0;
    last = now;
    if (same >= 4) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Where each message of a chat is, from the first one's top, and how tall (to see the gaps between messages). */
const chatLayout = (chat) =>
  [...chat.querySelectorAll('.mes')].map((m) => {
    const top = chat.querySelector('.mes').getBoundingClientRect().top;
    const r = m.getBoundingClientRect();
    const t = m.querySelector('.mes_text').getBoundingClientRect();
    return { top: Math.round((r.top - top) * 10) / 10, h: Math.round(r.height * 10) / 10, text: Math.round((t.top - r.top) * 10) / 10 };
  });

/**
 * Puts a message of the studio's chat page where it is in SillyTavern's chat (`at.top`: px below the chat's top;
 * `at.left`: its left, mod 1), to the fraction of a pixel: the chat's content is moved down (padding) or scrolled up,
 * and the chat moved sideways by the fraction (a frame itself sits on whole pixels). The chat box stays where it is, so
 * a background picture behind it lines up too.
 */
const alignTo = (e, at) => {
  const doc = e.ownerDocument;
  const chat = doc.getElementById('chat');
  doc.body.style.marginTop = '0px';
  chat.style.position = 'relative';
  chat.style.left = '0px';
  chat.style.paddingTop = '0px';
  chat.style.paddingBottom = '3000px';
  chat.scrollTop = 0;
  const c = chat.getBoundingClientRect();
  const r = e.getBoundingClientRect();
  const shift = at.top - (r.top - c.top);
  const scroll = Math.max(0, Math.ceil(-shift));
  chat.style.paddingTop = shift + scroll + 'px';
  chat.scrollTop = scroll;
  chat.style.left = ((((at.left - r.left) % 1) + 1) % 1) + 'px';
};

/**
 * The rows of a message SillyTavern's chat shows (after photographing it, as it is scrolled then): a message taller
 * than the chat is cut off by its edge, and the photo shows the input box (or the studio's page) past it. Undefined
 * when all of it shows.
 */
const visibleRows = (mes) =>
  mes.evaluate((e) => {
    const c = document.getElementById('chat').getBoundingClientRect();
    const r = e.getBoundingClientRect();
    const from = Math.max(0, c.top - r.top);
    const to = Math.min(r.height, c.bottom - r.top);
    return from > 0.5 || to < r.height - 0.5 ? [from, to] : undefined;
  });

/**
 * Where a message of SillyTavern's chat is (call it after photographing it, as it is scrolled then): the chat column
 * (its width, its left mod 1, the chat's height), the window around it, and the message within the chat.
 */
const stWhere = (mes) =>
  mes.evaluate((e) => {
    const chat = document.getElementById('chat').getBoundingClientRect();
    const sheld = document.getElementById('sheld').getBoundingClientRect();
    const r = e.getBoundingClientRect();
    return {
      width: sheld.width,
      left: sheld.left - Math.floor(sheld.left),
      height: chat.height,
      win: { w: innerWidth, h: innerHeight, x: chat.left, y: chat.top },
      at: { top: r.top - chat.top, left: r.left % 1 },
    };
  });

/** Runs alignTo inside the studio's chat page (it is sent there as text). */
const runAlign = (e, { at, src }) => (0, eval)('(' + src + ')')(e, at);

/** The text shown inside each front-end card frame of a message (what the status bar says, value by value). */
async function frameTexts(mes) {
  const out = [];
  for (const h of await mes.locator('iframe').elementHandles()) {
    const f = await h.contentFrame();
    out.push(f ? await f.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()).catch((e) => '读不出：' + e.message) : '（没有内容）');
  }
  return out;
}

/** Where two texts start to differ, with a little around it. */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { 酒馆: a.slice(Math.max(0, i - 60), i + 120), 工坊: b.slice(Math.max(0, i - 60), i + 120) };
}

const report = [];
for (const c of CASES.filter((x) => !only.length || only.includes(x.name))) {
  const log = [];
  const dir = new URL(encodeURIComponent(c.name) + '/', OUT);
  await mkdir(dir, { recursive: true });
  const file = (n) => fileURLToPath(new URL(n, dir));
  const r = { name: c.name, log, checks: [] };
  report.push(r);
  const check = (what, ok, detail) => r.checks.push({ what, ok: !!ok, ...(ok ? {} : { detail }) });
  const device = c.device ?? 'desktop';
  // the studio's look settings for the case's SillyTavern look ({ theme, extra }: a theme and power user settings)
  const look = {
    ...(c.look ? { stTheme: c.look.theme, chatStyle: c.look.extra?.chat_display, fontScale: c.look.extra?.font_scale, fastUi: c.look.extra?.fast_ui_mode } : {}),
    ...(c.bg ? { bg: BG_URL, bgFit: c.bg.fitting ?? 'classic' } : {}),
  };
  ai.queue.length = 0;
  const ctx = await browsers[device].newContext(DEVICES[device]);
  /** SillyTavern's message `id` against the studio's preview of the same: variables, then the picture. */
  const compare = async (page, id, tag, sim) => {
    const mes = page.locator(`#chat .mes[mesid="${id}"] .mes_text`);
    await mes.screenshot({ path: file(`st-${tag}.png`) }).catch((e) => log.push('截图失败：' + e.message));
    await writeFile(file(`st-${tag}.html`), await mes.innerHTML().catch(() => ''));
    const where = await stWhere(mes);
    const rows = await visibleRows(mes).catch(() => undefined);
    if (rows) log.push(`${tag}：比聊天栏高，只比看得见的 ${Math.round(rows[0])}–${Math.round(rows[1])} 行`);
    log.push(`酒馆尺寸（${tag}）：` + JSON.stringify(await mes.evaluate(layout).catch((e) => e.message)));
    const pv = await studioShot(c.projectData, { ...sim, device, look, where, file: file(`studio-${tag}.png`) });
    await writeFile(file(`studio-${tag}.html`), pv.html);
    log.push(`工坊尺寸（${tag}）：` + JSON.stringify(pv.layout));
    const stText = await mes.evaluate(textHtml).catch((e) => e.message);
    check(`${tag}：消息的 HTML（前端卡以外）和酒馆一字不差`, stText === pv.text, firstDiff(stText, pv.text));
    const stFrames = await frameTexts(mes);
    check(`${tag}：前端卡里显示的文字和酒馆一样`, isDeepStrictEqual(stFrames, pv.frames), { 酒馆: stFrames, 工坊: pv.frames });
    if (stFrames.length) log.push(`${tag}：前端卡里的文字：` + stFrames.map((t) => t.slice(0, 160)).join(' | '));
    const stVars = await messageVars(page, id);
    check(`${tag}：MVU 在酒馆里存的变量 = 工坊模拟的结果`, isDeepStrictEqual(stVars, pv.data), { 酒馆: stVars, 工坊: pv.data });
    const d = await diffPng(file(`st-${tag}.png`), file(`studio-${tag}.png`), file(`diff-${tag}.png`), { ignoreRight: 30, rows });
    log.push(`${tag}：${(d.ratio * 100).toFixed(2)}% 的像素不同（酒馆 ${d.sizeA.join('×')}，工坊 ${d.sizeB.join('×')}）`);
    // 1px either way: the same box starting at a different fraction of a pixel photographs one row taller
    const near = Math.abs(d.sizeA[0] - d.sizeB[0]) <= 1 && Math.abs(d.sizeA[1] - d.sizeB[1]) <= 1;
    check(`${tag}：和酒馆一样大（差不过 1px）`, near, { 酒馆: d.sizeA, 工坊: d.sizeB });
    check(`${tag}：看起来和酒馆一样（不同的像素 < 1%）`, d.ratio < 0.01, `${(d.ratio * 100).toFixed(2)}%，见 diff-${tag}.png`);
    return { stVars, pv };
  };
  try {
    // 1) the card, made by the studio
    if (c.setup) await c.setup(studio);
    const project = await studio.evaluate(c.project, PREFIX + c.name);
    c.projectData = project;
    const card = await studio.evaluate((p) => window.__studio.mvuCard.buildCard(p), project);
    await writeFile(new URL('card.json', dir), JSON.stringify(card, null, 2));

    // 2) into SillyTavern, open a chat (on the greeting the case starts from)
    if (c.look) await setLook(st, c.look.theme, c.look.extra);
    else await restoreLook(st, baseLook);
    if (c.bg) await setBackground(st, BG, 'e2e-test-bg.png', c.bg.fitting ?? 'classic');
    else await clearBackground(st);
    await importCard(st, card, 'e2e-' + c.name);
    const page = await ctx.newPage();
    // SillyTavern's pop-up notices (MVU says when it has set the variables up, or what went wrong) are written down
    // and kept off the screen, so they can't cover a message that is being photographed
    await page.addInitScript(() => {
      window.__toasts = [];
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '#toast-container{visibility:hidden!important}';
        document.head.appendChild(st);
        new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent.replace(/\s+/g, ' ').trim());
        }).observe(document.body, { childList: true, subtree: true });
      });
    });
    page.on('crash', () => log.push('酒馆页面崩溃了'));
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 300)));
    await openCharacter(page, ST, PREFIX + c.name, log);
    await page.waitForTimeout(5000);
    const g = c.greeting ?? 0;
    if (g > 0) await swipeGreeting(page, g, log);
    const own = project.card.greetingVars?.[g];
    const greeting = await compare(page, 0, '开场白', { steps: [], own, greeting: project.card.greetings[g] });
    log.push('开场白楼层的变量：' + JSON.stringify(greeting.stVars));

    // 3) rounds with the stand-in AI
    const replies = c.replies ?? (c.reply ? [c.reply] : []);
    let last = { id: 0, ...greeting };
    for (const [i, reply] of replies.entries()) {
      ai.queue.push(reply);
      const id = await send(page, (Array.isArray(c.user) ? c.user[i] : c.user) ?? '你好。');
      const tag = replies.length > 1 ? `回复${i + 1}` : '回复';
      last = { id, ...(await compare(page, id, tag, { steps: replies.slice(0, i + 1), own })) };
    }
    const prompt = ai.requests[ai.requests.length - 1];
    if (replies.length) await writeFile(new URL('prompt.json', dir), JSON.stringify(prompt, null, 2));

    // 4) the whole chat, opened again (every message drawn at the depth it has now), against the studio's chat preview
    if (c.wholeChat) {
      await page.evaluate(() => window.SillyTavern.getContext().reloadCurrentChat());
      await page.waitForTimeout(4000);
      await settle(page);
      await closeDrawers(page, log);
      const users = replies.map((_, i) => (Array.isArray(c.user) ? c.user[i] : c.user) ?? '你好。');
      const pv = await studioChat(project, { replies, users, own, greeting: project.card.greetings[g], device, look, where: await stWhere(page.locator('#chat .mes .mes_text').first()) });
      const n = await page.locator('#chat .mes').count();
      check('整段聊天：楼数和酒馆一样', n === pv.floors.length, { 酒馆: n, 工坊: pv.floors.length });
      const stLayout = await page.locator('#chat').evaluate(chatLayout);
      const pvLayout = await pv.frame.locator('#chat').evaluate(chatLayout);
      log.push('整段聊天，酒馆每楼的位置：' + JSON.stringify(stLayout));
      log.push('整段聊天，工坊每楼的位置：' + JSON.stringify(pvLayout));
      const near = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x.top - b[i].top) <= 1 && Math.abs(x.h - b[i].h) <= 1 && Math.abs(x.text - b[i].text) <= 1);
      check('整段聊天：每楼的位置、高度和酒馆一样（差不过 1px）', near(stLayout, pvLayout), { 酒馆: stLayout, 工坊: pvLayout });
      await page.locator('#chat').screenshot({ path: file('st-整段聊天.png') }).catch(() => {});
      await pv.frame.locator('#chat').screenshot({ path: file('studio-整段聊天.png') }).catch(() => {});
      for (let i = 0; i < Math.min(n, pv.floors.length); i++) {
        const tag = `第${i}楼`;
        const stMes = page.locator(`#chat .mes[mesid="${i}"] .mes_text`);
        const pvMes = pv.frame.locator(`.mes[mesid="${i}"] .mes_text`);
        await stMes.scrollIntoViewIfNeeded().catch(() => {});
        await stMes.screenshot({ path: file(`st-${tag}.png`) }).catch((e) => log.push('截图失败：' + e.message));
        const { at } = await stWhere(stMes).catch(() => ({ at: { top: 0, left: 0 } }));
        const rows = await visibleRows(stMes).catch(() => undefined);
        await pvMes.evaluate(runAlign, { at, src: alignTo.toString() }).catch(() => {});
        await page.waitForTimeout(150);
        await pvMes.screenshot({ path: file(`studio-${tag}.png`) }).catch((e) => log.push('截图失败：' + e.message));
        const stText = await stMes.evaluate(textHtml).catch((e) => e.message);
        const pvText = await pvMes.evaluate(textHtml).catch((e) => e.message);
        check(`${tag}：消息的 HTML（前端卡以外）和酒馆一字不差`, stText === pvText, firstDiff(stText, pvText));
        const stFrames = await frameTexts(stMes);
        const pvFrames = await frameTexts(pvMes);
        check(`${tag}：前端卡里显示的文字和酒馆一样`, isDeepStrictEqual(stFrames, pvFrames), { 酒馆: stFrames, 工坊: pvFrames });
        const stVars = (await messageVars(page, i)) ?? null;
        check(`${tag}：这一楼的变量 = 工坊模拟的结果`, isDeepStrictEqual(stVars, pv.floors[i]), { 酒馆: stVars, 工坊: pv.floors[i] });
        const d = await diffPng(file(`st-${tag}.png`), file(`studio-${tag}.png`), file(`diff-${tag}.png`), { ignoreRight: 30, rows });
        log.push(`${tag}：${(d.ratio * 100).toFixed(2)}% 的像素不同（酒馆 ${d.sizeA.join('×')}，工坊 ${d.sizeB.join('×')}）`);
        const same = Math.abs(d.sizeA[0] - d.sizeB[0]) <= 1 && Math.abs(d.sizeA[1] - d.sizeB[1]) <= 1;
        check(`${tag}：和酒馆一样大（差不过 1px）`, same, { 酒馆: d.sizeA, 工坊: d.sizeB });
        check(`${tag}：看起来和酒馆一样（不同的像素 < 1%）`, d.ratio < 0.01, `${(d.ratio * 100).toFixed(2)}%，见 diff-${tag}.png`);
      }
    }
    for (const t of c.checks ?? []) await t({ page, studio, id: last.id, prompt, stVars: last.stVars, pv: last.pv, greeting, check, log, file, ai, send });
    const toasts = await page.evaluate(() => window.__toasts ?? []).catch(() => []);
    if (toasts.length) log.push('酒馆弹出的提示：' + toasts.map((t) => t.slice(0, 120)).join(' ／ '));
    check('MVU 没有报错', !toasts.some((t) => /MVU/i.test(t) && /错误|失败|error|fail/i.test(t)), toasts);
    if (consoleErrors.length) log.push('酒馆页面报错：\n  ' + consoleErrors.slice(0, 12).join('\n  '));
    await page.close();
  } catch (e) {
    r.checks.push({ what: '跑完这个用例', ok: false, detail: String(e.stack ?? e).slice(0, 1200) });
  }
  await ctx.close();
}

await writeFile(new URL('report.json', OUT), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n■ ${r.name}`);
  for (const l of r.log) console.log('  · ' + l);
  for (const k of r.checks) console.log(`  ${k.ok ? '✓' : '✗'} ${k.what}${k.ok ? '' : '\n      ' + JSON.stringify(k.detail).slice(0, 1500)}`);
}
await restoreLook(st, baseLook);
await clearBackground(st);
for (const b of Object.values(browsers)) await b.close();
await ai.close();
process.exit(report.some((r) => r.checks.some((k) => !k.ok)) ? 1 : 0);
