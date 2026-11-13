import { useState } from 'react';
import { CHAT_STYLES, FONT_SCALES, LIGHT_THEME, lookOf, pickTheme, ST_THEMES, themeValue, type ChatStyle, type Look, type LookSettings } from '../lib/stThemes';
// Size of the fake phone / desktop screen in the preview, scaled down to fit the panel.
//
// Measured in SillyTavern 1.19 with its default theme (e2e/tavern): on a phone the chat takes the whole screen; on a
// computer it is half the window wide (in the middle). The message text — what a status bar gets — is the chat minus
// 110px on a computer (10 + 50 avatar + 10 + 10 on the left, 30 kept free on the right) and minus 112px on a phone.
export const PHONES = [
  { w: 360, h: 780, label: '360 宽' },
  { w: 390, h: 844, label: '390 宽' },
  { w: 430, h: 932, label: '430 宽' },
];
/** Computer screens: the preview shows SillyTavern's chat column, half as wide. */
export const DESKTOPS = [
  { screen: 1280, label: '1280 屏' },
  { screen: 1366, label: '1366 屏' },
  { screen: 1440, label: '1440 屏' },
  { screen: 1920, label: '1920 屏' },
  { screen: 2560, label: '2560 屏' },
];
export const PAD = 24;

/** Width of SillyTavern's chat column (on a computer the theme's share of the window, half by default). */
export const chatWidth = (phone: boolean, i: number, look?: Look) =>
  phone ? (PHONES[i] ?? PHONES[1]).w : ((DESKTOPS[i] ?? DESKTOPS[3]).screen * (look?.theme.chatWidth ?? 50)) / 100;
/** SillyTavern's chat always shows its scrollbar on a computer: 0.7rem, 11px in Chrome on Windows (where it takes room). */
export const SCROLLBAR = 11;

/**
 * What a message takes beside its text: flat 10 + avatar 50 + 10 on the left and 10 + 30 on the right; bubbles add a
 * 1px border on each side; a theme's rectangular avatars are 60 wide; the document style has no avatar, the text 20 in
 * and 30 + 10 free on the right. On a phone the chat has a 1px border on each side; on a computer, its scrollbar.
 */
export function textSide(phone: boolean, look: Look = lookOf({})): number {
  const edge = phone ? 2 : SCROLLBAR;
  if (look.chatStyle === 2) return 80 + edge;
  return 60 + (look.avatarStyle === 1 ? 60 : 50) + (look.chatStyle === 1 ? 2 : 0) + edge;
}
/** Width of the message text in that chat (what a status bar has to fit in). */
export const textWidth = (phone: boolean, i: number, look?: Look) => chatWidth(phone, i, look) - textSide(phone, look);

export function fitDevice(stage: { w: number; h: number }, phone: boolean, idx: number, look?: Look) {
  const availW = Math.max(stage.w - PAD * 2, 100);
  const availH = Math.max(stage.h - PAD * 2, 100);
  if (phone) {
    const p = PHONES[idx] || PHONES[1];
    const bezel = 20;
    return { w: p.w, h: p.h, scale: Math.min(1, availW / (p.w + bezel), availH / (p.h + bezel)) };
  }
  const w = chatWidth(false, idx, look);
  const scale = Math.min(1, availW / w);
  return { w, h: availH / scale, scale };
}

const read = (key: string, fallback: number, list: unknown[]) => {
  const n = Number(localStorage.getItem(key) ?? fallback);
  return Number.isInteger(n) && n >= 0 && n < list.length ? n : fallback;
};
const write = (key: string, i: number) => {
  try {
    localStorage.setItem(key, String(i));
  } catch {
    /* ignore */
  }
};
export const savedPhone = () => read('stbs-phone', 1, PHONES);
export const savePhone = (i: number) => write('stbs-phone', i);
export const savedDesktop = () => read('stbs-desktop', 3, DESKTOPS);
export const saveDesktop = (i: number) => write('stbs-desktop', i);

/** The screen choices for the device: phone widths or computer screens. */
export const screenChoices = (phone: boolean) => (phone ? PHONES.map((p) => p.label) : DESKTOPS.map((d) => `${d.label}（聊天栏 ${d.screen / 2}）`));

/** The chosen screen for the device (remembered), and how to change it. */
export function useScreen(phone: boolean): [number, (i: number) => void] {
  const [p, setP] = useState(savedPhone);
  const [d, setD] = useState(savedDesktop);
  return phone ? [p, (i) => (setP(i), savePhone(i))] : [d, (i) => (setD(i), saveDesktop(i))];
}

/** Which phone width / computer screen to preview on. */
export function ScreenSelect({ phone, value, onChange }: { phone: boolean; value: number; onChange: (i: number) => void }) {
  return (
    <select className="small-select" value={value} onChange={(e) => onChange(Number(e.target.value))} title={phone ? '手机屏幕宽度（酒馆在手机上聊天占满整屏）' : '电脑屏幕宽度（酒馆在电脑上聊天栏占屏幕的一半）'}>
      {screenChoices(phone).map((l, i) => (
        <option key={i} value={i}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** How the preview's chat looks: which SillyTavern theme, message style and font size (what the player has). */
export function LookSelect({ value, onChange }: { value: LookSettings; onChange: (p: LookSettings) => void }) {
  const look = lookOf(value);
  return (
    <>
      <select className="small-select" value={themeValue(value)} onChange={(e) => onChange(pickTheme(e.target.value))} title="酒馆「用户设置」里的界面主题：配色、消息样式、头像形状、聊天栏宽度都跟着变">
        {[...ST_THEMES, LIGHT_THEME].map((t) => (
          <option key={t.name} value={t.name}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        className="small-select"
        value={value.chatStyle ?? ''}
        onChange={(e) => onChange({ chatStyle: e.target.value === '' ? undefined : (Number(e.target.value) as ChatStyle) })}
        title="酒馆「用户设置」里的「聊天样式」：平铺、气泡、文档"
      >
        <option value="">消息样式：跟主题（{CHAT_STYLES[look.theme.chatStyle].label.replace('（默认）', '')}）</option>
        {CHAT_STYLES.map((c) => (
          <option key={c.value} value={c.value}>
            消息样式：{c.label}
          </option>
        ))}
      </select>
      <select className="small-select" value={look.fontScale} onChange={(e) => onChange({ fontScale: Number(e.target.value) })} title="酒馆「用户设置」里的「字体缩放」">
        {FONT_SCALES.map((f) => (
          <option key={f} value={f}>
            字号 {f === 1 ? '1（默认）' : f}
          </option>
        ))}
      </select>
    </>
  );
}
