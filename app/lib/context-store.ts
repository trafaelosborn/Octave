import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDirectory, resolveSafePath } from '@trafaelosborn/octave/core';

interface ContextStore {
  pinnedPaths: string[];
  updatedAt: string;
}

export async function listPinnedPaths(workspaceRoot: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(contextPath(workspaceRoot), 'utf8')) as Partial<ContextStore>;
    if (!Array.isArray(parsed.pinnedPaths)) return [];
    return parsed.pinnedPaths.filter((value): value is string => typeof value === 'string');
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw new Error('Could not read pinned context.');
  }
}

export async function savePinnedPaths(workspaceRoot: string, paths: string[]): Promise<string[]> {
  const clean = [...new Set(paths.map((item) => item.trim()).filter(Boolean))];
  for (const documentPath of clean) resolveSafePath(documentPath, workspaceRoot);

  const directory = path.join(workspaceRoot, '.octave');
  await ensureDirectory(directory);
  await fs.writeFile(contextPath(workspaceRoot), `${JSON.stringify({
    pinnedPaths: clean,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return clean;
}

function contextPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.octave', 'context.json');
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
