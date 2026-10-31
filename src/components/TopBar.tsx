import { useStore } from '../store';
import { exportScripts, importRegex, newProject, openProject, saveProject } from '../actions';
import { ModeSwitch, ThemeButton } from './common';

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const setName = useStore((s) => s.setName);

  return (
    <header className="topbar">
      <div className="brand"><span className="logo">✦</span>酒馆美化工坊</div>
      <ModeSwitch />
      <div className="pname" title={filePath || '还没保存过'}>
        <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        {dirty && <span className="dirty" title="有未保存的修改">●</span>}
      </div>
      <div className="btn-group">
        <button onClick={newProject}>新建</button>
        <button onClick={openProject} title="Ctrl+O">打开</button>
        <button onClick={() => saveProject()} title="Ctrl+S">保存</button>
        <button onClick={() => saveProject(true)} title="Ctrl+Shift+S">另存为</button>
      </div>
      <div className="btn-group">
        <button onClick={importRegex}>导入正则</button>
        <button onClick={() => exportScripts('selected')}>导出当前</button>
        <button className="primary" onClick={() => exportScripts('all')}>导出全部</button>
      </div>
      <span className="sp" />
      <ThemeButton />
    </header>
  );
}
