// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { runtimeScript } from './thRuntime';

describe('a card in a whole chat', () => {
  const w = window as any;
  beforeAll(() => {
    w.parent.postMessage = () => {};
    const chat = [
      { raw: '开场白', ai: true, stat: { 好感: 0 } },
      { raw: '我来了', ai: false },
      { raw: '回复一', ai: true, stat: { 好感: 5 } },
      { raw: '再见', ai: false },
      { raw: '回复二', ai: true, stat: { 好感: 9 } },
    ];
    // the card is in the first reply (message 2), not the newest
    new Function(runtimeScript({ raw: '', user: '我', char: '白娅', ai: true, vh: 600, chat, id: 2 }))();
  });

  it('knows which message it is in and which is the newest', () => {
    expect(w.getCurrentMessageId()).toBe(2);
    expect(w.getLastMessageId()).toBe(4);
    expect(w.getChatMessages('0-{{lastMessageId}}').map((m: any) => [m.message_id, m.role, m.message])).toEqual([
      [0, 'assistant', '开场白'],
      [1, 'user', '我来了'],
      [2, 'assistant', '回复一'],
      [3, 'user', '再见'],
      [4, 'assistant', '回复二'],
    ]);
  });
  it('reads each message its own variables, compared with the message before that has some', () => {
    const d = w.Mvu.getMvuData({ type: 'message', message_id: w.getCurrentMessageId() });
    expect(d.stat_data).toEqual({ 好感: 5 });
    expect(d.delta_data).toEqual({ 好感: '0->5' });
    expect(w.getVariables({ type: 'message', message_id: 1 })).toEqual({});
    // "latest" and negative ids count from the newest message
    expect(w.Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data).toEqual({ 好感: 9 });
    expect(w.getVariables({ type: 'message', message_id: -1 }).stat_data).toEqual({ 好感: 9 });
  });
});
