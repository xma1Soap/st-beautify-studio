// Data of an MVU character card project: card info + the variable tree the newcomer builds.
// Only the new MVU style is supported (variables described with zod, AI updates them with JSONPatch).

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
  creator: string;
  creatorNotes: string;
  version: string;
  tags: string[];
}

export interface CardSettings {
  /** players may edit variables through an edit button on the status bar (off by default) */
  allowPlayerEdit: boolean;
}

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
  /** avatar PNG, base64 */
  avatar?: string;
}
