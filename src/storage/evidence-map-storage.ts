import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EVIDENCE_MAPS_DIRECTORY,
  isEvidenceMap,
  serializeEvidenceMapMarkdown,
  toEvidenceMapMeta,
  type EvidenceMap,
  type EvidenceMapMeta,
} from '../core/evidence-map.js';

const EVIDENCE_MAP_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export async function ensureEvidenceMapDirectory(workspaceRoot: string): Promise<string> {
  const directory = path.join(path.resolve(workspaceRoot), ...EVIDENCE_MAPS_DIRECTORY.split('/'));
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function saveEvidenceMap(workspaceRoot: string, map: EvidenceMap): Promise<void> {
  if (!isEvidenceMap(map)) throw new Error('Cannot save an invalid evidence map.');
  const directory = await ensureEvidenceMapDirectory(workspaceRoot);
  await Promise.all([
    writeTextAtomic(path.join(directory, `${map.id}.json`), `${JSON.stringify(map, null, 2)}\n`),
    writeTextAtomic(path.join(directory, `${map.id}.md`), serializeEvidenceMapMarkdown(map)),
  ]);
}

export async function listEvidenceMaps(workspaceRoot: string): Promise<EvidenceMapMeta[]> {
  const directory = await ensureEvidenceMapDirectory(workspaceRoot);
  const files = await fs.readdir(directory).catch(() => []);
  const maps: EvidenceMapMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const mapId = file.slice(0, -'.json'.length);
    if (!EVIDENCE_MAP_ID_PATTERN.test(mapId)) continue;
    try {
      const map = await readEvidenceMap(path.join(directory, file));
      if (map.id === mapId) maps.push(toEvidenceMapMeta(map));
    } catch {
      // Malformed maps should not hide neighboring evidence artifacts.
    }
  }

  return maps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadEvidenceMap(workspaceRoot: string, mapId: string): Promise<EvidenceMap | null> {
  assertValidEvidenceMapId(mapId);
  try {
    return await readEvidenceMap(path.join(await ensureEvidenceMapDirectory(workspaceRoot), `${mapId}.json`));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export function assertValidEvidenceMapId(mapId: string): void {
  if (!EVIDENCE_MAP_ID_PATTERN.test(mapId)) throw new Error('Invalid evidence map ID.');
}

async function readEvidenceMap(filePath: string): Promise<EvidenceMap> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  if (!isEvidenceMap(parsed)) throw new Error(`Invalid evidence map: ${path.basename(filePath)}`);
  return parsed;
}

async function writeTextAtomic(destination: string, value: string): Promise<void> {
  assertInsideWorkspace(destination, path.dirname(path.dirname(path.dirname(destination))));
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, destination);
}

function assertInsideWorkspace(target: string, workspaceRoot: string): void {
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Evidence map path escapes the workspace directory.');
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
