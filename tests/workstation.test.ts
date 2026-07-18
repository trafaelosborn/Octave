import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCitations } from '../app/lib/citations.js';
import { buildDiffHunks, materializeRevision } from '../app/lib/diff.js';
import { parseLatexOutline } from '../app/lib/outline.js';

describe('standalone workstation helpers', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-workstation-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('builds independently selectable revision hunks', () => {
    const beforeLines = ['alpha', ...Array.from({ length: 16 }, (_, index) => `line-${index + 1}`), 'omega'];
    const afterLines = [...beforeLines];
    afterLines[1] = 'LINE-1';
    afterLines[16] = 'LINE-16';
    const before = beforeLines.join('\n');
    const after = afterLines.join('\n');
    const hunks = buildDiffHunks(before, after);

    expect(hunks).toHaveLength(2);
    expect(materializeRevision(before, after, hunks, new Set([hunks[0]!.id])))
      .toBe(['alpha', 'LINE-1', ...beforeLines.slice(2)].join('\n'));
  });

  it('extracts a navigable LaTeX outline', () => {
    expect(parseLatexOutline('\\section{Claim}\n  \\subsection*{Proof \\emph{sketch}}'))
      .toEqual([
        { level: 'section', title: 'Claim', line: 1 },
        { level: 'subsection', title: 'Proof sketch', line: 2 },
      ]);
  });

  it('reports missing and unused bibliography keys', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), 'Known \\cite{known}. Missing \\citet{missing}.', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), '@article{known, title={Known}}\n@book{unused, title={Unused}}', 'utf8');

    const scan = await scanCitations(workspaceRoot);
    expect(scan.missing).toEqual([{ key: 'missing', path: 'paper.tex', line: 1 }]);
    expect(scan.unused).toEqual(['unused']);
    expect(scan.summary).toEqual({ cited: 2, bibliography: 2, missing: 1, unused: 1 });
  });
});
