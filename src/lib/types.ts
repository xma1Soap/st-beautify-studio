/** One SillyTavern regex script, same fields as ST's own export. */
export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  /** 1 user input, 2 AI output, 3 slash command, 5 world info, 6 reasoning */
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  /** 0 none, 1 raw, 2 escaped */
  substituteRegex: number;
  minDepth: number | null;
  maxDepth: number | null;
}

export type Device = 'phone' | 'desktop';

export interface Settings {
  user: string;
  char: string;
  /** which message the test text is: 1 user, 2 AI */
  role: 1 | 2;
  depth: number;
  /** render ```html blocks as cards, like the TavernHelper extension */
  frontend: boolean;
  chatTheme: 'dark' | 'light';
  device: Device;
  /** like ST's "Forbid external media" (on by default): external images are removed */
  blockExternalMedia: boolean;
}

export interface Project {
  name: string;
  scripts: RegexScript[];
  testText: string;
  settings: Settings;
}

export const PROJECT_TYPE = 'st-beautify-studio';

export const PLACEMENTS: { value: number; label: string }[] = [
  { value: 1, label: '用户输入' },
  { value: 2, label: 'AI 输出' },
  { value: 3, label: '快捷命令' },
  { value: 5, label: '世界书' },
  { value: 6, label: '推理' },
];
