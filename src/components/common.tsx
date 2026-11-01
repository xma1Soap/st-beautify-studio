// Small inputs shared by the editors. They keep what is being typed locally, so half-typed values
// ("-", "1.", an empty line) don't get thrown away, and only hand finished values to the store.
import { useEffect, useState, type ReactNode } from 'react';
import { useLevel, useMode, type Mode } from '../mode';
import { useStore } from '../store';

export function ModeSwitch() {
  const mode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  const items: { id: Mode; label: string; title: string }[] = [
    { id: 'mvu', label: 'MVU 角色卡', title: '做一张带变量和状态栏的角色卡' },
    { id: 'regex', label: '正则美化', title: '给纯文字的 AI 回复做美化正则' },
  ];
  return (
    <div className="seg mode-switch" role="group" aria-label="模式">
      {items.map((it) => (
        <button key={it.id} className={mode === it.id ? 'on' : ''} title={it.title} onClick={() => setMode(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 简易 / 进阶: 简易 hides the settings newcomers don't need (they keep their values). */
export function LevelSwitch() {
  const level = useLevel((s) => s.level);
  const setLevel = useLevel((s) => s.setLevel);
  return (
    <div className="seg level-switch" role="group" aria-label="编辑方式">
      <button className={level === 'simple' ? 'on' : ''} title="只显示常用的设置" onClick={() => setLevel('simple')}>
        简易
      </button>
      <button className={level === 'advanced' ? 'on' : ''} title="显示全部设置：字体、内边距、阴影、动效、类名、自己写 CSS、正则的细节……" onClick={() => setLevel('advanced')}>
        进阶
      </button>
    </div>
  );
}

export function ThemeButton() {
  const uiTheme = useStore((s) => s.uiTheme);
  const setUiTheme = useStore((s) => s.setUiTheme);
  return (
    <button className="ghost" onClick={() => setUiTheme(uiTheme === 'dark' ? 'light' : 'dark')}>
      {uiTheme === 'dark' ? '☀ 亮色界面' : '☾ 暗色界面'}
    </button>
  );
}

/** `adv`: only shown in 进阶 mode. */
export function Field({ label, note, children, adv }: { label: string; note?: ReactNode; children: ReactNode; adv?: boolean }) {
  return (
    <div className={'field' + (adv ? ' adv' : '')}>
      <div className="flabel">{label}</div>
      <div className="fbody">
        {children}
        {note && <div className="hint fnote">{note}</div>}
      </div>
    </div>
  );
}

const toLines = (t: string) =>
  t
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/** One item per line. */
export function LinesInput({ value, onChange, rows = 3, placeholder }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    if (toLines(text).join('\n') !== value.join('\n')) setText(value.join('\n'));
    // only react to changes from outside (undo, another field), not to our own typing
  }, [value]);
  return (
    <textarea
      rows={rows}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(toLines(e.target.value));
      }}
    />
  );
}

/** A number, or nothing when `optional` and left empty. */
export function NumberInput({
  value,
  onChange,
  optional,
  placeholder,
  className = 'num',
}: {
  value: number | null | undefined;
  onChange: (v: number | undefined) => void;
  optional?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const shown = value == null ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => {
    const n = text.trim() === '' ? undefined : Number(text);
    if ((n ?? null) !== (value ?? null)) setText(shown);
  }, [value]);
  const bad = text.trim() !== '' && isNaN(Number(text));
  return (
    <input
      className={className + (bad || (!optional && text.trim() === '') ? ' bad' : '')}
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? (optional ? '不限' : '')}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        if (t === '') {
          if (optional) onChange(undefined);
        } else if (!isNaN(Number(t))) onChange(Number(t));
      }}
    />
  );
}

export function CopyButton({ text }: { text: string }) {
  const notify = useStore((s) => s.notify);
  return (
    <button
      className="small"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => notify('已复制'),
          () => notify('复制失败，请手动选中复制'),
        )
      }
    >
      复制
    </button>
  );
}
