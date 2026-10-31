// Data of an MVU character card project: card info + the variable tree the newcomer builds.
// Only the new MVU style is supported (variables described with zod, AI updates them with JSONPatch).
import type { SavedBar } from './bar';

/**
 * Kinds a newcomer can pick for a variable:
 * group = folder of variables; number / text / bool; choice = one of a fixed list;
 * list = a list of texts; table = rows keyed by a name, each row has the fields in `children`.
 */
export type VarKind = 'group' | 'number' | 'text' | 'bool' | 'choice' | 'list' | 'table';

/** A named range of a number: the label applies from `from` up to the next stage. */
export interface Stage {
  from: number;
  label: string;
}

export interface VarNode {
  id: string;
  /** shown name; the key in stat_data is this, with `_` in front when `readonly` */
  name: string;
  kind: VarKind;
  /** starting value (number / text / bool / choice / list; table: rows by row name; table fields: default for new rows) */
  init?: unknown;
  min?: number | null;
  max?: number | null;
  /** round numbers to whole numbers */
  integer?: boolean;
  /** choice: the allowed values */
  options?: string[];
  /** number: names for value ranges, sorted by `from` */
  stages?: Stage[];
  /** when and how the variable changes, one rule per line (sent to the AI) */
  rules: string[];
  /** the AI must not change it (key gets a `_` prefix, as MVU cards usually do) */
  readonly?: boolean;
  /** players may change it with the edit button (only when the card allows player edits) */
  playerEditable?: boolean;
  /** group: child variables; table: the fields of one row */
  children?: VarNode[];
  /** table: what a row name means, e.g. 物品名 */
  rowName?: string;
  /** table: remove a row once this number field drops to 0 or below (e.g. 数量) */
  dropRowWhenZero?: string;
}

export interface CardInfo {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  /** [0] is the first message, the rest are alternate greetings */
  greetings: string[];
  /**
   * Per greeting (same order as `greetings`): starting values that differ from the normal ones, by variable id.
   * Exported as an <initvar> block inside that greeting, which MVU uses instead of the [initvar] entry.
   */
  greetingVars?: Record<string, unknown>[];
  creator: string;
  creatorNotes: string;
  version: string;
  tags: string[];
}

export interface CardSettings {
  /** players may edit variables through an edit button on the status bar (off by default) */
  allowPlayerEdit: boolean;
  /** keep a copy of the variable setup inside the exported card, so importing it back restores everything */
  embedProject: boolean;
}

/** The plain status bar: lines of text filled in by TavernHelper's variable macros, no front-end page. */
export interface TextBar {
  on: boolean;
  /** heading on top ('' = none) */
  title?: string;
  /** ids of variables left out */
  hide?: string[];
}

/** Parts of an imported card that the generated ones replace on export (the rest of the card is kept). */
export interface Takeover {
  /** world book entry ids */
  entries: number[];
  /** regex ids */
  regexes: string[];
  /** TavernHelper script ids */
  scripts: string[];
}

/** Text written by hand instead of the generated one. `from` is what was generated when editing started, to notice later changes. */
export interface HandText {
  text: string;
  from: string;
}

/** World book entries the author may rewrite by hand (advanced). */
export type HandEntry = 'rules' | 'format';

export const CARD_PROJECT_TYPE = 'st-beautify-studio/mvu-card';

export interface CardProject {
  type: typeof CARD_PROJECT_TYPE;
  version: 1;
  /** used to derive stable ids for the generated parts, so re-exporting replaces them instead of adding copies */
  id: string;
  card: CardInfo;
  vars: VarNode[];
  settings: CardSettings;
  /** card JSON this project was built on (imported card); parts we don't generate are kept as they are */
  base?: any;
  /** MVU parts of `base` that the generated ones replace */
  takeover?: Takeover;
  /** avatar PNG, base64 */
  avatar?: string;
  /** the status bar laid out on the canvas; missing = made automatically from the variables */
  bar?: SavedBar;
  /** world book entries rewritten by hand (missing = generated from the variables) */
  custom?: Partial<Record<HandEntry, HandText>>;
  /** plain text status bar instead of the one from the canvas (missing = not used) */
  textBar?: TextBar;
}
