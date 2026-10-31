// A small code box for the advanced bits of the MVU editor (hand-written CSS, rewritten world book entries).
import { useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../store';

export function CodeBox({
  value,
  onChange,
  lang = 'text',
  readOnly,
  minHeight = '120px',
  maxHeight = '420px',
  placeholder,
}: {
  value: string;
  onChange?: (v: string) => void;
  lang?: 'css' | 'html' | 'text';
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
}) {
  const uiTheme = useStore((s) => s.uiTheme);
  const extensions = useMemo(() => [...(lang === 'css' ? [css()] : lang === 'html' ? [html()] : []), EditorView.lineWrapping], [lang]);
  return (
    <div className="code-box">
      <CodeMirror
        value={value}
        minHeight={minHeight}
        maxHeight={maxHeight}
        theme={uiTheme === 'dark' ? oneDark : 'light'}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={onChange}
        basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly, autocompletion: lang === 'css' }}
      />
    </div>
  );
}
