import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSubmissionDraft,
  createSubmissionPackage,
  listSubmissionPackages,
  preflightSubmission,
  resolveSubmissionArtifact,
  saveSubmissionManifest,
  type SubmissionManifest,
} from '../src/core/submission.js';

describe('submission packaging', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-submission-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('creates a metadata draft from a TeX manuscript', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`
      \title{A Careful Result}
      \author{Ada Lovelace \and Emmy Noether}
      \begin{abstract}We establish the main result.\end{abstract}
    `, 'utf8');

    const draft = await createSubmissionDraft(workspaceRoot, 'paper.tex');

    expect(draft).toMatchObject({
      title: 'A Careful Result',
      abstract: 'We establish the main result.',
      authors: [{ name: 'Ada Lovelace' }, { name: 'Emmy Noether' }],
      manuscriptPath: 'paper.tex',
    });
  });

  it('reports blocking source, citation, anonymity, and secret problems', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`
      \documentclass{article}
      \title{Leaky draft}
      \author{Named Researcher}
      \input{missing-section}
      \begin{document}Claim \cite{missing}. % TODO revise
      OPENAI_API_KEY=sk-example-secret-value-123456789
      \end{document}
    `, 'utf8');

    const result = await preflightSubmission(workspaceRoot, manifest({ profile: 'anonymous-conference' }));
    const codes = result.issues.map((current) => current.code);

    expect(result.packageable).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      'source_dependency_missing',
      'pdf_missing',
      'secret_detected',
      'citation_missing',
      'anonymity_author',
      'draft_marker',
    ]));
  });

  it('persists a manifest and creates bounded, downloadable package artifacts', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'section.tex'), 'A complete argument.', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), String.raw`
      \documentclass{article}
      \title{Packaged Result}
      \author{Ada Lovelace}
      \begin{document}\input{section}\end{document}
    `, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'paper.pdf'), onePagePdf());

    const input = manifest();
    await saveSubmissionManifest(workspaceRoot, input);
    const preflight = await preflightSubmission(workspaceRoot, input);
    const created = await createSubmissionPackage(workspaceRoot, input);
    const packages = await listSubmissionPackages(workspaceRoot);
    const bundle = await resolveSubmissionArtifact(workspaceRoot, created.id, 'submission-bundle.zip');
    const bundleBytes = await fs.readFile(bundle.absolute);
    const sourceZip = await resolveSubmissionArtifact(workspaceRoot, created.id, 'source.zip');
    const sourceBytes = await fs.readFile(sourceZip.absolute);

    expect(preflight).toMatchObject({ packageable: true, pdfPages: 1 });
    expect(preflight.sourceFiles).toEqual(['paper.tex', 'section.tex']);
    expect(created.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining([
      'manuscript.pdf',
      'checksums.json',
      'preflight.json',
      'source.zip',
      'submission-bundle.zip',
      'submission.json',
    ]));
    expect(packages).toMatchObject([{ id: created.id, title: 'Packaged Result' }]);
    expect(bundleBytes.subarray(0, 2).toString()).toBe('PK');
    expect(sourceBytes.toString('latin1')).toContain('paper.tex');
    expect(sourceBytes.toString('latin1')).toContain('section.tex');
  });

  it('rejects paths outside the workspace', async () => {
    await expect(saveSubmissionManifest(workspaceRoot, manifest({ manuscriptPath: '../paper.tex' })))
      .rejects.toThrow('escapes');
    await expect(resolveSubmissionArtifact(workspaceRoot, '../outside', 'submission-bundle.zip'))
      .rejects.toThrow('Invalid submission package ID');
  });

  it('refuses to persist submission data through an escaping metadata symlink', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-submission-outside-'));
    try {
      await fs.symlink(outsideRoot, path.join(workspaceRoot, '.octave'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(saveSubmissionManifest(workspaceRoot, manifest()))
        .rejects.toThrow('escapes the workspace');
      await expect(fs.readdir(outsideRoot)).resolves.toEqual([]);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

function manifest(overrides: {
  profile?: SubmissionManifest['venue']['profile'];
  manuscriptPath?: string;
} = {}): SubmissionManifest {
  return {
    version: 1,
    title: 'Packaged Result',
    abstract: 'A complete abstract.',
    authors: [{ name: 'Ada Lovelace', email: 'ada@example.test', corresponding: true }],
    keywords: ['verification', 'research'],
    manuscriptPath: overrides.manuscriptPath ?? 'paper.tex',
    supplementaryFiles: [],
    venue: {
      profile: overrides.profile ?? 'generic',
      name: 'Journal of Careful Results',
      articleType: 'Research article',
      maxPages: 12,
    },
    declarations: {
      authorshipConfirmed: true,
      conflictsReviewed: true,
      fundingReviewed: true,
      ethicsReviewed: true,
      licenseReviewed: true,
    },
    updatedAt: new Date().toISOString(),
  };
}

function onePagePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}
