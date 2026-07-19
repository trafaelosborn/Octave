import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parseOfficeMock = vi.fn();
vi.mock('officeparser', () => ({ parseOffice: parseOfficeMock }));

const {
  chunkCitationText,
  extractJatsMarkdown,
  syncCitationCorpus,
} = await import('../src/core/citation-acquisition.js');

describe('citation acquisition', () => {
  let workspaceRoot: string;
  const now = () => new Date('2026-07-19T12:00:00.000Z');
  const resolveHost = async () => ['93.184.216.34'];

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-acquire-'));
    parseOfficeMock.mockReset();
    parseOfficeMock.mockResolvedValue({
      toText: () => 'Methods establish the invariant.\n\nResults confirm the primary claim.',
      warnings: [],
    });
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('downloads, validates, extracts, hashes, and chunks an arXiv PDF', async () => {
    await writeProject(
      String.raw`Evidence \cite{preprint}.`,
      '@misc{preprint, title={Open preprint}, archivePrefix={arXiv}, eprint={2401.12345v2}}',
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('arxiv.org/pdf/2401.12345v2.pdf');
      return new Response(Buffer.from('%PDF-test citation'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    });

    const index = await syncCitationCorpus(workspaceRoot, {
      fetch: fetchMock as unknown as typeof fetch,
      resolveHost,
      now,
    });
    const record = index.records[0];

    expect(record).toMatchObject({
      key: 'preprint',
      status: 'downloaded',
      acquisition: {
        source: 'arxiv',
        mediaType: 'application/pdf',
        acquiredAt: '2026-07-19T12:00:00.000Z',
      },
    });
    const extracted = await fs.readFile(path.join(workspaceRoot, ...record!.acquisition!.extractedPath.split('/')), 'utf8');
    const chunks = await fs.readFile(path.join(workspaceRoot, ...record!.acquisition!.chunksPath.split('/')), 'utf8');
    expect(extracted).toContain('Methods establish the invariant.');
    expect(chunks).toContain('"citationKey":"preprint"');
    expect(record?.acquisition?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses Crossref metadata and an Unpaywall open-access location for DOI sources', async () => {
    await writeProject(String.raw`Evidence \cite{doiPaper}.`, '@article{doiPaper, doi={10.1000/test}}');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) {
        return jsonResponse({ message: {
          title: ['Canonical source title'],
          author: [{ given: 'Ada', family: 'Smith' }],
          issued: { 'date-parts': [[2025]] },
          'container-title': ['Journal of Tests'],
        } });
      }
      if (url.includes('/idconv/')) return jsonResponse({ records: [{}] });
      if (url.includes('api.unpaywall.org')) {
        return jsonResponse({
          is_oa: true,
          best_oa_location: {
            url_for_pdf: 'https://repository.example/paper.pdf',
            url_for_landing_page: 'https://repository.example/record',
            license: 'cc-by',
            version: 'acceptedVersion',
          },
        });
      }
      if (url === 'https://repository.example/paper.pdf') {
        return new Response(Buffer.from('%PDF-open copy'), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const index = await syncCitationCorpus(workspaceRoot, {
      email: 'researcher@example.com',
      fetch: fetchMock as unknown as typeof fetch,
      resolveHost,
      now,
    });

    expect(index.records[0]).toMatchObject({
      status: 'downloaded',
      metadata: {
        title: 'Canonical source title',
        authors: ['Smith, Ada'],
        year: '2025',
        venue: 'Journal of Tests',
      },
      acquisition: {
        source: 'unpaywall',
        license: 'cc-by',
        version: 'acceptedVersion',
        landingPageUrl: 'https://repository.example/record',
      },
    });
  });

  it('flags closed DOI sources without substituting a different paper', async () => {
    await writeProject(String.raw`Evidence \cite{closed}.`, '@article{closed, doi={10.1000/closed}}');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) return jsonResponse({ message: {} });
      if (url.includes('/idconv/')) return jsonResponse({ records: [{}] });
      if (url.includes('api.unpaywall.org')) return jsonResponse({ is_oa: false, best_oa_location: null });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const index = await syncCitationCorpus(workspaceRoot, {
      email: 'researcher@example.com',
      fetch: fetchMock as unknown as typeof fetch,
      resolveHost,
      now,
    });

    expect(index.records[0]).toMatchObject({
      status: 'blocked_by_license',
      reason: 'No legitimate open-access copy is currently indexed.',
    });
    expect(index.records[0]?.acquisition).toBeUndefined();
  });

  it('imports manually supplied JATS XML and removes its reference list from evidence text', async () => {
    await writeProject(String.raw`Evidence \cite{manual}.`, '@article{manual, title={Manual source}}');
    const emptyFetch = vi.fn(async () => { throw new Error('Network should not be used.'); });
    const first = await syncCitationCorpus(workspaceRoot, {
      fetch: emptyFetch as unknown as typeof fetch,
      resolveHost,
      now,
    });
    const record = first.records[0];
    if (!record) throw new Error('Expected a citation record.');
    const manualPath = path.join(workspaceRoot, ...record.directory.split('/'), 'manual.xml');
    await fs.writeFile(manualPath, `
      <article><front><article-title>Manual Evidence</article-title></front>
      <body><sec><title>Results</title><p>The cited result is supported.</p></sec></body>
      <back><ref-list><p>Unrelated reference text.</p></ref-list></back></article>
    `, 'utf8');

    const second = await syncCitationCorpus(workspaceRoot, {
      fetch: emptyFetch as unknown as typeof fetch,
      resolveHost,
      now,
    });
    const acquired = second.records[0];
    const extracted = await fs.readFile(path.join(workspaceRoot, ...acquired!.acquisition!.extractedPath.split('/')), 'utf8');
    expect(acquired).toMatchObject({ status: 'downloaded', acquisition: { source: 'manual', mediaType: 'application/xml' } });
    expect(extracted).toContain('The cited result is supported.');
    expect(extracted).not.toContain('Unrelated reference text.');
  });

  it('refuses private-network download locations returned by metadata services', async () => {
    await writeProject(String.raw`Evidence \cite{unsafe}.`, '@article{unsafe, doi={10.1000/unsafe}}');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.crossref.org')) return jsonResponse({ message: {} });
      if (url.includes('/idconv/')) return jsonResponse({ records: [{}] });
      if (url.includes('api.unpaywall.org')) {
        return jsonResponse({ is_oa: true, best_oa_location: { url_for_pdf: 'https://127.0.0.1/private.pdf' } });
      }
      throw new Error(`Private URL should not be fetched: ${url}`);
    });

    const index = await syncCitationCorpus(workspaceRoot, {
      email: 'researcher@example.com',
      fetch: fetchMock as unknown as typeof fetch,
      resolveHost,
      now,
    });
    expect(index.records[0]?.status).toBe('manual_required');
    expect(index.records[0]?.attempts?.some((attempt) => attempt.message.includes('private or non-routable'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('creates bounded chunks and readable Markdown from structured XML', () => {
    const markdown = extractJatsMarkdown('<article><body><sec><title>Methods</title><p>Alpha &amp; beta.</p></sec></body></article>');
    expect(markdown).toContain('## Methods');
    expect(markdown).toContain('Alpha & beta.');
    const chunks = chunkCitationText('key', `## Methods\n\n${'Evidence sentence. '.repeat(200)}`, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.locator === 'Methods' && chunk.text.length <= 400)).toBe(true);
  });

  async function writeProject(tex: string, bib: string): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), tex, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'references.bib'), bib, 'utf8');
  }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
