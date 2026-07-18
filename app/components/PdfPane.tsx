import type { CompileEngine } from '@trafaelosborn/octave/core';

export function PdfPane({
  pdfUrl,
  selectedPath,
  compiling,
  engine,
  onEngineChange,
  onCompile,
}: {
  pdfUrl: string;
  selectedPath: string;
  compiling: boolean;
  engine: CompileEngine;
  onEngineChange: (engine: CompileEngine) => void;
  onCompile: () => void;
}) {
  const canCompile = selectedPath.endsWith('.tex');
  return (
    <aside className="pdf-pane">
      <header className="pane-header pdf-header">
        <div>
          <p className="eyebrow">Compiled artifact</p>
          <h2>{compiling ? 'Compiling document' : 'PDF preview'}</h2>
        </div>
        <div className="pdf-actions">
          <select value={engine} onChange={(event) => onEngineChange(event.target.value as CompileEngine)} aria-label="LaTeX engine">
            <option value="pdflatex">pdfLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
            <option value="tectonic">Tectonic</option>
          </select>
          <button className="button button-secondary" disabled={!canCompile || compiling} onClick={onCompile}>
            {compiling ? 'Compiling...' : 'Compile'}
          </button>
        </div>
      </header>
      {pdfUrl ? (
        <iframe title="Compiled research document" src={pdfUrl} className="pdf-frame" />
      ) : (
        <div className="empty-pane pdf-empty">
          <div className="paper-stack" aria-hidden="true"><span/><span/><span/></div>
          <h3>No compiled artifact yet</h3>
          <p>{canCompile ? 'Compile the active TeX document to keep the paper visible beside your work.' : 'Open a TeX document to create a PDF preview.'}</p>
        </div>
      )}
    </aside>
  );
}
