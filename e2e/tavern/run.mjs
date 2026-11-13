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
import { configure, importCard, messageVars, openCharacter, readLook, removeCharacters, restoreLook, send, setLook, stSession, swipeGreeting } from './st.mjs';
import { CASES } from './cases.mjs';
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
async function studioShot(project, { steps, own, greeting, device, look, width, left, top, file }) {
  const studio = studios[device];
  const pv = await studio.evaluate(
    async ({ p, steps, own, greeting, device, look, width, left }) => {
      const S = window.__studio;
      const sim = S.sim.simulate(p.vars, steps, {}, own);
      const settings = S.preview.previewSettings(p.card.name, device, look);
      const regexes = S.preview.previewRegexes(p);
      const reply = steps.length > 0;
      const text = reply ? steps[steps.length - 1] : greeting;
      // like the preview panel: under a greeting the bar shows only when the card puts MVU's placeholder there
      const page = S.preview.previewPage(regexes, text, settings, 800, { stat: sim.data, prev: sim.before, ...S.preview.cardExtras(p) }, reply || S.mvuCard.barOnGreeting(p));
      document.getElementById('e2e-host')?.remove();
      const host = document.createElement('div');
      host.id = 'e2e-host';
      // where SillyTavern's chat column is, to the fraction of a pixel (text is drawn a little differently otherwise)
      host.style.cssText = `position:fixed;left:${left}px;top:0;z-index:99999;background:#000`;
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
      f.style.cssText = `width:${width}px;height:880px;border:0;display:block`;
      f.srcdoc = page.html;
      host.appendChild(f);
      document.body.appendChild(host);
      return { data: sim.data, results: sim.results, readErrors: sim.readErrors, display: page.display };
    },
    { p: project, steps, own, greeting, device, look, width, left },
  );
  await studio.waitForTimeout(3000);
  const mes = studio.frameLocator('#e2e-host iframe').locator('.mes_text');
  // and the message's top on the same fraction of a pixel as in SillyTavern (lines 23.8px apart land on other rows;
  // a frame itself sits on whole pixels, so what is inside it is moved)
  await mes
    .evaluate((e, top) => {
      const at = e.getBoundingClientRect().top;
      e.ownerDocument.body.style.marginTop = (((top - at) % 1) + 1) % 1 + 'px';
    }, top)
    .catch(() => {});
  await studio.waitForTimeout(200);
  await mes.screenshot({ path: file }).catch(() => {});
  pv.html = await mes.innerHTML().catch(() => '');
  pv.text = await mes.evaluate(textHtml).catch((e) => e.message);
  pv.frames = await frameTexts(mes);
  pv.layout = await mes.evaluate(layout).catch((e) => e.message);
  return pv;
}

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
  const look = c.look
    ? { stTheme: c.look.theme, chatStyle: c.look.extra?.chat_display, fontScale: c.look.extra?.font_scale }
    : {};
  ai.queue.length = 0;
  const ctx = await browsers[device].newContext(DEVICES[device]);
  /** SillyTavern's message `id` against the studio's preview of the same: variables, then the picture. */
  const compare = async (page, id, tag, sim) => {
    const mes = page.locator(`#chat .mes[mesid="${id}"] .mes_text`);
    await mes.screenshot({ path: file(`st-${tag}.png`) }).catch((e) => log.push('截图失败：' + e.message));
    await writeFile(file(`st-${tag}.html`), await mes.innerHTML().catch(() => ''));
    const { width, left } = await page.locator('#sheld').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { width: r.width, left: r.left - Math.floor(r.left) };
    });
    const top = await mes.evaluate((e) => e.getBoundingClientRect().top % 1).catch(() => 0);
    log.push(`酒馆尺寸（${tag}）：` + JSON.stringify(await mes.evaluate(layout).catch((e) => e.message)));
    const pv = await studioShot(c.projectData, { ...sim, device, look, width, left, top, file: file(`studio-${tag}.png`) });
    await writeFile(file(`studio-${tag}.html`), pv.html);
    log.push(`工坊尺寸（${tag}）：` + JSON.stringify(pv.layout));
    const stText = await mes.evaluate(textHtml).catch((e) => e.message);
    check(`${tag}：消息的 HTML（前端卡以外）和酒馆一字不差`, stText === pv.text, firstDiff(stText, pv.text));
    const stFrames = await frameTexts(mes);
    check(`${tag}：前端卡里显示的文字和酒馆一样`, isDeepStrictEqual(stFrames, pv.frames), { 酒馆: stFrames, 工坊: pv.frames });
    if (stFrames.length) log.push(`${tag}：前端卡里的文字：` + stFrames.map((t) => t.slice(0, 160)).join(' | '));
    const stVars = await messageVars(page, id);
    check(`${tag}：MVU 在酒馆里存的变量 = 工坊模拟的结果`, isDeepStrictEqual(stVars, pv.data), { 酒馆: stVars, 工坊: pv.data });
    const d = await diffPng(file(`st-${tag}.png`), file(`studio-${tag}.png`), file(`diff-${tag}.png`), { ignoreRight: 30 });
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
for (const b of Object.values(browsers)) await b.close();
await ai.close();
process.exit(report.some((r) => r.checks.some((k) => !k.ok)) ? 1 : 0);
