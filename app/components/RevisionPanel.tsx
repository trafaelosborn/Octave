import { useMemo } from 'react';
import { buildDiffHunks, type DiffHunk, type DiffRow } from '../lib/diff';
import type { RevisionPreview } from '../lib/client-types';

export function RevisionPanel({
  revision,
  includedHunks,
  busy,
  onToggleHunk,
  onIncludeAll,
  onExcludeAll,
  onApply,
  onDiscard,
}: {
  revision: RevisionPreview | null;
  includedHunks: ReadonlySet<string>;
  busy: boolean;
  onToggleHunk: (hunkId: string) => void;
  onIncludeAll: () => void;
  onExcludeAll: () => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const hunks = useMemo(
    () => revision ? buildDiffHunks(revision.before, revision.after) : [],
    [revision],
  );

  if (!revision) {
    return (
      <div className="empty-pane review-empty">
        <div className="review-mark" aria-hidden="true">✓</div>
        <h3>No proposed changes</h3>
        <p>Ask Octave to propose an edit from the Chat view. Nothing is written until you review and apply it.</p>
      </div>
    );
  }

  const added = hunks.reduce((sum, hunk) => sum + hunk.added, 0);
  const removed = hunks.reduce((sum, hunk) => sum + hunk.removed, 0);
  return (
    <div className="revision-panel">
      <header className="revision-header">
        <div>
          <p className="eyebrow">Review before writing</p>
          <h2>{revision.path}</h2>
          <p className="revision-instruction">“{revision.instruction}”</p>
        </div>
        <div className="revision-summary">
          <span className="diff-added">+{added}</span>
          <span className="diff-removed">-{removed}</span>
          <span>{includedHunks.size}/{hunks.length} hunks included</span>
        </div>
      </header>

      <div className="revision-toolbar">
        <button className="text-button" onClick={onIncludeAll}>Include all</button>
        <button className="text-button" onClick={onExcludeAll}>Exclude all</button>
        <span className="toolbar-spacer" />
        <button className="button button-quiet" onClick={onDiscard} disabled={busy}>Discard proposal</button>
        <button className="button button-primary" onClick={onApply} disabled={busy || includedHunks.size === 0}>
          {busy ? 'Applying...' : 'Apply selected changes'}
        </button>
      </div>

      <div className="hunk-list">
        {hunks.map((hunk, index) => (
          <DiffHunkCard
            key={hunk.id}
            hunk={hunk}
            index={index}
            included={includedHunks.has(hunk.id)}
            onToggle={() => onToggleHunk(hunk.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DiffHunkCard({
  hunk,
  index,
  included,
  onToggle,
}: {
  hunk: DiffHunk;
  index: number;
  included: boolean;
  onToggle: () => void;
}) {
  return (
    <section className={`diff-card ${included ? 'included' : 'excluded'}`}>
      <header>
        <label>
          <input type="checkbox" checked={included} onChange={onToggle} />
          <span>Hunk {index + 1}</span>
        </label>
        <span><b className="diff-added">+{hunk.added}</b> <b className="diff-removed">-{hunk.removed}</b></span>
      </header>
      <div className="diff-scroll">
        <table className="diff-table">
          <tbody>{hunk.rows.map((row, rowIndex) => <DiffRowView key={rowIndex} row={row} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function DiffRowView({ row }: { row: DiffRow }) {
  if (row.kind === 'omit') {
    return <tr className="diff-omit"><td colSpan={4}>{row.text}</td></tr>;
  }
  const marker = row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' ';
  return (
    <tr className={`diff-row diff-${row.kind}`}>
      <td className="line-cell">{row.beforeLine ?? ''}</td>
      <td className="line-cell">{row.afterLine ?? ''}</td>
      <td className="marker-cell">{marker}</td>
      <td className="source-cell">{row.text || ' '}</td>
    </tr>
  );
}
