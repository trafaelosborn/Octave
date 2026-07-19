import { createHash } from 'node:crypto';
import { parseBibTeX, type BibTeXEntry } from './bibtex.js';
import { listProjectFiles, readDocument } from './path.js';

export const CITATION_CORPUS_VERSION = 1;

export type CitationSourceStatus =
  | 'not_requested'
  | 'unresolved'
  | 'downloaded'
  | 'metadata_only'
  | 'manual_required'
  | 'blocked_by_license'
  | 'ambiguous'
  | 'failed';

export interface CitationIdentifiers {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  pmcid?: string;
}

export interface CitationBibliographyMetadata {
  title?: string;
  authors?: string[];
  year?: string;
  venue?: string;
  url?: string;
}

export interface CitationAcquisition {
  source: 'pmc' | 'arxiv' | 'unpaywall' | 'manual';
  acquiredAt: string;
  originalPath: string;
  extractedPath: string;
  chunksPath: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  sourceUrl?: string;
  landingPageUrl?: string;
  license?: string;
  version?: string;
}

export interface CitationAttempt {
  attemptedAt: string;
  resolver: string;
  outcome: CitationSourceStatus;
  message: string;
  url?: string;
}

export interface CitationSourceRecord {
  key: string;
  directory: string;
  cited: boolean;
  status: CitationSourceStatus;
  fingerprint: string;
  entryType: string;
  bibPaths: string[];
  identifiers: CitationIdentifiers;
  metadata: CitationBibliographyMetadata;
  reason?: string;
  acquisition?: CitationAcquisition;
  attempts?: CitationAttempt[];
}

export interface CitationCorpusIndex {
  version: number;
  generatedAt: string;
  records: CitationSourceRecord[];
}

export interface CitationOccurrence {
  key: string;
  path: string;
  line: number;
  context: string;
}

export interface CitationWorkspaceInventory {
  occurrences: CitationOccurrence[];
  entries: Array<BibTeXEntry & { sourcePath: string }>;
}

export async function inspectCitationWorkspace(workspaceRoot: string): Promise<CitationWorkspaceInventory> {
  const files = await listProjectFiles(workspaceRoot);
  const occurrences: CitationOccurrence[] = [];
  const entries: Array<BibTeXEntry & { sourcePath: string }> = [];

  for (const file of files) {
    if (file.extension !== '.tex' && file.extension !== '.bib') continue;
    const document = await readDocument(file.path, workspaceRoot, 1_000_000);
    if (file.extension === '.bib') {
      entries.push(...parseBibTeX(document.content).map((entry) => ({ ...entry, sourcePath: file.path })));
      continue;
    }

    const lines = document.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g)) {
        for (const rawKey of (match[1] ?? '').split(',')) {
          const key = rawKey.trim();
          if (key) occurrences.push({ key, path: file.path, line: index + 1, context: line.trim() });
        }
      }
    });
  }

  return { occurrences, entries };
}

export function buildCitationCorpusIndex(
  inventory: CitationWorkspaceInventory,
  existing?: CitationCorpusIndex | null,
): CitationCorpusIndex {
  const citedKeys = new Set(inventory.occurrences.map((occurrence) => occurrence.key));
  const entriesByKey = new Map<string, Array<BibTeXEntry & { sourcePath: string }>>();
  for (const entry of inventory.entries) {
    const matches = entriesByKey.get(entry.key) ?? [];
    matches.push(entry);
    entriesByKey.set(entry.key, matches);
  }

  const allKeys = new Set([...entriesByKey.keys(), ...citedKeys]);
  const existingByKey = new Map(existing?.records.map((record) => [record.key, record]) ?? []);
  const records = [...allKeys].sort().map((key) => {
    const matches = entriesByKey.get(key) ?? [];
    const cited = citedKeys.has(key);
    const directory = `citations/${citationDirectoryName(key)}`;

    if (matches.length === 0) {
      return {
        key,
        directory,
        cited,
        status: 'manual_required' as const,
        fingerprint: fingerprint({ key, missing: true }),
        entryType: 'missing',
        bibPaths: [],
        identifiers: {},
        metadata: {},
        reason: 'Citation key has no matching bibliography entry.',
      };
    }

    if (matches.length > 1) {
      return {
        key,
        directory,
        cited,
        status: 'ambiguous' as const,
        fingerprint: fingerprint(matches.map((entry) => ({ type: entry.type, fields: entry.fields, path: entry.sourcePath }))),
        entryType: matches[0]?.type ?? 'unknown',
        bibPaths: [...new Set(matches.map((entry) => entry.sourcePath))],
        identifiers: extractIdentifiers(matches[0]?.fields ?? {}),
        metadata: extractMetadata(matches[0]?.fields ?? {}),
        reason: 'The bibliography key is defined more than once.',
      };
    }

    const entry = matches[0] as BibTeXEntry & { sourcePath: string };
    const recordFingerprint = fingerprint({ type: entry.type, fields: entry.fields, path: entry.sourcePath });
    const previous = existingByKey.get(key);
    const base: CitationSourceRecord = {
      key,
      directory,
      cited,
      status: cited ? 'unresolved' : 'not_requested',
      fingerprint: recordFingerprint,
      entryType: entry.type,
      bibPaths: [entry.sourcePath],
      identifiers: extractIdentifiers(entry.fields),
      metadata: extractMetadata(entry.fields),
    };

    if (previous?.fingerprint === recordFingerprint) {
      base.status = previous.status === 'not_requested' && cited ? 'unresolved' : previous.status;
      if (previous.reason !== undefined) base.reason = previous.reason;
      if (previous.acquisition !== undefined) base.acquisition = previous.acquisition;
      if (previous.attempts !== undefined) base.attempts = previous.attempts;
    }
    return base;
  });

  return { version: CITATION_CORPUS_VERSION, generatedAt: new Date().toISOString(), records };
}

export function summarizeCitationSources(records: CitationSourceRecord[]): Record<CitationSourceStatus, number> {
  const summary: Record<CitationSourceStatus, number> = {
    not_requested: 0,
    unresolved: 0,
    downloaded: 0,
    metadata_only: 0,
    manual_required: 0,
    blocked_by_license: 0,
    ambiguous: 0,
    failed: 0,
  };
  for (const record of records) summary[record.status] += 1;
  return summary;
}

export function citationDirectoryName(key: string): string {
  const slug = key.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 64) || 'citation';
  return `${slug}-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

function extractIdentifiers(fields: Record<string, string>): CitationIdentifiers {
  const identifiers: CitationIdentifiers = {};
  const doi = normalizeDoi(fields.doi ?? doiFromUrl(fields.url));
  if (doi) identifiers.doi = doi;
  const arxivId = normalizeArxivId(
    fields.archiveprefix?.toLowerCase() === 'arxiv' ? fields.eprint : arxivFromUrl(fields.url),
  );
  if (arxivId) identifiers.arxivId = arxivId;
  const pmid = fields.pmid?.trim();
  if (pmid) identifiers.pmid = pmid;
  const pmcid = fields.pmcid?.trim().toUpperCase();
  if (pmcid) identifiers.pmcid = pmcid.startsWith('PMC') ? pmcid : `PMC${pmcid}`;
  return identifiers;
}

function extractMetadata(fields: Record<string, string>): CitationBibliographyMetadata {
  const metadata: CitationBibliographyMetadata = {};
  const title = cleanBibText(fields.title);
  if (title) metadata.title = title;
  const authors = fields.author?.split(/\s+and\s+/i).map(cleanBibText).filter((author): author is string => Boolean(author));
  if (authors?.length) metadata.authors = authors;
  const year = cleanBibText(fields.year);
  if (year) metadata.year = year;
  const venue = cleanBibText(fields.journal ?? fields.booktitle ?? fields.publisher);
  if (venue) metadata.venue = venue;
  const url = fields.url?.trim();
  if (url && /^https:\/\//i.test(url)) metadata.url = url;
  return metadata;
}

function normalizeDoi(value?: string): string | undefined {
  const normalized = value?.trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[\s}>.,;]+$/g, '')
    .toLowerCase();
  return normalized && /^10\.\d{4,9}\/.+/.test(normalized) ? normalized : undefined;
}

function doiFromUrl(value?: string): string | undefined {
  return value?.match(/https?:\/\/(?:dx\.)?doi\.org\/([^\s?#]+)/i)?.[1];
}

function normalizeArxivId(value?: string): string | undefined {
  const normalized = value?.trim().replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '');
  return normalized && /^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i.test(normalized)
    ? normalized
    : undefined;
}

function arxivFromUrl(value?: string): string | undefined {
  return value?.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i)?.[1];
}

function cleanBibText(value?: string): string | undefined {
  const cleaned = value?.replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
