import { useRef, useState } from 'react';
import { imageToDataUrl } from '../lib/image';
import { BG_FITS, CHAT_STYLES, FONT_SCALES, LIGHT_THEME, lookOf, pickTheme, ST_THEMES, themeValue, type BgFit, type ChatStyle, type Look, type LookSettings } from '../lib/stThemes';
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

/** One device's frame in the stage: its size, how much it is scaled down, and where its middle is (from the left). */
export interface Placed {
  w: number;
  h: number;
  scale: number;
  x: number;
}

/**
 * A phone and a computer side by side: the phone on the left as tall as fits, the computer's chat column in the room
 * left over (the phone gives up room when that would be less than half the stage).
 */
export function fitBoth(stage: { w: number; h: number }, phoneIdx: number, deskIdx: number, look?: Look): { phone: Placed; desktop: Placed } {
  const p = PHONES[phoneIdx] || PHONES[1];
  const bezel = 20;
  const availH = Math.max(stage.h - PAD * 2, 100);
  let ps = Math.min(1, availH / (p.h + bezel), Math.max(stage.w * 0.45 - PAD, 60) / (p.w + bezel));
  const phoneBox = (p.w + bezel) * ps;
  const room = Math.max(stage.w - PAD * 3 - phoneBox, 80);
  const dw = chatWidth(false, deskIdx, look);
  const ds = Math.min(1, room / dw);
  ps = Math.max(ps, 0.05);
  return {
    phone: { w: p.w, h: p.h, scale: ps, x: PAD + phoneBox / 2 },
    desktop: { w: dw, h: availH / ds, scale: ds, x: PAD * 2 + phoneBox + (dw * ds) / 2 },
  };
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

/**
 * Where the preview's frames go: one device in the middle, or (side by side) the phone and the computer. `main` is the
 * chosen device's (the one 点选修改 works in), `other` the second one's when side by side.
 */
export function useDevices(stage: { w: number; h: number }, phone: boolean, both: boolean, look?: Look) {
  const [phoneIdx, setPhoneIdx] = useScreen(true);
  const [deskIdx, setDeskIdx] = useScreen(false);
  const pair = both ? fitBoth(stage, phoneIdx, deskIdx, look) : null;
  const main: Placed = pair ? (phone ? pair.phone : pair.desktop) : { ...fitDevice(stage, phone, phone ? phoneIdx : deskIdx, look), x: stage.w / 2 };
  const other: Placed | null = pair ? (phone ? pair.desktop : pair.phone) : null;
  return { main, other, pair, phoneIdx, setPhoneIdx, deskIdx, setDeskIdx };
}

/** 📱 手机 / 🖥 电脑 / 并排. */
export function DeviceSwitch({ phone, both, onChange }: { phone: boolean; both: boolean; onChange: (p: { device?: 'phone' | 'desktop'; both: boolean }) => void }) {
  return (
    <div className="seg" role="group" aria-label="预览设备">
      <button className={phone && !both ? 'on' : ''} onClick={() => onChange({ device: 'phone', both: false })}>
        📱 手机
      </button>
      <button className={!phone && !both ? 'on' : ''} onClick={() => onChange({ device: 'desktop', both: false })}>
        🖥 电脑
      </button>
      <button className={both ? 'on' : ''} onClick={() => onChange({ both: true })} title="手机和电脑并排，同时看两种宽度（点选修改在原来选的那一边）">
        并排
      </button>
    </div>
  );
}

/** The screen choices for what is shown, and its size. */
export function ScreenPickers({ d, phone, both }: { d: ReturnType<typeof useDevices>; phone: boolean; both: boolean }) {
  const { main, pair } = d;
  return (
    <>
      {(both || phone) && <ScreenSelect phone value={d.phoneIdx} onChange={d.setPhoneIdx} />}
      {(both || !phone) && <ScreenSelect phone={false} value={d.deskIdx} onChange={d.setDeskIdx} />}
      <span className="hint">
        {pair
          ? `手机 ${pair.phone.w} 宽 · 电脑 ${Math.round(pair.desktop.w)} 宽`
          : `${Math.round(main.w)} × ${Math.round(main.h)}${main.scale < 0.999 ? ` · 缩放 ${Math.round(main.scale * 100)}%` : ''}`}
      </span>
    </>
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
      <BgPicker value={value} onChange={onChange} />
    </>
  );
}

/**
 * The chat's background picture (酒馆「背景」): from the computer (shrunk to 1920 at most) or a link, how it is fitted,
 * and whether the chat blurs it (off in 快速界面, which the theme decides unless changed here). Only for the preview.
 */
export function BgPicker({ value, onChange }: { value: LookSettings; onChange: (p: LookSettings) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(false);
  const [err, setErr] = useState('');
  const look = lookOf(value);
  const has = !!look.bg;
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      setErr('');
      onChange({ bg: await imageToDataUrl(f, 1920) });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <button className="small" onClick={() => file.current?.click()} title="酒馆「背景」里选的图：铺满整个窗口，聊天栏的半透明底色叠在上面（主题的底色不透明时看不到）。只在预览里用，不会放进卡里">
        {has ? '换背景图' : '聊天背景图'}
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ''))} />
      <button className={'small' + (link ? ' on' : '')} onClick={() => setLink((x) => !x)} title="用图片链接当背景">
        🔗
      </button>
      {link && (
        <input
          className="small-input"
          placeholder="https://…（图片链接）"
          defaultValue={value.bg?.startsWith('http') ? value.bg : ''}
          onKeyDown={(e) => e.key === 'Enter' && (onChange({ bg: (e.target as HTMLInputElement).value.trim() || undefined }), setLink(false))}
          onBlur={(e) => e.target.value.trim() && onChange({ bg: e.target.value.trim() })}
        />
      )}
      {has && (
        <>
          <select className="small-select" value={look.bg!.fit} onChange={(e) => onChange({ bgFit: e.target.value as BgFit })} title="酒馆「背景」里的「填充方式」">
            {BG_FITS.map((f) => (
              <option key={f.value} value={f.value}>
                背景：{f.label}
              </option>
            ))}
          </select>
          <label className="chk" title={`酒馆「用户设置」里关掉「快速界面」时，聊天栏会把后面的背景模糊（这个主题模糊 ${look.theme.blur}px；${look.theme.fastUi ? '主题默认开着快速界面，不模糊' : '主题默认会模糊'}）`}>
            <input type="checkbox" checked={look.blur > 0} onChange={(e) => onChange({ fastUi: !e.target.checked })} />
            模糊
          </label>
          <button className="xbtn" title="不用背景图" onClick={() => onChange({ bg: undefined, fastUi: undefined })}>
            ✕
          </button>
        </>
      )}
      {err && <span className="hint err">{err}</span>}
    </>
  );
}
