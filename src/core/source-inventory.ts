import fs from 'node:fs/promises';
import path from 'node:path';
import { listProjectFiles, type OctaveFile } from './path.js';

export const SOURCE_INVENTORY_VERSION = 1;
export const SOURCE_INVENTORY_PATH = '.octave/source-inventory.json';

export type SourceRole = 'primary' | 'secondary' | 'dataset_archive' | 'unknown';
export type SourceRoleSource = 'inferred' | 'manual';

export interface SourceInventoryItem {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  role: SourceRole;
  roleSource: SourceRoleSource;
  tags: string[];
  rationale: string;
}

export interface SourceInventory {
  version: typeof SOURCE_INVENTORY_VERSION;
  generatedAt: string;
  inventoryPath: typeof SOURCE_INVENTORY_PATH;
  sourceRoots: string[];
  sourceRootsPresent: boolean;
  items: SourceInventoryItem[];
  summary: Record<SourceRole, number> & { total: number; manual: number };
}

export interface SourceInventoryOverrides {
  items?: Array<{
    path: string;
    role?: SourceRole;
    tags?: string[];
  }>;
}

const SOURCE_ROOTS = new Set(['sources', 'source', 'primary', 'secondary', 'archive', 'archives', 'data', 'datasets']);
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.json', '.jsonl', '.xml']);
const PRIMARY_TERMS = [
  'arrian',
  'diodorus',
  'curtius',
  'plutarch',
  'herodotus',
  'thucydides',
  'xenophon',
  'polybius',
  'livy',
  'tacitus',
  'strabo',
  'pausanias',
  'primary',
  'translation',
  'inscription',
  'papyrus',
  'chronicle',
  'sourcebook',
];
const SECONDARY_TERMS = ['secondary', 'article', 'chapter', 'monograph', 'review', 'scholarship', 'jstor', 'cambridge', 'oxford', 'routledge'];
const ARCHIVE_TERMS = ['archive', 'archives', 'dataset', 'data', 'catalog', 'catalogue', 'excavation', 'fieldnote', 'table', 'spreadsheet'];

export async function buildSourceInventory(
  workspaceRoot: string,
  overrides: SourceInventoryOverrides | null = null,
): Promise<SourceInventory> {
  const files = await listProjectFiles(workspaceRoot);
  const sourceFiles = files.filter(isSourceFile);
  const overrideByPath = new Map(
    (overrides?.items ?? [])
      .filter((item) => typeof item.path === 'string' && item.path.trim())
      .map((item) => [normalizeRelativePath(item.path), item]),
  );

  const items = sourceFiles.map((file) => {
    const normalizedPath = normalizeRelativePath(file.path);
    const override = overrideByPath.get(normalizedPath);
    const inference = inferSourceRole(file);
    const role = override?.role ?? inference.role;
    return {
      path: normalizedPath,
      name: file.name,
      extension: file.extension,
      size: file.size,
      mtimeMs: file.mtimeMs,
      role,
      roleSource: override?.role ? 'manual' as const : 'inferred' as const,
      tags: normalizeTags(override?.tags ?? defaultTags(file, role)),
      rationale: override?.role ? 'Manually set by the researcher.' : inference.rationale,
    };
  });

  items.sort(compareSourceItems);
  const presentRoots = await existingSourceRoots(workspaceRoot);
  return {
    version: SOURCE_INVENTORY_VERSION,
    generatedAt: new Date().toISOString(),
    inventoryPath: SOURCE_INVENTORY_PATH,
    sourceRoots: presentRoots.length > 0 ? presentRoots : [...SOURCE_ROOTS].sort(),
    sourceRootsPresent: presentRoots.length > 0,
    items,
    summary: summarizeSources(items),
  };
}

export function updateSourceInventoryRole(
  inventory: SourceInventory,
  sourcePath: string,
  role: SourceRole,
): SourceInventory {
  const normalizedPath = normalizeRelativePath(sourcePath);
  const next: SourceInventory = {
    ...inventory,
    generatedAt: new Date().toISOString(),
    items: inventory.items.map((item) => item.path === normalizedPath ? {
      ...item,
      role,
      roleSource: 'manual',
      tags: normalizeTags([...item.tags, roleTag(role)]),
      rationale: 'Manually set by the researcher.',
    } : item),
  };
  if (!next.items.some((item) => item.path === normalizedPath)) {
    throw new Error(`Source file is not in the inventory: ${normalizedPath}`);
  }
  next.summary = summarizeSources(next.items);
  return next;
}

export function isSourceInventory(value: unknown): value is SourceInventory {
  if (!value || typeof value !== 'object') return false;
  const inventory = value as Partial<SourceInventory>;
  return (
    inventory.version === SOURCE_INVENTORY_VERSION &&
    typeof inventory.generatedAt === 'string' &&
    inventory.inventoryPath === SOURCE_INVENTORY_PATH &&
    Array.isArray(inventory.items) &&
    inventory.items.every(isSourceInventoryItem)
  );
}

export function isSourceRole(value: unknown): value is SourceRole {
  return value === 'primary' || value === 'secondary' || value === 'dataset_archive' || value === 'unknown';
}

function isSourceFile(file: OctaveFile): boolean {
  const firstSegment = file.path.split('/')[0]?.toLowerCase();
  return Boolean(firstSegment && SOURCE_ROOTS.has(firstSegment));
}

function inferSourceRole(file: OctaveFile): { role: SourceRole; rationale: string } {
  const haystack = file.path.toLowerCase();
  if (DATA_EXTENSIONS.has(file.extension) || includesAny(haystack, ARCHIVE_TERMS)) {
    return { role: 'dataset_archive', rationale: 'Inferred from data/archive folder, filename, or file type.' };
  }
  if (includesAny(haystack, PRIMARY_TERMS)) {
    return { role: 'primary', rationale: 'Inferred from primary-source folder or filename signals.' };
  }
  if (includesAny(haystack, SECONDARY_TERMS)) {
    return { role: 'secondary', rationale: 'Inferred from secondary-scholarship folder or filename signals.' };
  }
  const root = file.path.split('/')[0]?.toLowerCase();
  if (root === 'primary') return { role: 'primary', rationale: 'Inferred from the primary source folder.' };
  if (root === 'secondary') return { role: 'secondary', rationale: 'Inferred from the secondary source folder.' };
  if (root === 'archive' || root === 'archives' || root === 'data' || root === 'datasets') {
    return { role: 'dataset_archive', rationale: 'Inferred from the archive/data source folder.' };
  }
  return { role: 'unknown', rationale: 'No reliable source-type signal was found.' };
}

async function existingSourceRoots(workspaceRoot: string): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const present: string[] = [];
  for (const sourceRoot of [...SOURCE_ROOTS].sort()) {
    try {
      const stat = await fs.stat(path.join(root, sourceRoot));
      if (stat.isDirectory()) present.push(sourceRoot);
    } catch {
      // Missing roots are fine.
    }
  }
  return present;
}

function summarizeSources(items: SourceInventoryItem[]): SourceInventory['summary'] {
  return {
    total: items.length,
    primary: items.filter((item) => item.role === 'primary').length,
    secondary: items.filter((item) => item.role === 'secondary').length,
    dataset_archive: items.filter((item) => item.role === 'dataset_archive').length,
    unknown: items.filter((item) => item.role === 'unknown').length,
    manual: items.filter((item) => item.roleSource === 'manual').length,
  };
}

function defaultTags(file: OctaveFile, role: SourceRole): string[] {
  return normalizeTags([roleTag(role), file.extension.replace(/^\./, '')]);
}

function roleTag(role: SourceRole): string {
  return role === 'dataset_archive' ? 'archive-data' : role;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag)))]
    .sort();
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function compareSourceItems(a: SourceInventoryItem, b: SourceInventoryItem): number {
  const roleOrder: Record<SourceRole, number> = {
    primary: 0,
    secondary: 1,
    dataset_archive: 2,
    unknown: 3,
  };
  const byRole = roleOrder[a.role] - roleOrder[b.role];
  if (byRole !== 0) return byRole;
  return a.path.localeCompare(b.path);
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function isSourceInventoryItem(value: unknown): value is SourceInventoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SourceInventoryItem>;
  return (
    typeof item.path === 'string' &&
    typeof item.name === 'string' &&
    typeof item.extension === 'string' &&
    typeof item.size === 'number' &&
    typeof item.mtimeMs === 'number' &&
    isSourceRole(item.role) &&
    (item.roleSource === 'inferred' || item.roleSource === 'manual') &&
    Array.isArray(item.tags) &&
    typeof item.rationale === 'string'
  );
}
