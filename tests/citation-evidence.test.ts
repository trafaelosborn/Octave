import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCitationCorpusIndex,
  inspectCitationWorkspace,
} from '../src/core/citation-corpus.js';
import {
  buildCitationEvidenceAudit,
  isCitationAuditStale,
} from '../src/core/citation-evidence.js';
import {
  loadCitationAudit,
  resolveCitationArtifactPath,
  saveCitationIndex,
} from '../src/storage/citation-storage.js';

describe('citation evidence packets', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-evidence-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('retrieves passages only from the source bound to each citation key', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), [
      String.raw`The invariant is monotone under refinement \cite{sourceA}.`,
      String.raw`Quantum zebras cross the boundary \cite{sourceA}.`,
      String.raw`The estimator is unbiased \cite{missingSource}.`,
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), [
      '@article{sourceA, title={Invariant paper}}',
      '@article{sourceB, title={Different estimator paper}}',
    ].join('\n'), 'utf8');

    const inventory = await inspectCitationWorkspace(workspaceRoot);
    const index = buildCitationCorpusIndex(inventory);
    const sourceA = index.records.find((record) => record.key === 'sourceA');
    if (!sourceA) throw new Error('Expected sourceA.');
    sourceA.status = 'downloaded';
    sourceA.acquisition = acquisition(sourceA.directory);
    await saveCitationIndex(workspaceRoot, index);

    await fs.writeFile(
      resolveCitationArtifactPath(workspaceRoot, sourceA.acquisition.chunksPath),
      [
        JSON.stringify({ id: 'sourceA:1', citationKey: 'sourceA', locator: 'Results', text: 'The invariant remains monotone under every refinement operation.' }),
        JSON.stringify({ id: 'sourceB:wrong', citationKey: 'sourceB', locator: 'Elsewhere', text: 'Quantum zebras cross the boundary.' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const audit = await buildCitationEvidenceAudit(workspaceRoot);
    expect(audit.summary).toEqual({ claims: 3, evidenceFound: 1, noLexicalMatch: 1, sourceUnavailable: 1 });
    expect(audit.packets[0]).toMatchObject({
      citationKey: 'sourceA',
      status: 'evidence_found',
      passages: [{ chunkId: 'sourceA:1', locator: 'Results' }],
    });
    expect(audit.packets[1]).toMatchObject({ citationKey: 'sourceA', status: 'no_lexical_match', passages: [] });
    expect(audit.packets[2]).toMatchObject({ citationKey: 'missingSource', status: 'source_unavailable', passages: [] });
    expect(audit.packets.flatMap((packet) => packet.passages).some((passage) => passage.chunkId === 'sourceB:wrong')).toBe(false);
    expect(await loadCitationAudit(workspaceRoot)).toEqual(audit);
  });

  it('detects evidence audits made stale by bibliography changes', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`Claim \cite{source}.`, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), '@article{source, title={First}}', 'utf8');
    const inventory = await inspectCitationWorkspace(workspaceRoot);
    const index = buildCitationCorpusIndex(inventory);
    await saveCitationIndex(workspaceRoot, index);
    const audit = await buildCitationEvidenceAudit(workspaceRoot);
    expect(isCitationAuditStale(audit, index)).toBe(false);

    index.records[0]!.fingerprint = 'changed';
    expect(isCitationAuditStale(audit, index)).toBe(true);

    const refreshedIndex = buildCitationCorpusIndex(await inspectCitationWorkspace(workspaceRoot));
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`Changed claim \cite{source}.`, 'utf8');
    expect(isCitationAuditStale(audit, refreshedIndex, await inspectCitationWorkspace(workspaceRoot))).toBe(true);
  });
});

function acquisition(directory: string) {
  return {
    source: 'manual' as const,
    acquiredAt: '2026-07-19T12:00:00.000Z',
    originalPath: `${directory}/manual.pdf`,
    extractedPath: `${directory}/extracted.md`,
    chunksPath: `${directory}/chunks.jsonl`,
    mediaType: 'application/pdf',
    bytes: 100,
    sha256: 'hash',
  };
}
