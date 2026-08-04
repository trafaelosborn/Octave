import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readDocument } from './path.js';
import type { SourceInventory, SourceInventoryItem, SourceRole } from './source-inventory.js';

export const EVIDENCE_MAP_VERSION = 1;
export const EVIDENCE_MAPS_DIRECTORY = '.octave/evidence-maps';
export const MAX_EVIDENCE_MAP_TITLE_CHARS = 120;
export const DEFAULT_EVIDENCE_MAP_SOURCE_LIMIT = 8;
export const DEFAULT_EVIDENCE_MAP_SOURCE_CHARS = 6_000;
export const DEFAULT_EVIDENCE_MAP_PASSAGES_PER_SOURCE = 3;

export interface EvidenceMapSourceSnapshot {
  path: string;
  role: SourceRole;
  roleSource: 'inferred' | 'manual';
  tags: string[];
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
}

export interface EvidencePassage {
  id: string;
  sourcePath: string;
  role: SourceRole;
  locator: string;
  text: string;
  warnings: string[];
}

export interface EvidenceMap {
  version: typeof EVIDENCE_MAP_VERSION;
  id: string;
  title: string;
  question: string;
  createdAt: string;
  updatedAt: string;
  artifactPaths: {
    json: string;
    markdown: string;
  };
  inventory: {
    generatedAt: string;
    path: string;
    sourceCount: number;
    summary: SourceInventory['summary'];
  };
  sources: EvidenceMapSourceSnapshot[];
  passages: EvidencePassage[];
  directSupport: Array<{ claim: string; passageIds: string[]; note: string }>;
  inferenceNotes: Array<{ inference: string; passageIds: string[]; caveat: string }>;
  missingSources: Array<{ source: string; reason: string }>;
  warnings: string[];
}

export type EvidenceMapMeta = Omit<EvidenceMap, 'passages' | 'directSupport' | 'inferenceNotes' | 'missingSources'> & {
  passageCount: number;
};

export interface BuildEvidenceMapInput {
  question?: string;
  title?: string;
  sourceLimit?: number;
  maxCharsPerSource?: number;
  passagesPerSource?: number;
}

export async function buildEvidenceMap(
  workspaceRoot: string,
  inventory: SourceInventory,
  input: BuildEvidenceMapInput = {},
): Promise<EvidenceMap> {
  const id = randomUUID();
  const title = normalizeEvidenceMapTitle(input.title ?? input.question ?? '', 'Source evidence map');
  const question = (input.question ?? '').trim() || 'Untitled source-grounded research question';
  const sourceLimit = positiveInteger(input.sourceLimit, DEFAULT_EVIDENCE_MAP_SOURCE_LIMIT, 'sourceLimit');
  const maxCharsPerSource = positiveInteger(input.maxCharsPerSource, DEFAULT_EVIDENCE_MAP_SOURCE_CHARS, 'maxCharsPerSource');
  const passagesPerSource = positiveInteger(input.passagesPerSource, DEFAULT_EVIDENCE_MAP_PASSAGES_PER_SOURCE, 'passagesPerSource');
  const selectedSources = inventory.items.slice(0, sourceLimit);
  const warnings: string[] = [];
  if (inventory.items.length > selectedSources.length) {
    warnings.push(`${inventory.items.length - selectedSources.length} source files were omitted because this map is limited to ${sourceLimit} sources.`);
  }

  const passages: EvidencePassage[] = [];
  for (const source of selectedSources) {
    try {
      const document = await readDocument(source.path, workspaceRoot, maxCharsPerSource);
      const chunks = extractPassages(document.content, passagesPerSource);
      if (document.truncated) warnings.push(`${source.path}: extracted text was truncated for this evidence map.`);
      for (const warning of document.warnings) warnings.push(`${source.path}: ${warning}`);
      chunks.forEach((text, index) => {
        passages.push({
          id: `${slugPath(source.path)}:${index + 1}`,
          sourcePath: source.path,
          role: source.role,
          locator: `excerpt ${index + 1}`,
          text,
          warnings: document.warnings,
        });
      });
    } catch (error) {
      warnings.push(`${source.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const artifactBase = path.posix.join(EVIDENCE_MAPS_DIRECTORY, id);
  const now = new Date().toISOString();
  return {
    version: EVIDENCE_MAP_VERSION,
    id,
    title,
    question,
    createdAt: now,
    updatedAt: now,
    artifactPaths: {
      json: `${artifactBase}.json`,
      markdown: `${artifactBase}.md`,
    },
    inventory: {
      generatedAt: inventory.generatedAt,
      path: inventory.inventoryPath,
      sourceCount: inventory.items.length,
      summary: inventory.summary,
    },
    sources: selectedSources.map(toSourceSnapshot),
    passages,
    directSupport: [],
    inferenceNotes: [],
    missingSources: [{
      source: 'Researcher review required',
      reason: 'This first-pass map extracts candidate evidence passages. Fill this list after reviewing what the passages do not establish.',
    }],
    warnings,
  };
}

export function serializeEvidenceMapMarkdown(map: EvidenceMap): string {
  const lines = [
    `# ${map.title}`,
    '',
    `Question: ${map.question}`,
    '',
    `Generated: ${map.createdAt}`,
    `JSON: \`${map.artifactPaths.json}\``,
    '',
    '## Inventory snapshot',
    '',
    `- Inventory: \`${map.inventory.path}\``,
    `- Sources in inventory: ${map.inventory.sourceCount}`,
    `- Primary: ${map.inventory.summary.primary}`,
    `- Secondary: ${map.inventory.summary.secondary}`,
    `- Archive/data: ${map.inventory.summary.dataset_archive}`,
    `- Unknown: ${map.inventory.summary.unknown}`,
    '',
    '## Source files in this map',
    '',
    ...map.sources.map((source) => `- \`${source.path}\` — ${source.role}${source.roleSource === 'manual' ? ' (manual)' : ''}`),
    '',
    '## Candidate passages',
    '',
    ...map.passages.flatMap((passage) => [
      `### ${passage.id}`,
      '',
      `Source: \`${passage.sourcePath}\` (${passage.role}, ${passage.locator})`,
      '',
      passage.text,
      '',
    ]),
    '## Direct support',
    '',
    map.directSupport.length > 0
      ? map.directSupport.map((support) => `- ${support.claim} — passages: ${support.passageIds.join(', ') || 'none'}; ${support.note}`).join('\n')
      : '- Not reviewed yet.',
    '',
    '## Inference notes',
    '',
    map.inferenceNotes.length > 0
      ? map.inferenceNotes.map((note) => `- ${note.inference} — passages: ${note.passageIds.join(', ') || 'none'}; caveat: ${note.caveat}`).join('\n')
      : '- Not reviewed yet.',
    '',
    '## Missing sources',
    '',
    ...map.missingSources.map((missing) => `- ${missing.source}: ${missing.reason}`),
    '',
  ];
  if (map.warnings.length > 0) {
    lines.push('## Warnings', '', ...map.warnings.map((warning) => `- ${warning}`), '');
  }
  return `${lines.join('\n')}\n`;
}

export function toEvidenceMapMeta(map: EvidenceMap): EvidenceMapMeta {
  const { passages, directSupport, inferenceNotes, missingSources, ...metadata } = map;
  void directSupport;
  void inferenceNotes;
  void missingSources;
  return {
    ...metadata,
    passageCount: passages.length,
  };
}

export function normalizeEvidenceMapTitle(title: string, fallback = 'Evidence map'): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  const selected = normalized || fallback.trim().replace(/\s+/g, ' ') || 'Evidence map';
  return selected.length > MAX_EVIDENCE_MAP_TITLE_CHARS
    ? `${selected.slice(0, MAX_EVIDENCE_MAP_TITLE_CHARS - 3)}...`
    : selected;
}

export function isEvidenceMap(value: unknown): value is EvidenceMap {
  if (!value || typeof value !== 'object') return false;
  const map = value as Partial<EvidenceMap>;
  return (
    map.version === EVIDENCE_MAP_VERSION &&
    typeof map.id === 'string' && Boolean(map.id) &&
    typeof map.title === 'string' && Boolean(map.title.trim()) &&
    typeof map.question === 'string' && Boolean(map.question.trim()) &&
    typeof map.createdAt === 'string' &&
    typeof map.updatedAt === 'string' &&
    Boolean(map.artifactPaths) &&
    typeof map.artifactPaths?.json === 'string' &&
    typeof map.artifactPaths?.markdown === 'string' &&
    Boolean(map.inventory) &&
    typeof map.inventory?.path === 'string' &&
    typeof map.inventory?.sourceCount === 'number' &&
    Array.isArray(map.sources) &&
    Array.isArray(map.passages) &&
    Array.isArray(map.directSupport) &&
    Array.isArray(map.inferenceNotes) &&
    Array.isArray(map.missingSources) &&
    Array.isArray(map.warnings)
  );
}

function toSourceSnapshot(source: SourceInventoryItem): EvidenceMapSourceSnapshot {
  return {
    path: source.path,
    role: source.role,
    roleSource: source.roleSource,
    tags: source.tags,
    name: source.name,
    extension: source.extension,
    size: source.size,
    mtimeMs: source.mtimeMs,
  };
}

function extractPassages(content: string, limit: number): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return ['[No extractable text was available from this source.]'];
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim().replace(/\s+/g, ' '))
    .filter((paragraph) => paragraph.length >= 40);
  const candidates = paragraphs.length > 0
    ? paragraphs
    : normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return candidates.slice(0, limit).map((passage) => (
    passage.length > 1_200 ? `${passage.slice(0, 1_197)}...` : passage
  ));
}

function slugPath(sourcePath: string): string {
  return sourcePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'source';
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
