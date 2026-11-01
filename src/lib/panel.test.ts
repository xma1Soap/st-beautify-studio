import { afterEach, describe, expect, it } from 'vitest';
import { newScript } from './defaults';
import { runScript } from './engine';
import { cleanPanel, compilePanel, isPanel, newPanel, panelPrompt, panelSample, readPanel, recognizePanel, safeJson, type PanelDef } from './panel';
import { fixMarkdown } from './stformat';

const m = { user: 'User', char: 'Char' };

const p: PanelDef = {
  v: 1,
  tag: '战况',
  title: 'brace',
  rows: 'pipe',
  key: 'k',
  sections: [
    { name: '战况总览', aliases: ['戰況總覽'], icon: '📜', color: '#ffd700', open: true },
    { name: '结算', aliases: [], icon: '🏁', color: '#48bb78', open: false },
  ],
  rules: [
    { kind: 'meter', name: 'HP', color: '#c53030', low: 50, lowColor: '#dd6b20' },
    { kind: 'field', name: '回合|环境', color: '#553c9a' },
    { kind: 'stat', name: '力', label: '力量', color: '#fc8181' },
    { kind: 'words', name: '哥布林、狼人', color: '#f56565' },
    { kind: 'dice', name: '', color: '#63b3ed' },
    { kind: 'number', name: '', color: '#fbd38d' },
  ],
  theme: { bg: '#1e1e32', border: '#8b7355', head: '#2d2d44', title: '#ffd700', text: '#e8d5b7', row: '#0000004d' },
};

const run = (text: string, pp = p) => {
  const c = compilePanel(pp);
  return runScript({ ...newScript(), findRegex: c.findRegex, replaceString: c.replaceString }, text, m);
};

/** Runs the card the regex made (as TavernHelper would) and returns what it drew. */
function draw(out: string) {
  const html = out.slice(out.indexOf('```html\n') + 8, out.lastIndexOf('\n```'));
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>'));
  new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')))();
  return document.getElementById('sp')!;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

const block = ['<战况>', '{戰況總覽}', '|回合: 3 | 环境: 月影森林|', '|哥布林 HP 20/80 | 力12|', '|🎲 15 → 命中，造成 8 点伤害|', '{结算}', '|获得 120 经验|', '</战况>'].join('\n');

describe('the card it makes', () => {
  it('splits the block into sections with their icon, color and open state', () => {
    const sp = draw(run('前文\n' + block + '\n后文').out);
    const panels = [...sp.querySelectorAll('.sp-panel')] as HTMLElement[];
    expect(panels).toHaveLength(2);
    // written in 繁体: still the 战况总览 section
    expect(panels[0].querySelector('.sp-icon')!.textContent).toBe('📜');
    expect(panels[0].style.getPropertyValue('--c')).toBe('#ffd700');
    expect(panels[0].classList.contains('shut')).toBe(false);
    expect(panels[1].classList.contains('shut')).toBe(true);
    expect(panels[0].querySelectorAll('.sp-row')).toHaveLength(3);
  });
  it('turns what is in the rows into meters, tags, stats and colored words', () => {
    const sp = draw(run(block).out);
    const meter = sp.querySelector('.sp-meter') as HTMLElement;
    expect(meter.textContent).toBe('HP20/80');
    expect(meter.classList.contains('low')).toBe(true);
    expect(meter.style.getPropertyValue('--c')).toBe('#dd6b20');
    expect((meter.querySelector('i > i') as HTMLElement).style.width).toBe('25%');
    expect([...sp.querySelectorAll('.sp-field .sp-tag')].map((e) => e.textContent)).toEqual(['3', '月影森林']);
    expect(sp.querySelector('.sp-stat')!.textContent).toBe('力量 12');
    expect(sp.querySelector('.sp-dice')!.textContent).toBe('🎲 15');
    const hl = [...sp.querySelectorAll('.sp-hl')].map((e) => e.textContent);
    expect(hl).toContain('哥布林');
    expect(hl).toContain('8');
    expect(sp.querySelectorAll('.sp-sep').length).toBe(2);
  });
  it('remembers which sections the player folded', () => {
    let sp = draw(run(block).out);
    (sp.querySelector('.sp-head') as HTMLElement).click();
    expect(sp.querySelector('.sp-panel')!.classList.contains('shut')).toBe(true);
    sp = draw(run(block).out);
    expect(sp.querySelector('.sp-panel')!.classList.contains('shut')).toBe(true);
  });
  it('takes 【title】 and plain lines when told to', () => {
    const q = { ...p, title: 'bracket' as const, rows: 'line' as const };
    const sp = draw(run('<战况>\n【结算】\nHP 90/100\n回合: 4\n</战况>', q).out);
    expect(sp.querySelector('.sp-title')!.textContent).toBe('结算');
    expect(sp.querySelectorAll('.sp-row')).toHaveLength(2);
    expect(sp.querySelector('.sp-meter')!.classList.contains('low')).toBe(false);
  });
  it('survives ST formatting, also with what the AI wrote in it', () => {
    const weird: PanelDef = { ...p, sections: [{ ...p.sections[0], name: '说"走"_*x*' }], rules: [{ kind: 'words', name: '$1、{{user}}、`a`、<b>', color: '#fff' }] };
    for (const c of [compilePanel(p), compilePanel(weird)]) {
      expect(fixMarkdown(c.replaceString)).toBe(c.replaceString);
      expect(c.replaceString.replace('$1', '')).not.toMatch(/\$\d|\$<|\{\{/);
      expect(c.replaceString.slice(3, -3)).not.toContain('`');
    }
    // an odd quote in a row: ST adds one at the end of that line, which must not show up
    const sp = draw(fixMarkdown(run('<战况>\n{结算}\n|他说"走|\n</战况>').out));
    expect(sp.querySelector('.sp-row')!.textContent).toBe('他说"走');
  });
  it('makes JSON that reads back the same', () => {
    const v = { a: 'x"y\\', b: '$1 {{user}} <i> `*_*`', c: ['\\"'] };
    expect(JSON.parse(safeJson(v))).toEqual(v);
    expect(safeJson(v)).not.toMatch(/[$<>*_`]|\{\{/);
    // the only " left are the ones around strings
    expect(safeJson(v).replace(/\\\\/g, '')).not.toContain('\\"');
  });
});

describe('opening it again', () => {
  it('keeps the settings in the regex', () => {
    const c = compilePanel(p);
    expect(isPanel(c.replaceString)).toBe(true);
    const r = readPanel(c);
    expect(r?.edited).toBe(false);
    expect(r?.p).toEqual(cleanPanel(p));
  });
  it('notices code changed by hand, and ignores regexes it did not make', () => {
    const c = compilePanel(p);
    expect(readPanel({ ...c, replaceString: c.replaceString.replace('<div id="sp">', '<div id="sp" class="x">') })?.edited).toBe(true);
    expect(readPanel(newScript())).toBeNull();
    expect(readPanel({ findRegex: '', replaceString: '<!--stbs-panel:x:@@@-->' })).toBeNull();
  });
  it('makes junk usable', () => {
    const q = cleanPanel({ tag: '<a b>', sections: [{ name: 3 }], rules: [{ kind: 'nope' }, { kind: 'meter', name: 'HP', low: 300 }], theme: { bg: 5 } });
    expect(q.tag).toBe('ab');
    expect(q.sections[0]).toMatchObject({ name: '', icon: '◆', open: true });
    expect(q.rules).toEqual([{ kind: 'meter', name: 'HP', color: '#ffd166', low: 100, lowColor: '#e8892b' }]);
    expect(q.theme.bg).toBe('#1e1e32');
  });
});

describe('telling the AI', () => {
  it('writes a sample the card reads, using every rule', () => {
    const s = panelSample(p);
    expect(s.startsWith('<战况>\n{战况总览}\n|回合: 3 | 环境: 月影森林|')).toBe(true);
    const sp = draw(run(s).out);
    expect(sp.querySelectorAll('.sp-panel')).toHaveLength(2);
    expect(sp.querySelector('.sp-meter')).not.toBeNull();
    expect(sp.querySelector('.sp-stat')).not.toBeNull();
    expect(sp.querySelector('.sp-dice')).not.toBeNull();
  });
  it('explains the format', () => {
    const t = panelPrompt(p);
    expect(t).toContain('<战况> 和 </战况>');
    expect(t).toContain('{分段名}');
    expect(t).toContain('战况总览、结算');
    expect(t).toContain('HP 写成「名字 当前/最大」');
    expect(t).toContain('回合、环境');
  });
  it('starts a new one that already works', () => {
    const np = newPanel();
    const r = run(panelSample(np), np);
    expect(r.hits).toBe(1);
    expect(draw(r.out).querySelectorAll('.sp-panel')).toHaveLength(3);
  });
});

// A made-up card written the way hand-made battle panels are: a section table, a labels table, regexes for HP and
// stats, and CSS classes for each look.
const card = String.raw`<html><head><style>
* { margin: 0; }
body { font-family: serif; color: #e8d5b7; }
#output-container { max-width: 800px; }
.action-panel { background: linear-gradient(180deg, rgba(30,30,50,0.95) 0%, #141423 100%); border: 2px solid #8b7355; }
.panel-header { background: #2d2d44; }
.panel-title { color: #ffd700; }
.data-row { background: rgba(0,0,0,0.3); }
.tag-hp { background: #c53030; }
.tag-hp-low { background: #dd6b20; }
.tag-env { background: #2c5282; }
.stat-str { color: #fc8181; }
.dice { color: #63b3ed; }
.highlight-num { color: #fbd38d; }
</style></head><body><div id="out"></div>
<script>
const PanelConfig = {
  '总览': { icon: 'fa-solid fa-scroll', color: '#ffd700' },
  '總覽': { icon: 'fa-solid fa-scroll', color: '#ffd700' },
  '攻击': { color: '#fc8181', icon: 'fa-solid fa-crosshairs' },
};
const CraftIcons = {
  '锻造': { icon: 'fa-solid fa-hammer' },
};
function parse(text) {
  text.split('\n').forEach(function (line) {
    const t = line.match(/^\{(.+?)\}$/);
    if (_.startsWith(line, '|') && _.endsWith(line, '|')) rows.push(line);
  });
}
function row(html) {
  const labels = {
    round: '(?:回合|回合數)',
    env:   '(?:环境|環境)',
    check: '(?:检查\\(仅成品\\))'
  };
  html = html.replace(/HP\s*\[?(\d+)\/(\d+)\]?/g, function (m, cur, max) {
    const percent = (cur / max) * 100;
    const cls = percent > 50 ? 'tag-hp' : 'tag-hp-low';
    return '<span class="tag ' + cls + '">HP ' + cur + '/' + max + '</span>';
  });
  html = html.replace(/(^|[\s\|])(力)\[?(\d+)\]?/g, function (m, sep, _, val) {
    return sep + '<span class="stat stat-str"><i class="fa-solid fa-dumbbell"></i> 力量' + val + '</span>';
  });
  return html;
}
</script></body></html>`;

describe('recognizing a card someone wrote', () => {
  const r = recognizePanel({ findRegex: String.raw`/<action_info>((?:(?!<\/?action_info>)[\s\S])*?)<\/action_info>/gs`, replaceString: '```\n' + card + '\n```' })!;
  it('finds its tag, sections and how they are written', () => {
    expect(r.tag).toBe('action_info');
    expect(r.title).toBe('brace');
    expect(r.rows).toBe('pipe');
    expect(r.sections).toEqual([
      { name: '总览', aliases: ['總覽'], icon: '📜', color: '#ffd700', open: true },
      { name: '攻击', aliases: [], icon: '🎯', color: '#fc8181', open: true },
    ]);
  });
  it('finds what it does with the rows, with its colors', () => {
    expect(r.rules).toEqual([
      { kind: 'meter', name: 'HP', color: '#c53030', low: 50, lowColor: '#dd6b20' },
      { kind: 'field', name: '回合|回合數|环境|環境|检查(仅成品)', color: '#2c5282' },
      { kind: 'stat', name: '力', label: '力量', color: '#fc8181' },
      { kind: 'dice', name: '', color: '#63b3ed' },
      { kind: 'number', name: '', color: '#fbd38d' },
    ]);
    expect(r.theme).toEqual({ bg: '#1e1e32f2', border: '#8b7355', head: '#2d2d44', title: '#ffd700', text: '#e8d5b7', row: '#0000004d' });
  });
  it('makes a panel that reads what the old card read', () => {
    const sp = draw(run('<action_info>\n{總覽}\n|回合: 2 | HP 70/100 | 力9|\n</action_info>', r).out);
    expect(sp.querySelector('.sp-icon')!.textContent).toBe('📜');
    expect(sp.querySelector('.sp-meter')!.textContent).toBe('HP70/100');
    expect(sp.querySelector('.sp-stat')!.textContent).toBe('力量 9');
  });
  it('ends a field where the next one starts', () => {
    const sp = draw(run('<action_info>\n{攻击}\n|回合: 2 环境: 矿坑 -> 检查(仅成品): 过|\n</action_info>', r).out);
    expect([...sp.querySelectorAll('.sp-tag')].map((e) => e.textContent)).toEqual(['2', '矿坑', '过']);
  });
  it('gives up on cards with no section table', () => {
    expect(recognizePanel({ findRegex: '/<a>(.*)<\\/a>/', replaceString: '<div>$1</div>' })).toBeNull();
  });
});
