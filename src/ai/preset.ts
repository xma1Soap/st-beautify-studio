// SillyTavern chat completion presets: the enabled prompt entries, in the preset's order,
// split where the chat history goes (entries after it are sent after the conversation, as ST does).
import type { AiPreset, PresetMsg } from './settings';

const ROLES = new Set(['system', 'user', 'assistant']);

export function parsePreset(json: any, name: string): AiPreset {
  const prompts: any[] = Array.isArray(json?.prompts) ? json.prompts : [];
  if (!prompts.length) throw new Error('这不是酒馆的对话补全预设（里面没有 prompts）');
  const byId = new Map(prompts.filter((p) => p && typeof p === 'object').map((p) => [String(p.identifier), p]));
  const orders: any[] = Array.isArray(json.prompt_order) ? json.prompt_order : [];
  // 100001 is the order ST uses for every character unless one has its own
  const pick = orders.find((o) => o?.character_id === 100001) ?? orders.reduce((a: any, b: any) => ((b?.order?.length ?? 0) > (a?.order?.length ?? 0) ? b : a), null);
  const order: { identifier: string; enabled: boolean }[] = Array.isArray(pick?.order)
    ? pick.order.map((o: any) => ({ identifier: String(o?.identifier), enabled: o?.enabled !== false }))
    : prompts.map((p) => ({ identifier: String(p.identifier), enabled: p.enabled !== false }));

  const before: PresetMsg[] = [];
  const after: PresetMsg[] = [];
  let afterHistory = false;
  for (const o of order) {
    if (o.identifier === 'chatHistory') {
      afterHistory = true;
      continue;
    }
    if (!o.enabled) continue;
    const p = byId.get(o.identifier);
    // markers stand for card parts (description, world info…), which the assistant doesn't have
    if (!p || p.marker) continue;
    const content = String(p.content ?? '');
    if (!content.trim()) continue;
    const msg: PresetMsg = { role: ROLES.has(p.role) ? p.role : 'system', content, name: String(p.name || p.identifier) };
    // "in chat" entries go near the end of the chat
    (afterHistory || p.injection_position === 1 ? after : before).push(msg);
  }
  if (!before.length && !after.length) throw new Error('这个预设里没有启用的条目');
  return { name, before, after };
}

/** ST macros that make sense here; unknown ones stay as they are, like ST does. */
export function fillMacros(text: string, m: { user: string; char: string }): string {
  return text
    .replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{(setvar|addvar|incvar|decvar|setglobalvar|addglobalvar|incglobalvar|decglobalvar)::[\s\S]*?\}\}/gi, '')
    .replace(/\{\{(getvar|getglobalvar)::[^}]*\}\}/gi, '')
    .replace(/\{\{(noop|original)\}\}/gi, '')
    .replace(/\{\{newline\}\}/gi, '\n')
    .replace(/\{\{user\}\}/gi, m.user)
    .replace(/\{\{char\}\}/gi, m.char)
    .replace(/\s*\{\{trim\}\}\s*/gi, '');
}
