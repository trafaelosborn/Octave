import fs from 'node:fs/promises';
import path from 'node:path';

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.tex',
  '.bib',
  '.md',
  '.txt',
  '.sty',
  '.cls',
  '.py',
  '.r',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.octave',
  '.pytest_cache',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'toolchains',
]);

export interface OctaveFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
}

export interface ResolvedPath {
  absolute: string;
  relative: string;
  extension: string;
}

export interface DocumentContent {
  path: string;
  content: string;
  truncated: boolean;
}

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export function resolveSafePath(input: string, root: string): ResolvedPath {
  const clean = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  if (!clean) throw new Error('A document path is required.');
  if (clean.includes('\0')) throw new Error('Invalid document path.');
  if (/^[a-z]:/i.test(clean)) {
    throw new Error('Use a path relative to the workspace root.');
  }

  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, clean);
  assertInsideRoot(absolute, resolvedRoot);

  const relative = path.relative(resolvedRoot, absolute).replace(/\\/g, '/');
  const extension = path.extname(relative).toLowerCase();

  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type: ${extension || '(none)'}`);
  }

  return { absolute, relative, extension };
}

export async function resolveExistingDocumentPath(input: string, root: string): Promise<ResolvedPath> {
  const candidate = resolveSafePath(input, root);
  const realRoot = await fs.realpath(path.resolve(root));
  const realTarget = await fs.realpath(candidate.absolute);
  assertInsideRoot(realTarget, realRoot);

  return {
    absolute: realTarget,
    relative: candidate.relative,
    extension: candidate.extension,
  };
}

export function resolvePdfPath(documentPath: string, root: string): {
  source: ResolvedPath;
  absolute: string;
  relative: string;
} {
  const source = resolveSafePath(documentPath, root);
  if (source.extension !== '.tex') {
    throw new Error('PDF preview is only available for .tex files.');
  }

  return {
    source,
    absolute: source.absolute.replace(/\.tex$/i, '.pdf'),
    relative: source.relative.replace(/\.tex$/i, '.pdf'),
  };
}

export async function readDocument(
  documentPath: string,
  root: string,
  maxChars = 80_000,
): Promise<DocumentContent> {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new Error('maxChars must be a positive integer.');
  }

  const resolved = await resolveExistingDocumentPath(documentPath, root);
  const content = await fs.readFile(resolved.absolute, 'utf8');
  const truncated = content.length > maxChars;

  return {
    path: resolved.relative,
    content: truncated ? content.slice(0, maxChars) : content,
    truncated,
  };
}

export async function listProjectFiles(root: string): Promise<OctaveFile[]> {
  await ensureDirectory(root);
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const files: OctaveFile[] = [];
  await walk(resolvedRoot, resolvedRoot, files, 0);
  files.sort(compareFiles);
  return files;
}

function assertInsideRoot(target: string, root: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path escapes the workspace directory.');
  }
}

async function walk(root: string, directory: string, files: OctaveFile[], depth: number): Promise<void> {
  if (depth > 8) return;

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) continue;

    try {
      const stat = await fs.stat(absolute);
      files.push({
        path: path.relative(root, absolute).replace(/\\/g, '/'),
        name: entry.name,
        extension,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // A file can disappear between readdir and stat. Skip it and continue.
    }
  }
}

function compareFiles(a: OctaveFile, b: OctaveFile): number {
  const priority = (file: OctaveFile): number => {
    if (file.extension === '.tex') return 0;
    if (file.extension === '.bib') return 1;
    if (file.extension === '.sty' || file.extension === '.cls') return 2;
    if (file.extension === '.md') return 3;
    return 4;
  };

  const byExtension = priority(a) - priority(b);
  if (byExtension !== 0) return byExtension;

  const byDepth = a.path.split('/').length - b.path.split('/').length;
  if (byDepth !== 0) return byDepth;

  return a.path.localeCompare(b.path);
}
