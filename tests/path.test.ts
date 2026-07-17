import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listProjectFiles,
  readDocument,
  resolveExistingDocumentPath,
  resolveSafePath,
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
    expect(files.map((file) => file.path)).toEqual(['paper.tex', 'notes/idea.md']);
  });

  it('reads bounded document content', async () => {
    const document = await readDocument('paper.tex', workspaceRoot, 3);
    expect(document.content).toBe('pap');
    expect(document.truncated).toBe(true);
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
