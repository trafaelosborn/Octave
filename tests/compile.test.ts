import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileDocument, type CompileEngine } from '../src/core/compile.js';

describe('LaTeX compilation boundary', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-compile-'));
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), '\\documentclass{article}\\begin{document}Hi\\end{document}', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('rejects unsupported engines before spawning a process', async () => {
    await expect(compileDocument('paper.tex', workspaceRoot, {
      engine: 'shell' as CompileEngine,
    })).rejects.toThrow('Engine must be');
  });

  it('rejects documents outside the workspace', async () => {
    await expect(compileDocument('../paper.tex', workspaceRoot)).rejects.toThrow('escapes');
  });

  it('requires a TeX document', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'notes.md'), '# Notes', 'utf8');
    await expect(compileDocument('notes.md', workspaceRoot)).rejects.toThrow('Only .tex');
  });
});
