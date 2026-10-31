// TavernHelper's variable macros in a shown message, for the preview. TavernHelper fills them in after the message
// is formatted, from the newest message that has variables (which is what the preview's data stands for):
//   {{get_message_variable::stat_data.a.b}}     text as it is, anything else as JSON
//   {{format_message_variable::stat_data.a.b}}  text as it is, anything else as YAML; later lines are indented
//                                               as far as the macro was from the start of its line
// Keys starting with $ are left out of objects. Only message variables are filled in; others are left alone.
import YAML from 'yaml';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, k: string) => ENTITY[k]);

/** a.b[0].c → the value, or null when it isn't there */
function lookup(root: unknown, path: string): unknown {
  const keys = unescape(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter((k) => k !== '');
  let at: any = root;
  for (const k of keys) {
    if (at === null || typeof at !== 'object' || !(k in at)) return null;
    at = at[k];
  }
  return at === undefined ? null : at;
}

function withoutDollar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutDollar);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) out[k] = withoutDollar(x);
    return out;
  }
  return v;
}

const FORMAT = /\{\{format_message_variable(_quoted)?::(.*?)\}\}/i;

function formatted(v: unknown, quoted: boolean): string {
  if (typeof v === 'string') return v;
  return YAML.stringify(v, quoted ? { blockQuote: 'literal', defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' } : { blockQuote: 'literal' }).trimEnd();
}

/** Fill in the variable macros of a shown message from `vars` ({ stat_data: … }). */
export function fillVarMacros(html: string, vars: Record<string, unknown>): string {
  const value = (path: string) => withoutDollar(lookup(vars, path));
  let out = html.replace(/\{\{get_message_variable::(.*?)\}\}/gi, (_, path: string) => {
    const v = value(path);
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
  out = out
    .split('\n')
    .map((line) => {
      let done = '';
      let rest = line;
      for (let m = rest.match(FORMAT); m && m.index !== undefined; m = rest.match(FORMAT)) {
        const before = done + rest.slice(0, m.index);
        done = before + formatted(value(m[2]), !!m[1]).replaceAll('\n', '\n' + ' '.repeat(before.length));
        rest = rest.slice(m.index + m[0].length);
      }
      return done + rest;
    })
    .join('\n');
  return out;
}
