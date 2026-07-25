import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCitationCheckReport,
  buildCitationCorpusIndex,
  inspectCitationWorkspace,
  isCitationCheckStale,
} from '../src/core/index.js';
import {
  loadCitationAudit,
  loadCitationCheck,
  resolveCitationArtifactPath,
  saveCitationIndex,
} from '../src/storage/index.js';

describe('citation check report', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-check-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('classifies cited claims and writes machine-readable and Markdown reports', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), [
      String.raw`The invariant is monotone under refinement \cite{sourceA}.`,
      String.raw`Quantum zebras cross the boundary \cite{sourceA}.`,
      String.raw`The estimator is unbiased \cite{missingSource}.`,
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), '@article{sourceA, title={Invariant paper}}', 'utf8');

    const inventory = await inspectCitationWorkspace(workspaceRoot);
    const index = buildCitationCorpusIndex(inventory);
    const sourceA = index.records.find((record) => record.key === 'sourceA');
    if (!sourceA) throw new Error('Expected sourceA.');
    sourceA.status = 'downloaded';
    sourceA.acquisition = acquisition(sourceA.directory);
    await saveCitationIndex(workspaceRoot, index);
    await fs.writeFile(
      resolveCitationArtifactPath(workspaceRoot, sourceA.acquisition.chunksPath),
      JSON.stringify({
        id: 'sourceA:1',
        citationKey: 'sourceA',
        locator: 'Results',
        text: 'The invariant remains monotone under every refinement operation.',
      }) + '\n',
      'utf8',
    );

    const report = await buildCitationCheckReport(workspaceRoot);

    expect(report.summary).toMatchObject({
      claims: 3,
      likely_supported: 1,
      no_candidate_passage: 1,
      bibliography_missing: 1,
      errors: 2,
    });
    expect(report.findings.map((finding) => finding.verdict)).toEqual([
      'likely_supported',
      'no_candidate_passage',
      'bibliography_missing',
    ]);
    expect(await loadCitationCheck(workspaceRoot)).toEqual(report);
    expect(await fs.readFile(path.join(workspaceRoot, 'citations', 'check.md'), 'utf8'))
      .toContain('Citation check report');
  });

  it('detects stale check reports when the underlying audit changes', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`Claim \cite{source}.`, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), '@article{source, title={First}}', 'utf8');
    await saveCitationIndex(workspaceRoot, buildCitationCorpusIndex(await inspectCitationWorkspace(workspaceRoot)));

    const report = await buildCitationCheckReport(workspaceRoot);
    const audit = await loadCitationAudit(workspaceRoot);
    const index = buildCitationCorpusIndex(await inspectCitationWorkspace(workspaceRoot));
    expect(isCitationCheckStale(report, audit, index, await inspectCitationWorkspace(workspaceRoot))).toBe(false);

    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`Changed claim \cite{source}.`, 'utf8');
    expect(isCitationCheckStale(report, audit, index, await inspectCitationWorkspace(workspaceRoot))).toBe(true);
  });
});

function acquisition(directory: string) {
  return {
    source: 'manual' as const,
    acquiredAt: '2026-07-24T12:00:00.000Z',
    originalPath: `${directory}/manual.pdf`,
    extractedPath: `${directory}/extracted.md`,
    chunksPath: `${directory}/chunks.jsonl`,
    mediaType: 'application/pdf',
    bytes: 100,
    sha256: 'hash',
  };
}
