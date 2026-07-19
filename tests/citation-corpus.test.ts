import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBibTeX } from '../src/core/bibtex.js';
import {
  buildCitationCorpusIndex,
  citationDirectoryName,
  inspectCitationWorkspace,
  type CitationCorpusIndex,
} from '../src/core/citation-corpus.js';
import {
  loadCitationIndex,
  resolveCitationArtifactPath,
  saveCitationIndex,
} from '../src/storage/citation-storage.js';

describe('citation corpus registry', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-citations-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('parses nested and concatenated BibTeX fields', () => {
    const entries = parseBibTeX(`
      @article{smith2024,
        title = {A {Nested} Result},
        author = "Smith, Ada" # " and Doe, Ben",
        doi = {https://doi.org/10.1000/Example.1},
      }
      @string{ignored = "value"}
    `);

    expect(entries).toEqual([{
      type: 'article',
      key: 'smith2024',
      fields: {
        title: 'A {Nested} Result',
        author: 'Smith, Ada and Doe, Ben',
        doi: 'https://doi.org/10.1000/Example.1',
      },
    }]);
  });

  it('builds cited, missing, ambiguous, and not-requested source records', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`
      Evidence \cite{smith2024,preprint,missingKey,duplicate}.
    `, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), `
      @article{smith2024,
        title = {A {Nested} Result},
        author = {Smith, Ada and Doe, Ben},
        year = {2024},
        doi = {https://doi.org/10.1000/Example.1}
      }
      @misc{preprint, title={Open preprint}, archivePrefix={arXiv}, eprint={2401.12345v2}}
      @article{duplicate, title={First definition}}
      @article{duplicate, title={Second definition}}
      @book{unused, title={Unused source}, year={1999}}
    `, 'utf8');

    const inventory = await inspectCitationWorkspace(workspaceRoot);
    const index = buildCitationCorpusIndex(inventory);
    const byKey = new Map(index.records.map((record) => [record.key, record]));

    expect(inventory.occurrences).toHaveLength(4);
    expect(byKey.get('smith2024')).toMatchObject({
      cited: true,
      status: 'unresolved',
      identifiers: { doi: '10.1000/example.1' },
      metadata: { title: 'A Nested Result', authors: ['Smith, Ada', 'Doe, Ben'], year: '2024' },
    });
    expect(byKey.get('preprint')?.identifiers.arxivId).toBe('2401.12345v2');
    expect(byKey.get('missingKey')).toMatchObject({ status: 'manual_required', entryType: 'missing' });
    expect(byKey.get('duplicate')).toMatchObject({ status: 'ambiguous' });
    expect(byKey.get('unused')).toMatchObject({ cited: false, status: 'not_requested' });
    expect(byKey.get('smith2024')?.directory).toBe(`citations/${citationDirectoryName('smith2024')}`);
  });

  it('preserves completed acquisition state while bibliography fingerprints remain stable', async () => {
    const inventory = {
      occurrences: [{ key: 'paper', path: 'draft.tex', line: 1, context: String.raw`Claim \cite{paper}.` }],
      entries: [{ type: 'article', key: 'paper', fields: { doi: '10.1000/test' }, sourcePath: 'refs.bib' }],
    };
    const first = buildCitationCorpusIndex(inventory);
    const record = first.records[0];
    if (!record) throw new Error('Expected a citation record.');
    record.status = 'downloaded';
    record.acquisition = {
      source: 'unpaywall',
      acquiredAt: '2026-07-19T12:00:00.000Z',
      originalPath: `${record.directory}/source.pdf`,
      extractedPath: `${record.directory}/extracted.md`,
      chunksPath: `${record.directory}/chunks.jsonl`,
      mediaType: 'application/pdf',
      bytes: 100,
      sha256: 'abc',
    };

    const rebuilt = buildCitationCorpusIndex(inventory, first);
    expect(rebuilt.records[0]).toMatchObject({ status: 'downloaded', acquisition: record.acquisition });

    inventory.entries[0]!.fields.doi = '10.1000/changed';
    const changed = buildCitationCorpusIndex(inventory, first);
    expect(changed.records[0]?.status).toBe('unresolved');
    expect(changed.records[0]?.acquisition).toBeUndefined();
  });

  it('atomically saves the index and rejects citation artifact escapes', async () => {
    const index: CitationCorpusIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      records: [{
        key: 'safe',
        directory: `citations/${citationDirectoryName('safe')}`,
        cited: true,
        status: 'unresolved',
        fingerprint: 'fingerprint',
        entryType: 'article',
        bibPaths: ['refs.bib'],
        identifiers: { doi: '10.1000/safe' },
        metadata: { title: 'Safe paper' },
      }],
    };

    await saveCitationIndex(workspaceRoot, index);
    expect(await loadCitationIndex(workspaceRoot)).toEqual(index);
    expect(resolveCitationArtifactPath(workspaceRoot, `${index.records[0]!.directory}/source.pdf`))
      .toContain(path.join('citations', citationDirectoryName('safe'), 'source.pdf'));
    expect(() => resolveCitationArtifactPath(workspaceRoot, 'citations/../../outside.pdf'))
      .toThrow('escapes the workspace');
  });
});
