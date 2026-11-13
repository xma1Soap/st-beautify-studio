// Talking to a test SillyTavern: its server API (settings, characters) and its page (opening a character, the popups,
// sending a message, reading what is shown and what MVU stored).

/** A session with the server (CSRF token + cookie), and a POST helper. */
export async function stSession(base) {
  const r = await fetch(base + '/csrf-token');
  if (!r.ok) throw new Error(`连不上酒馆 ${base}（HTTP ${r.status}）`);
  const { token } = await r.json();
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const post = async (path, body) => {
    const form = body instanceof FormData;
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'X-CSRF-Token': token, Cookie: cookie, ...(form ? {} : { 'Content-Type': 'application/json' }) },
      body: form ? body : JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`${path}：HTTP ${res.status} ${await res.text().catch(() => '')}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { post };
}

/**
 * Settings for the checks: the API is the fake AI, no first-run name popup. Everything else stays as a new user has
 * it (that is what the preview has to match).
 */
export async function configure(st, aiUrl, { user = '玩家', stream = false, forget = 'E2E ' } = {}) {
  const got = await st.post('/api/settings/get', {});
  const s = JSON.parse(got.settings);
  s.firstRun = false;
  s.username = user;
  s.main_api = 'openai';
  s.oai_settings = { ...s.oai_settings, chat_completion_source: 'custom', custom_url: aiUrl, custom_model: 'fake-model', stream_openai: stream };
  s.power_user = { ...s.power_user, auto_connect: true };
  // every test card opens like the first time: SillyTavern asks about its world book and regexes, TavernHelper about its scripts
  const mine = (x) => String(x).includes(forget);
  const ext = (s.extension_settings ??= {});
  if (Array.isArray(ext.character_allowed_regex)) ext.character_allowed_regex = ext.character_allowed_regex.filter((a) => !mine(a));
  const th = ext.tavern_helper?.script;
  if (th?.popuped?.characters) th.popuped.characters = th.popuped.characters.filter((a) => !mine(a));
  if (th?.enabled?.characters) th.enabled.characters = th.enabled.characters.filter((a) => !mine(a));
  for (const k of Object.keys(s.accountStorage ?? {})) if (mine(k)) delete s.accountStorage[k];
  await st.post('/api/settings/save', s);
  return s;
}

/** What a UI theme sets (SillyTavern copies these from the theme into the user's settings when it is picked). */
const THEME_KEYS = [
  'main_text_color', 'italics_text_color', 'underline_text_color', 'quote_text_color', 'blur_tint_color', 'chat_tint_color',
  'user_mes_blur_tint_color', 'bot_mes_blur_tint_color', 'shadow_color', 'shadow_width', 'border_color', 'font_scale',
  'blur_strength', 'chat_display', 'avatar_style', 'chat_width', 'noShadows', 'timer_enabled', 'mesIDDisplay_enabled',
  'hideChatAvatars_enabled', 'message_token_count_enabled', 'expand_message_actions', 'enableZenSliders', 'enableLabMode',
  'hotswap_enabled', 'custom_css', 'bogus_folders', 'zoomed_avatar_magnification', 'reduced_motion', 'compact_input_area',
  'show_swipe_num_all_messages', 'click_to_edit', 'media_display',
];

/** The look settings as they are now (to put them back after the checks). */
export async function readLook(st) {
  const s = JSON.parse((await st.post('/api/settings/get', {})).settings);
  return Object.fromEntries(['theme', ...THEME_KEYS].filter((k) => k in s.power_user).map((k) => [k, s.power_user[k]]));
}

/** Puts back look settings from readLook. */
export async function restoreLook(st, saved) {
  const s = JSON.parse((await st.post('/api/settings/get', {})).settings);
  s.power_user = { ...s.power_user, ...saved };
  await st.post('/api/settings/save', s);
}

/**
 * Puts SillyTavern on one of its UI themes (by name, as in its theme list; default "Dark Lite"), with `extra` power
 * user settings on top (e.g. { chat_display: 2, font_scale: 1.2 }). Takes effect when the page is loaded next.
 */
export async function setLook(st, theme = 'Dark Lite', extra = {}) {
  const got = await st.post('/api/settings/get', {});
  const s = JSON.parse(got.settings);
  const t = (got.themes ?? []).find((x) => x.name === theme);
  if (!t) throw new Error('酒馆里没有这个主题：' + theme);
  const pick = Object.fromEntries(THEME_KEYS.filter((k) => k in t).map((k) => [k, t[k]]));
  s.power_user = { ...s.power_user, ...pick, theme, ...extra };
  await st.post('/api/settings/save', s);
}

/** Deletes characters whose name starts with `prefix`, with their chats. */
export async function removeCharacters(st, prefix) {
  const all = await st.post('/api/characters/all', {});
  for (const c of all) if (String(c.name ?? '').startsWith(prefix)) await st.post('/api/characters/delete', { avatar_url: c.avatar, delete_chats: true });
}

/** Imports a card (its JSON). Gives the file name SillyTavern stored it under. */
export async function importCard(st, card, fileName) {
  const form = new FormData();
  form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), fileName + '.json');
  form.append('file_type', 'json');
  const r = await st.post('/api/characters/import', form);
  if (r?.error) throw new Error('导入失败：' + JSON.stringify(r));
  return r.file_name;
}

/** Clicks through the popups SillyTavern and TavernHelper show (world book import, enabling the card's scripts). */
export async function acceptPopups(page, log, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // the one on top: SillyTavern's <dialog>s sit above everything (the last opened on top), then TavernHelper's
    const st = page.locator('dialog[open].popup');
    const popup = (await st.count()) ? st.last() : page.locator('.TH-popup .popup:visible, .popup:visible').last();
    if (await popup.isVisible().catch(() => false)) {
      const text = (await popup.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
      const ok = popup.locator('.popup-button-ok:visible').first();
      if (await ok.isVisible().catch(() => false)) {
        log.push(`点了弹窗：${text}`);
        await ok.click({ timeout: 5000 }).catch((e) => log.push('没点上：' + e.message.split('\n')[0]));
        await page.waitForTimeout(500);
        continue;
      }
    }
    await page.waitForTimeout(300);
  }
}

/** Opens SillyTavern and the character called `name` (a fresh chat with its first greeting). */
export async function openCharacter(page, base, name, log) {
  await page.goto(base);
  await page
    .waitForFunction((n) => !!window.SillyTavern?.getContext?.()?.characters?.some((c) => c.name === n) && document.querySelector('#send_textarea'), name, { timeout: 60000 })
    .catch(() => {
      throw new Error('酒馆里没找到角色 ' + name);
    });
  await page.waitForTimeout(1000);
  const idx = await page.evaluate((n) => window.SillyTavern.getContext().characters.findIndex((c) => c.name === n), name);
  // not waited for: it only returns once its popups are answered
  await page.evaluate((i) => void window.SillyTavern.getContext().selectCharacterById(i), idx);
  await acceptPopups(page, log, 10000);
  await page.waitForSelector('#chat .mes[mesid="0"]', { timeout: 30000 });
  await closeDrawers(page, log);
}

/** Closes SillyTavern's open side panels (importing a card's world book opens its editor over the chat). */
export async function closeDrawers(page, log) {
  const n = await page.evaluate(() => {
    const open = [...document.querySelectorAll('.drawer-icon.openIcon')];
    for (const i of open) (i.closest('.drawer-toggle') ?? i).click();
    return open.length;
  });
  if (n) {
    log?.push(`关掉了酒馆打开的 ${n} 个侧边面板`);
    await page.waitForTimeout(800);
  }
}

/** Swipes the greeting to the `n`th one (1 = the first alternate greeting), like a player clicking the arrow. */
export async function swipeGreeting(page, n, log) {
  for (let i = 0; i < n; i++) {
    await page.locator('#chat .mes[mesid="0"] .swipe_right').first().click();
    await page.waitForTimeout(1500);
  }
  log.push('开场白滑到：' + (await page.locator('#chat .mes[mesid="0"] .swipes-counter').first().innerText().catch(() => '?')));
  await page.waitForTimeout(3000);
}

/** Sends a message as the user and waits for the reply (and for MVU to be done with it). */
export async function send(page, text) {
  const before = await page.locator('#chat .mes').count();
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await page.waitForFunction((n) => document.querySelectorAll('#chat .mes').length >= n + 2, before, { timeout: 60000 });
  // the reply is in; MVU reads the update and redraws the message
  await page.waitForTimeout(4000);
  return before + 1;
}

/** What MVU stored for a message (stat_data), through TavernHelper. */
export const messageVars = (page, id) =>
  page.evaluate((i) => {
    const th = window.TavernHelper;
    if (!th) return { error: '页面上没有 TavernHelper（酒馆助手没装上？）' };
    try {
      return th.getVariables({ type: 'message', message_id: i })?.stat_data ?? null;
    } catch (e) {
      return { error: String(e) };
    }
  }, id);
