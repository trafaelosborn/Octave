import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CITATION_CORPUS_VERSION,
  type CitationCorpusIndex,
  type CitationSourceRecord,
} from '../core/citation-corpus.js';
import type { CitationEvidenceAudit } from '../core/citation-evidence.js';

const CITATIONS_DIRECTORY = 'citations';

export async function ensureCitationDirectory(workspaceRoot: string): Promise<string> {
  const directory = path.join(path.resolve(workspaceRoot), CITATIONS_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function loadCitationIndex(workspaceRoot: string): Promise<CitationCorpusIndex | null> {
  try {
    const raw = await fs.readFile(path.join(path.resolve(workspaceRoot), CITATIONS_DIRECTORY, 'index.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isCitationCorpusIndex(parsed) ? parsed : null;
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveCitationIndex(workspaceRoot: string, index: CitationCorpusIndex): Promise<void> {
  if (!isCitationCorpusIndex(index)) throw new Error('Cannot save an invalid citation corpus index.');
  const directory = await ensureCitationDirectory(workspaceRoot);
  await writeJsonAtomic(path.join(directory, 'index.json'), index);

  for (const record of index.records) {
    const recordDirectory = path.join(path.resolve(workspaceRoot), ...record.directory.split('/'));
    assertInsideWorkspace(recordDirectory, workspaceRoot);
    await fs.mkdir(recordDirectory, { recursive: true });
    await writeJsonAtomic(path.join(recordDirectory, 'metadata.json'), record);
  }
}

export async function saveCitationRecord(workspaceRoot: string, record: CitationSourceRecord): Promise<void> {
  const directory = path.join(path.resolve(workspaceRoot), ...record.directory.split('/'));
  assertInsideWorkspace(directory, workspaceRoot);
  await fs.mkdir(directory, { recursive: true });
  await writeJsonAtomic(path.join(directory, 'metadata.json'), record);
}

export async function loadCitationAudit(workspaceRoot: string): Promise<CitationEvidenceAudit | null> {
  try {
    const raw = await fs.readFile(path.join(path.resolve(workspaceRoot), CITATIONS_DIRECTORY, 'audit.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CitationEvidenceAudit>;
    return parsed.version === 1 && Array.isArray(parsed.packets) && parsed.summary && typeof parsed.summary === 'object'
      ? parsed as CitationEvidenceAudit
      : null;
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveCitationAudit(workspaceRoot: string, audit: CitationEvidenceAudit): Promise<void> {
  await writeJsonAtomic(path.join(await ensureCitationDirectory(workspaceRoot), 'audit.json'), audit);
}

export function resolveCitationArtifactPath(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('citations/')) throw new Error('Citation artifacts must stay inside the citations directory.');
  const absolute = path.resolve(workspaceRoot, normalized);
  assertInsideWorkspace(absolute, workspaceRoot);
  return absolute;
}

function isCitationCorpusIndex(value: unknown): value is CitationCorpusIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<CitationCorpusIndex>;
  return index.version === CITATION_CORPUS_VERSION && typeof index.generatedAt === 'string' && Array.isArray(index.records);
}

async function writeJsonAtomic(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

function assertInsideWorkspace(target: string, workspaceRoot: string): void {
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Citation artifact path escapes the workspace directory.');
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
