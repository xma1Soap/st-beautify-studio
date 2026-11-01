// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runtimeScript } from './thRuntime';
import { replaceMinHeightVh } from './render';

describe('the TavernHelper / MVU stand-ins inside a card', () => {
  const w = window as any;
  const errorLog = console.error;
  const sent: any[] = [];
  beforeAll(() => {
    w.parent.postMessage = (m: unknown) => sent.push(m);
    new Function(
      runtimeScript({ raw: '你好', user: '我', char: '白娅', ai: true, vh: 600, stat: { 好感: 12, 地点: '城' }, prev: { 好感: 10, 地点: '城' }, charVars: { theme: 'dark' }, card: { name: '白娅' } }),
    )();
  });
  afterAll(() => {
    console.error = errorLog;
  });

  it('gives this message MVU data with what changed, and the message before it', () => {
    expect(w.getCurrentMessageId()).toBe(1);
    const d = w.Mvu.getMvuData({ type: 'message', message_id: w.getCurrentMessageId() });
    expect(d.stat_data).toEqual({ 好感: 12, 地点: '城' });
    expect(d.display_data).toEqual({ 好感: '10->12', 地点: '城' });
    expect(d.delta_data).toEqual({ 好感: '10->12' });
    expect(w.getVariables({ type: 'message', message_id: 0 }).stat_data).toEqual({ 好感: 10, 地点: '城' });
    expect(w.getChatMessages('0-{{lastMessageId}}').map((m: any) => m.message_id)).toEqual([0, 1]);
  });
  it('keeps character and chat variables apart, and changes them', async () => {
    expect(w.getVariables({ type: 'character' })).toEqual({ theme: 'dark' });
    expect(w.getVariables()).toEqual({});
    await w.insertOrAssignVariables({ a: { b: 1 } }, { type: 'character' });
    await w.deleteVariable('theme', { type: 'character' });
    expect(w.getVariables({ type: 'character' })).toEqual({ a: { b: 1 } });
    await w.insertOrAssignVariables({ n: 1 });
    expect(w.getVariables({ type: 'chat' })).toEqual({ n: 1 });
  });
  it('writes MVU data back and tells the tool', async () => {
    const d = w.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    await w.Mvu.setMvuVariable(d, '好感', 20, { reason: '送花' });
    expect(d.display_data.好感).toBe('12->20 (送花)');
    await w.Mvu.replaceMvuData(d, { type: 'message', message_id: 'latest' });
    expect(w.getVariables({ type: 'message' }).stat_data.好感).toBe(20);
    expect(sent.some((m) => m.__stp === 'stat')).toBe(true);
  });
  it('fills in macros and passes toasts on', () => {
    expect(w.SillyTavern.substituteParams('{{user}}和{{char}}')).toBe('我和白娅');
    expect(w.SillyTavern.getContext().name2).toBe('白娅');
    w.toastr.success('存好了');
    expect(sent).toContainEqual({ __stp: 'toast', kind: 'success', msg: '存好了' });
  });
});

describe('vh like TavernHelper', () => {
  it('only switches min-height to the chat height', () => {
    expect(replaceMinHeightVh('<style>.a{min-height:100vh;height:50vh}</style>')).toBe('<style>.a{min-height:var(--TH-viewport-height);height:50vh}</style>');
    expect(replaceMinHeightVh('<div style="min-height: 50vh">')).toBe('<div style="min-height: calc(var(--TH-viewport-height) * 0.5)">');
    expect(replaceMinHeightVh('<div style="height:80vh">')).toBe('<div style="height:80vh">');
  });
});
