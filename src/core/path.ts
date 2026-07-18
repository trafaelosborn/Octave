import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractDocument,
  IMAGE_DOCUMENT_EXTENSIONS,
  OFFICE_DOCUMENT_EXTENSIONS,
  TEXT_DOCUMENT_EXTENSIONS,
  type ExtractedDocumentKind,
} from './extract.js';

export const ALLOWED_DOCUMENT_EXTENSIONS = TEXT_DOCUMENT_EXTENSIONS;
export const SUPPORTED_RESEARCH_EXTENSIONS = new Set([
  ...TEXT_DOCUMENT_EXTENSIONS,
  ...OFFICE_DOCUMENT_EXTENSIONS,
  ...IMAGE_DOCUMENT_EXTENSIONS,
  '.pdf',
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
  editable: boolean;
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
  extension: string;
  kind: ExtractedDocumentKind;
  warnings: string[];
  sourceBytes: number;
  editable: boolean;
}

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export function resolveSafePath(input: string, root: string): ResolvedPath {
  return resolveSafePathForExtensions(input, root, ALLOWED_DOCUMENT_EXTENSIONS);
}

export function resolveSafeResearchPath(input: string, root: string): ResolvedPath {
  return resolveSafePathForExtensions(input, root, SUPPORTED_RESEARCH_EXTENSIONS);
}

function resolveSafePathForExtensions(input: string, root: string, extensions: Set<string>): ResolvedPath {
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

  if (!extensions.has(extension)) {
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

export async function resolveExistingResearchPath(input: string, root: string): Promise<ResolvedPath> {
  const candidate = resolveSafeResearchPath(input, root);
  const realRoot = await fs.realpath(path.resolve(root));
  const realTarget = await fs.realpath(candidate.absolute);
  assertInsideRoot(realTarget, realRoot);
  return { ...candidate, absolute: realTarget };
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

export async function resolvePdfArtifactPath(documentPath: string, root: string): Promise<{
  source: ResolvedPath;
  absolute: string;
  relative: string;
}> {
  const source = await resolveExistingDocumentPath(documentPath, root);
  if (source.extension !== '.tex') {
    throw new Error('PDF preview is only available for .tex files.');
  }

  const candidate = source.absolute.replace(/\.tex$/i, '.pdf');
  const realRoot = await fs.realpath(path.resolve(root));
  let absolute = candidate;

  try {
    absolute = await fs.realpath(candidate);
    assertInsideRoot(absolute, realRoot);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    const realParent = await fs.realpath(path.dirname(candidate));
    assertInsideRoot(realParent, realRoot);
  }

  return {
    source,
    absolute,
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

  const resolved = await resolveExistingResearchPath(documentPath, root);
  const extracted = await extractDocument(resolved.absolute, { maxChars });

  return {
    path: resolved.relative,
    content: extracted.content,
    truncated: extracted.truncated,
    extension: resolved.extension,
    kind: extracted.kind,
    warnings: extracted.warnings,
    sourceBytes: extracted.sourceBytes,
    editable: ALLOWED_DOCUMENT_EXTENSIONS.has(resolved.extension),
  };
}

export async function writeDocument(
  documentPath: string,
  root: string,
  content: string,
): Promise<ResolvedPath> {
  const candidate = resolveSafePath(documentPath, root);
  const realRoot = await fs.realpath(path.resolve(root));

  try {
    const realTarget = await fs.realpath(candidate.absolute);
    assertInsideRoot(realTarget, realRoot);
    await fs.writeFile(realTarget, content, 'utf8');
    return { ...candidate, absolute: realTarget };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  const realParent = await fs.realpath(path.dirname(candidate.absolute));
  assertInsideRoot(realParent, realRoot);
  await fs.writeFile(candidate.absolute, content, { encoding: 'utf8', flag: 'wx' });
  return candidate;
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
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
    if (!SUPPORTED_RESEARCH_EXTENSIONS.has(extension)) continue;

    try {
      const stat = await fs.stat(absolute);
      files.push({
        path: path.relative(root, absolute).replace(/\\/g, '/'),
        name: entry.name,
        extension,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        editable: ALLOWED_DOCUMENT_EXTENSIONS.has(extension),
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
