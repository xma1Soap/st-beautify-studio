// SillyTavern's built-in UI themes (default/content/themes in SillyTavern 1.19), as the values they set: colors,
// message style, avatar shape, chat width, text shadow. Only the values are taken (no CSS), and only what changes how
// a message looks. A new SillyTavern starts on "Dark Lite" with flat messages, round avatars and no text shadow.

/** 0 flat, 1 bubbles, 2 document (power_user.chat_display) */
export type ChatStyle = 0 | 1 | 2;
/** 0 round, 1 rectangular (big), 2 square, 3 rounded square (power_user.avatar_style) */
export type AvatarStyle = 0 | 1 | 2 | 3;

export interface StTheme {
  name: string;
  /** shown in the menu */
  label: string;
  body: string;
  em: string;
  underline: string;
  quote: string;
  /** the tint over the background (blur_tint_color) */
  tint: string;
  /** the chat column's tint (chat_tint_color) */
  chatTint: string;
  userMes: string;
  botMes: string;
  shadow: string;
  border: string;
  /** text shadow width in px (power_user.shadow_width); 0 = no shadow (noShadows) */
  shadowWidth: number;
  chatStyle: ChatStyle;
  avatarStyle: AvatarStyle;
  /** chat column width on a computer, % of the window */
  chatWidth: number;
  /** under each avatar: the message's number (#3); and on AI replies how long they took (mesIDDisplay / timer) */
  mesId: boolean;
  timer: boolean;
  /** under the avatar: how many tokens the message is (not on the greeting) (message_token_count_enabled) */
  tokenCount: boolean;
  /** every message button shown beside the name, not folded behind … (expand_message_actions) */
  expandActions: boolean;
  /** the time beside the name; on AI replies the model's icon after it (timestamps_enabled / timestamp_model_icon) */
  timestamps: boolean;
  modelIcon: boolean;
  /** how much the chat blurs the background behind it (px); none in fast UI mode (blur_strength / fast_ui_mode) */
  blur: number;
  fastUi: boolean;
}

export const ST_THEMES: StTheme[] = [
  {
    // what a new SillyTavern has (default/content/settings.json): Dark Lite's colors, but a lighter border
    name: 'default',
    label: '新装的酒馆（默认）',
    body: 'rgba(220, 220, 210, 1)',
    em: 'rgba(145, 145, 145, 1)',
    underline: 'rgba(188, 231, 207, 1)',
    quote: 'rgba(225, 138, 36, 1)',
    tint: 'rgba(23, 23, 23, 1)',
    chatTint: 'rgba(23, 23, 23, 1)',
    userMes: 'rgba(30, 30, 30, 0.9)',
    botMes: 'rgba(30, 30, 30, 0.9)',
    shadow: 'rgba(0, 0, 0, 1)',
    border: 'rgba(0, 0, 0, 0.5)',
    shadowWidth: 0,
    chatStyle: 0,
    avatarStyle: 0,
    chatWidth: 50,
    mesId: false,
    timer: false,
    tokenCount: false,
    expandActions: false,
    timestamps: true,
    modelIcon: true,
    blur: 10,
    fastUi: true,
  },
  {
    name: 'Dark Lite',
    label: 'Dark Lite',
    body: 'rgba(220, 220, 210, 1)',
    em: 'rgba(145, 145, 145, 1)',
    underline: 'rgba(188, 231, 207, 1)',
    quote: 'rgba(225, 138, 36, 1)',
    tint: 'rgba(23, 23, 23, 1)',
    chatTint: 'rgba(23, 23, 23, 1)',
    userMes: 'rgba(30, 30, 30, 0.9)',
    botMes: 'rgba(30, 30, 30, 0.9)',
    shadow: 'rgba(0, 0, 0, 1)',
    border: 'rgba(0, 0, 0, 1)',
    shadowWidth: 0,
    chatStyle: 0,
    avatarStyle: 0,
    chatWidth: 50,
    mesId: false,
    timer: false,
    tokenCount: false,
    expandActions: false,
    timestamps: true,
    modelIcon: true,
    blur: 10,
    fastUi: true,
  },
  {
    name: 'Dark V 1.0',
    label: 'Dark V 1.0',
    body: 'rgba(207, 207, 197, 1)',
    em: 'rgba(145, 145, 145, 1)',
    underline: 'rgba(145, 145, 145, 1)',
    quote: 'rgba(198, 193, 151, 1)',
    tint: 'rgba(29, 33, 40, 0.9)',
    chatTint: 'rgba(29, 33, 40, 0.9)',
    userMes: 'rgba(29, 33, 40, 0.9)',
    botMes: 'rgba(29, 33, 40, 0.9)',
    shadow: 'rgba(0, 0, 0, 0.9)',
    border: 'rgba(0, 0, 0, 1)',
    shadowWidth: 2,
    chatStyle: 0,
    avatarStyle: 0,
    chatWidth: 55,
    mesId: false,
    timer: false,
    tokenCount: false,
    expandActions: false,
    timestamps: false,
    modelIcon: false,
    blur: 13,
    fastUi: false,
  },
  {
    name: 'Azure',
    label: 'Azure',
    body: 'rgba(171, 198, 223, 1)',
    em: 'rgba(255, 255, 255, 1)',
    underline: 'rgba(188, 231, 207, 1)',
    quote: 'rgba(111, 133, 253, 1)',
    tint: 'rgba(23, 30, 33, 0.61)',
    chatTint: 'rgba(23, 23, 23, 0)',
    userMes: 'rgba(0, 28, 174, 0.2)',
    botMes: 'rgba(0, 13, 57, 0.22)',
    shadow: 'rgba(0, 0, 0, 1)',
    border: 'rgba(0, 0, 0, 0.5)',
    shadowWidth: 5,
    chatStyle: 1,
    avatarStyle: 1,
    chatWidth: 50,
    mesId: true,
    timer: true,
    tokenCount: false,
    expandActions: false,
    timestamps: true,
    modelIcon: false,
    blur: 11,
    fastUi: false,
  },
  {
    name: 'Cappuccino',
    label: 'Cappuccino',
    body: 'rgba(235, 235, 235, 1)',
    em: 'rgba(230, 210, 190, 1)',
    underline: 'rgba(205, 180, 160, 1)',
    quote: 'rgba(165, 140, 115, 1)',
    tint: 'rgba(34, 30, 32, 0.95)',
    chatTint: 'rgba(50, 45, 50, 0.75)',
    userMes: 'rgba(34, 30, 32, 0.75)',
    botMes: 'rgba(34, 30, 32, 0.75)',
    shadow: 'rgba(0, 0, 0, 0.3)',
    border: 'rgba(80, 80, 80, 0.89)',
    shadowWidth: 1,
    chatStyle: 1,
    avatarStyle: 0,
    chatWidth: 50,
    mesId: true,
    timer: false,
    tokenCount: false,
    expandActions: false,
    timestamps: true,
    modelIcon: true,
    blur: 3,
    fastUi: false,
  },
  {
    name: 'Celestial Macaron',
    label: 'Celestial Macaron',
    body: 'rgba(229, 175, 162, 1)',
    em: 'rgba(146, 147, 161, 1)',
    underline: 'rgba(157, 215, 198, 1)',
    quote: 'rgba(197, 202, 206, 1)',
    tint: 'rgba(23, 36, 55, 0.9)',
    chatTint: 'rgba(18, 26, 40, 0.9)',
    userMes: 'rgba(51, 67, 90, 0.7)',
    botMes: 'rgba(23, 36, 55, 0.75)',
    shadow: 'rgba(0, 0, 0, 0.3)',
    border: 'rgba(60, 74, 110, 0.93)',
    shadowWidth: 0,
    chatStyle: 1,
    avatarStyle: 0,
    chatWidth: 58,
    mesId: true,
    timer: true,
    tokenCount: true,
    expandActions: true,
    timestamps: true,
    modelIcon: false,
    blur: 10,
    fastUi: false,
  },
];

/** Not one of SillyTavern's: a light chat, for authors whose players use light themes. */
export const LIGHT_THEME: StTheme = {
  name: 'light',
  label: '亮色（工坊自带，不是酒馆的主题）',
  body: 'rgba(38, 38, 38, 1)',
  em: 'rgba(110, 110, 110, 1)',
  underline: 'rgba(40, 130, 90, 1)',
  quote: 'rgba(184, 94, 18, 1)',
  tint: 'rgba(240, 237, 230, 1)',
  chatTint: 'rgba(240, 237, 230, 1)',
  userMes: 'rgba(230, 226, 216, 0.9)',
  botMes: 'rgba(230, 226, 216, 0.9)',
  shadow: 'rgba(0, 0, 0, 0.15)',
  border: 'rgba(0, 0, 0, 0.2)',
  shadowWidth: 0,
  chatStyle: 0,
  avatarStyle: 0,
  chatWidth: 50,
  mesId: false,
  timer: false,
  tokenCount: false,
  expandActions: false,
  timestamps: true,
  modelIcon: true,
  blur: 10,
  fastUi: true,
};

export const themeByName = (name?: string) => (name === 'light' ? LIGHT_THEME : ST_THEMES.find((t) => t.name === name) ?? ST_THEMES[0]);

/** How SillyTavern fits a background picture to the window (background_settings.fitting); classic is its default. */
export type BgFit = 'classic' | 'cover' | 'contain' | 'stretch' | 'center';
export const BG_FITS: { value: BgFit; label: string }[] = [
  { value: 'classic', label: '经典（默认）' },
  { value: 'cover', label: '填满' },
  { value: 'contain', label: '完整显示' },
  { value: 'stretch', label: '拉伸' },
  { value: 'center', label: '居中不缩放' },
];

/** How the chat looks in the preview: a theme, and what the player may have changed on top of it. */
export interface Look {
  theme: StTheme;
  chatStyle: ChatStyle;
  avatarStyle: AvatarStyle;
  fontScale: number;
  /** the chat's background picture, and how it is fitted */
  bg?: { src: string; fit: BgFit };
  /** how much the chat blurs the background (0: fast UI mode) */
  blur: number;
}

/** The preview settings that pick the look (old projects only have chatTheme). */
export interface LookSettings {
  chatTheme?: 'dark' | 'light';
  /** a theme's name (ST_THEMES or 'light'); missing = chatTheme's */
  stTheme?: string;
  /** missing = the theme's */
  chatStyle?: ChatStyle;
  /** SillyTavern's 字体缩放; missing = 1 */
  fontScale?: number;
  /** a background picture (an image URL or data: URL) behind the chat; missing = none */
  bg?: string;
  bgFit?: BgFit;
  /** SillyTavern's 快速界面 (no blur); missing = the theme's */
  fastUi?: boolean;
}

export function lookOf(s: LookSettings): Look {
  const theme = themeByName(s.stTheme ?? (s.chatTheme === 'light' ? 'light' : 'default'));
  const fontScale = Number(s.fontScale);
  const bg = typeof s.bg === 'string' && /^(https?:|data:image\/)/i.test(s.bg.trim()) ? { src: s.bg.trim(), fit: BG_FITS.some((f) => f.value === s.bgFit) ? s.bgFit! : 'classic' } : undefined;
  return {
    theme,
    chatStyle: s.chatStyle ?? theme.chatStyle,
    avatarStyle: theme.avatarStyle,
    fontScale: fontScale >= 0.5 && fontScale <= 2 ? fontScale : 1,
    ...(bg ? { bg } : {}),
    blur: (s.fastUi ?? theme.fastUi) ? 0 : theme.blur,
  };
}

/** Is the chat light (for what goes around it, like the canvas background)? */
export const isLightLook = (l: Look) => l.theme.name === 'light';

/** The theme menu's value for some settings, and the settings for a picked value. */
export const themeValue = (s: LookSettings) => lookOf(s).theme.name;
export const pickTheme = (name: string): Pick<LookSettings, 'chatTheme' | 'stTheme'> => ({ chatTheme: name === 'light' ? 'light' : 'dark', stTheme: name });

export const CHAT_STYLES: { value: ChatStyle; label: string }[] = [
  { value: 0, label: '平铺（默认）' },
  { value: 1, label: '气泡' },
  { value: 2, label: '文档' },
];
export const FONT_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];
