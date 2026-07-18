import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listProjectFiles,
  readDocument,
  resolveExistingDocumentPath,
  resolvePdfArtifactPath,
  resolveSafePath,
  writeDocument,
} from '../src/core/path.js';

describe('workspace paths', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-path-'));
    await fs.mkdir(path.join(workspaceRoot, 'notes'));
    await fs.mkdir(path.join(workspaceRoot, 'node_modules'));
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), 'paper', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'notes', 'idea.md'), 'idea', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'image.png'), 'ignored', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'node_modules', 'hidden.md'), 'ignored', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('resolves supported relative paths', () => {
    const resolved = resolveSafePath('notes\\idea.md', workspaceRoot);
    expect(resolved.relative).toBe('notes/idea.md');
    expect(resolved.extension).toBe('.md');
  });

  it('rejects traversal, absolute paths, and unsupported files', () => {
    expect(() => resolveSafePath('../secret.tex', workspaceRoot)).toThrow('escapes');
    expect(() => resolveSafePath('C:\\secret.tex', workspaceRoot)).toThrow('relative');
    expect(() => resolveSafePath('image.png', workspaceRoot)).toThrow('Unsupported');
  });

  it('lists only supported research files', async () => {
    const files = await listProjectFiles(workspaceRoot);
    expect(files.map((file) => file.path)).toEqual(['paper.tex', 'notes/idea.md', 'image.png']);
    expect(files.find((file) => file.path === 'image.png')?.editable).toBe(false);
  });

  it('reads bounded document content', async () => {
    const document = await readDocument('paper.tex', workspaceRoot, 3);
    expect(document.content).toBe('pap');
    expect(document.truncated).toBe(true);
  });

  it('creates and updates supported documents inside an existing workspace directory', async () => {
    const created = await writeDocument('notes/result.md', workspaceRoot, '# Result');
    expect(created.relative).toBe('notes/result.md');
    await expect(fs.readFile(created.absolute, 'utf8')).resolves.toBe('# Result');

    await writeDocument('notes/result.md', workspaceRoot, '# Revised result');
    await expect(fs.readFile(created.absolute, 'utf8')).resolves.toBe('# Revised result');
  });

  it('does not create missing parent directories as an implicit write side effect', async () => {
    await expect(writeDocument('missing/result.md', workspaceRoot, 'result')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves PDF artifacts against the real workspace boundary', async () => {
    const missingPdf = await resolvePdfArtifactPath('paper.tex', workspaceRoot);
    expect(missingPdf.relative).toBe('paper.pdf');
    expect(missingPdf.absolute).toBe(path.join(workspaceRoot, 'paper.pdf'));

    await fs.writeFile(path.join(workspaceRoot, 'paper.pdf'), 'pdf', 'utf8');
    const existingPdf = await resolvePdfArtifactPath('paper.tex', workspaceRoot);
    expect(existingPdf.absolute).toBe(await fs.realpath(path.join(workspaceRoot, 'paper.pdf')));
  });

  it.skipIf(process.platform === 'win32')('rejects PDF artifact links that leave the workspace', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-pdf-outside-'));
    try {
      const outsidePdf = path.join(outsideRoot, 'paper.pdf');
      await fs.writeFile(outsidePdf, 'secret', 'utf8');
      await fs.symlink(outsidePdf, path.join(workspaceRoot, 'paper.pdf'));
      await expect(resolvePdfArtifactPath('paper.tex', workspaceRoot)).rejects.toThrow('escapes');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('rejects symbolic links that leave the workspace', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-outside-'));
    try {
      await fs.writeFile(path.join(outsideRoot, 'secret.tex'), 'secret', 'utf8');
      await fs.symlink(path.join(outsideRoot, 'secret.tex'), path.join(workspaceRoot, 'linked.tex'));
      await expect(resolveExistingDocumentPath('linked.tex', workspaceRoot)).rejects.toThrow('escapes');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
