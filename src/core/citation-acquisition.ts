import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { extractDocument } from './extract.js';
import {
  buildCitationCorpusIndex,
  inspectCitationWorkspace,
  type CitationAcquisition,
  type CitationAttempt,
  type CitationCorpusIndex,
  type CitationSourceRecord,
  type CitationSourceStatus,
} from './citation-corpus.js';
import {
  loadCitationIndex,
  resolveCitationArtifactPath,
  saveCitationIndex,
  saveCitationRecord,
} from '../storage/citation-storage.js';

export const MAX_CITATION_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_CITATION_EXTRACTED_CHARS = 500_000;
const MAX_METADATA_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS_PER_RECORD = 20;

export interface CitationSyncOptions {
  email?: string;
  fetch?: typeof globalThis.fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  now?: () => Date;
  maxDownloadBytes?: number;
  force?: boolean;
  onProgress?: (record: CitationSourceRecord, completed: number, total: number) => void;
}

export interface CitationTextChunk {
  id: string;
  citationKey: string;
  locator: string;
  text: string;
}

interface AcquisitionCandidate {
  source: CitationAcquisition['source'];
  url: string;
  mediaType: 'application/pdf' | 'application/xml';
  landingPageUrl?: string;
  license?: string;
  version?: string;
}

interface RemoteContext {
  email?: string;
  fetch: typeof globalThis.fetch;
  resolveHost: (hostname: string) => Promise<string[]>;
  now: () => Date;
  maxDownloadBytes: number;
}

export async function syncCitationCorpus(
  workspaceRoot: string,
  options: CitationSyncOptions = {},
): Promise<CitationCorpusIndex> {
  const existing = await loadCitationIndex(workspaceRoot);
  const inventory = await inspectCitationWorkspace(workspaceRoot);
  const index = buildCitationCorpusIndex(inventory, existing);
  await saveCitationIndex(workspaceRoot, index);

  const context: RemoteContext = {
    fetch: options.fetch ?? globalThis.fetch,
    resolveHost: options.resolveHost ?? resolvePublicHost,
    now: options.now ?? (() => new Date()),
    maxDownloadBytes: options.maxDownloadBytes ?? MAX_CITATION_DOWNLOAD_BYTES,
  };
  const email = options.email?.trim();
  if (email) context.email = email;

  const requested = index.records.filter((record) => record.cited);
  let completed = 0;
  for (const record of requested) {
    if (record.status === 'ambiguous' || (record.entryType === 'missing' && record.status === 'manual_required')) {
      completed += 1;
      options.onProgress?.(record, completed, requested.length);
      continue;
    }
    if (!options.force && record.status === 'downloaded' && await acquisitionExists(workspaceRoot, record)) {
      completed += 1;
      options.onProgress?.(record, completed, requested.length);
      continue;
    }

    try {
      await acquireCitation(workspaceRoot, record, context);
    } catch (error) {
      record.status = 'failed';
      record.reason = error instanceof Error ? error.message : String(error);
      addAttempt(record, context, 'acquisition', 'failed', record.reason);
    }
    await saveCitationRecord(workspaceRoot, record);
    index.generatedAt = context.now().toISOString();
    await saveCitationIndex(workspaceRoot, index);
    completed += 1;
    options.onProgress?.(record, completed, requested.length);
  }

  return index;
}

export function chunkCitationText(citationKey: string, content: string, maxChars = 1_800): CitationTextChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 200) throw new Error('Citation chunk size must be at least 200 characters.');
  const chunks: CitationTextChunk[] = [];
  const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  let section = 'Document text';

  for (const block of blocks) {
    if (/^#{1,6}\s+/.test(block)) {
      section = block.replace(/^#{1,6}\s+/, '').trim() || section;
      continue;
    }
    for (const part of splitWithOverlap(block, maxChars, 180)) {
      chunks.push({
        id: `${citationKey}:${chunks.length + 1}`,
        citationKey,
        locator: section,
        text: part,
      });
    }
  }
  return chunks;
}

export function extractJatsMarkdown(xml: string): string {
  const withoutBack = xml
    .replace(/<ref-list\b[\s\S]*?<\/ref-list>/gi, '')
    .replace(/<fig\b[\s\S]*?<\/fig>/gi, '')
    .replace(/<table-wrap\b[\s\S]*?<\/table-wrap>/gi, '');
  const withStructure = withoutBack
    .replace(/<article-title\b[^>]*>([\s\S]*?)<\/article-title>/gi, '\n# $1\n')
    .replace(/<sec\b[^>]*>/gi, '\n')
    .replace(/<title\b[^>]*>([\s\S]*?)<\/title>/gi, '\n## $1\n')
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<list-item\b[^>]*>([\s\S]*?)<\/list-item>/gi, '\n- $1\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeXmlEntities(withStructure)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function acquireCitation(
  workspaceRoot: string,
  record: CitationSourceRecord,
  context: RemoteContext,
): Promise<void> {
  const manual = await findManualCandidate(workspaceRoot, record);
  if (manual) {
    await persistCandidate(workspaceRoot, record, manual, context, true);
    return;
  }

  if (record.identifiers.pmcid) {
    const candidate = europePmcCandidate(record.identifiers.pmcid);
    if (await tryCandidate(workspaceRoot, record, candidate, context)) return;
  }

  if (record.identifiers.arxivId) {
    const candidate: AcquisitionCandidate = {
      source: 'arxiv',
      url: `https://arxiv.org/pdf/${encodeURIComponent(record.identifiers.arxivId)}.pdf`,
      mediaType: 'application/pdf',
      landingPageUrl: `https://arxiv.org/abs/${encodeURIComponent(record.identifiers.arxivId)}`,
      version: 'submittedVersion',
    };
    if (await tryCandidate(workspaceRoot, record, candidate, context)) return;
  }

  if (record.identifiers.doi) {
    await resolveCrossrefMetadata(record, context);
    const pmcid = await resolvePmcid(record.identifiers.doi, context);
    if (pmcid) {
      record.identifiers.pmcid = pmcid;
      if (await tryCandidate(workspaceRoot, record, europePmcCandidate(pmcid), context)) return;
    }

    if (!context.email) {
      record.status = 'metadata_only';
      record.reason = 'Set OCTAVE_SCHOLARLY_EMAIL to enable Unpaywall open-access lookup.';
      addAttempt(record, context, 'unpaywall', 'metadata_only', record.reason);
      return;
    }

    const location = await resolveUnpaywallLocation(record, context);
    if (!location) return;
    if (await tryCandidate(workspaceRoot, record, location, context)) return;
  }

  if (record.identifiers.pmid && !record.identifiers.pmcid) {
    const pmcid = await resolvePmcid(record.identifiers.pmid, context);
    if (pmcid) {
      record.identifiers.pmcid = pmcid;
      if (await tryCandidate(workspaceRoot, record, europePmcCandidate(pmcid), context)) return;
    }
  }

  const lastFailure = [...(record.attempts ?? [])].reverse().find((attempt) => attempt.outcome === 'failed');
  record.status = 'manual_required';
  record.reason = lastFailure
    ? `Automatic acquisition was not usable: ${lastFailure.message} Place manual.pdf or manual.xml in this citation directory and sync again.`
    : 'No downloadable open full text was found. Place manual.pdf or manual.xml in this citation directory and sync again.';
  addAttempt(record, context, 'resolver', 'manual_required', record.reason, record.metadata.url);
}

async function resolveCrossrefMetadata(record: CitationSourceRecord, context: RemoteContext): Promise<void> {
  const doi = record.identifiers.doi;
  if (!doi) return;
  const url = new URL(`https://api.crossref.org/works/${encodeDoiPath(doi)}`);
  if (context.email) url.searchParams.set('mailto', context.email);
  try {
    const response = await fetchJson(url.toString(), context);
    const message = isObject(response) && isObject(response.message) ? response.message : null;
    if (message) {
      const title = firstString(message.title);
      const authors = Array.isArray(message.author)
        ? message.author.map(formatCrossrefAuthor).filter((author): author is string => Boolean(author))
        : [];
      const year = crossrefYear(message);
      const venue = firstString(message['container-title']);
      if (!record.metadata.title && title) record.metadata.title = title;
      if (!record.metadata.authors?.length && authors.length) record.metadata.authors = authors;
      if (!record.metadata.year && year) record.metadata.year = year;
      if (!record.metadata.venue && venue) record.metadata.venue = venue;
    }
    addAttempt(record, context, 'crossref', 'metadata_only', 'Resolved canonical DOI metadata.', url.toString());
  } catch (error) {
    addAttempt(record, context, 'crossref', 'failed', describeError(error), url.toString());
  }
}

async function resolvePmcid(identifier: string, context: RemoteContext): Promise<string | undefined> {
  const url = new URL('https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/');
  url.searchParams.set('ids', identifier);
  url.searchParams.set('format', 'json');
  url.searchParams.set('tool', 'octave');
  if (context.email) url.searchParams.set('email', context.email);
  try {
    const response = await fetchJson(url.toString(), context);
    if (!isObject(response) || !Array.isArray(response.records)) return undefined;
    const first = response.records.find(isObject);
    const pmcid = first && typeof first.pmcid === 'string' ? first.pmcid.toUpperCase() : undefined;
    return pmcid?.startsWith('PMC') ? pmcid : undefined;
  } catch {
    return undefined;
  }
}

async function resolveUnpaywallLocation(
  record: CitationSourceRecord,
  context: RemoteContext,
): Promise<AcquisitionCandidate | null> {
  const doi = record.identifiers.doi;
  if (!doi || !context.email) return null;
  const url = new URL(`https://api.unpaywall.org/v2/${encodeDoiPath(doi)}`);
  url.searchParams.set('email', context.email);

  try {
    const response = await fetchJson(url.toString(), context);
    if (!isObject(response)) throw new Error('Unpaywall returned an invalid response.');
    const best = isObject(response.best_oa_location) ? response.best_oa_location : null;
    if (!best) {
      record.status = response.is_oa === false ? 'blocked_by_license' : 'metadata_only';
      record.reason = response.is_oa === false
        ? 'No legitimate open-access copy is currently indexed.'
        : 'No downloadable open-access location is currently indexed.';
      addAttempt(record, context, 'unpaywall', record.status, record.reason, url.toString());
      return null;
    }
    const pdfUrl = typeof best.url_for_pdf === 'string' ? best.url_for_pdf : undefined;
    const landingPageUrl = typeof best.url_for_landing_page === 'string' ? best.url_for_landing_page : undefined;
    if (!pdfUrl) {
      record.status = 'metadata_only';
      record.reason = 'An open landing page was found, but it did not expose a direct PDF.';
      addAttempt(record, context, 'unpaywall', 'metadata_only', record.reason, landingPageUrl ?? url.toString());
      return null;
    }
    addAttempt(record, context, 'unpaywall', 'metadata_only', 'Found an open-access PDF location.', pdfUrl);
    const candidate: AcquisitionCandidate = { source: 'unpaywall', url: pdfUrl, mediaType: 'application/pdf' };
    if (landingPageUrl) candidate.landingPageUrl = landingPageUrl;
    if (typeof best.license === 'string') candidate.license = best.license;
    if (typeof best.version === 'string') candidate.version = best.version;
    return candidate;
  } catch (error) {
    record.status = 'metadata_only';
    record.reason = `Open-access lookup failed: ${describeError(error)}`;
    addAttempt(record, context, 'unpaywall', 'failed', record.reason, url.toString());
    return null;
  }
}

async function tryCandidate(
  workspaceRoot: string,
  record: CitationSourceRecord,
  candidate: AcquisitionCandidate,
  context: RemoteContext,
): Promise<boolean> {
  try {
    await persistCandidate(workspaceRoot, record, candidate, context, false);
    return true;
  } catch (error) {
    addAttempt(record, context, candidate.source, 'failed', describeError(error), candidate.url);
    return false;
  }
}

async function persistCandidate(
  workspaceRoot: string,
  record: CitationSourceRecord,
  candidate: AcquisitionCandidate,
  context: RemoteContext,
  local: boolean,
): Promise<void> {
  const bytes = local
    ? await readLocalCandidate(candidate.url, context.maxDownloadBytes)
    : await fetchBytes(candidate.url, context, context.maxDownloadBytes);
  validateSourceBytes(bytes, candidate.mediaType);

  const extension = candidate.mediaType === 'application/pdf' ? '.pdf' : '.xml';
  const originalName = candidate.source === 'manual' ? `manual${extension}` : `source${extension}`;
  const originalPath = `${record.directory}/${originalName}`;
  const extractedPath = `${record.directory}/extracted.md`;
  const chunksPath = `${record.directory}/chunks.jsonl`;
  const originalAbsolute = resolveCitationArtifactPath(workspaceRoot, originalPath);
  if (!local) await writeBufferAtomic(originalAbsolute, bytes);

  let extracted: string;
  let warnings: string[] = [];
  if (candidate.mediaType === 'application/xml') {
    extracted = extractJatsMarkdown(bytes.toString('utf8'));
    if (!extracted) throw new Error('The structured full text did not contain extractable article text.');
  } else {
    const result = await extractDocument(originalAbsolute, {
      maxChars: MAX_CITATION_EXTRACTED_CHARS,
      maxSourceBytes: context.maxDownloadBytes,
    });
    extracted = result.content;
    warnings = result.warnings;
    if (result.truncated) warnings.push('Extracted text was truncated to the citation corpus limit.');
  }
  if (!extracted.trim()) throw new Error('The acquired source contained no extractable text and may require OCR.');

  const title = record.metadata.title ?? record.key;
  const markdown = [
    `# ${title}`,
    '',
    `- Citation key: \`${record.key}\``,
    `- Original: \`${originalPath}\``,
    candidate.landingPageUrl ? `- Landing page: ${candidate.landingPageUrl}` : '',
    candidate.license ? `- License: ${candidate.license}` : '',
    '',
    '---',
    '',
    extracted,
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n');
  const chunks = chunkCitationText(record.key, extracted);
  await writeTextAtomic(resolveCitationArtifactPath(workspaceRoot, extractedPath), `${markdown.trim()}\n`);
  await writeTextAtomic(
    resolveCitationArtifactPath(workspaceRoot, chunksPath),
    chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (chunks.length ? '\n' : ''),
  );

  const acquisition: CitationAcquisition = {
    source: candidate.source,
    acquiredAt: context.now().toISOString(),
    originalPath,
    extractedPath,
    chunksPath,
    mediaType: candidate.mediaType,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (candidate.url && !local) acquisition.sourceUrl = candidate.url;
  if (candidate.landingPageUrl) acquisition.landingPageUrl = candidate.landingPageUrl;
  if (candidate.license) acquisition.license = candidate.license;
  if (candidate.version) acquisition.version = candidate.version;
  if (warnings.length) acquisition.extractionWarnings = warnings;
  record.acquisition = acquisition;
  record.status = 'downloaded';
  delete record.reason;
  addAttempt(record, context, candidate.source, 'downloaded', 'Acquired and extracted full text.', local ? undefined : candidate.url);
}

async function findManualCandidate(
  workspaceRoot: string,
  record: CitationSourceRecord,
): Promise<AcquisitionCandidate | null> {
  for (const [file, mediaType] of [['manual.xml', 'application/xml'], ['manual.pdf', 'application/pdf']] as const) {
    const relative = `${record.directory}/${file}`;
    const absolute = resolveCitationArtifactPath(workspaceRoot, relative);
    try {
      const stat = await fs.stat(absolute);
      if (stat.isFile()) return { source: 'manual', url: absolute, mediaType };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return null;
}

function europePmcCandidate(pmcid: string): AcquisitionCandidate {
  return {
    source: 'pmc',
    url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`,
    mediaType: 'application/xml',
    landingPageUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(pmcid)}/`,
  };
}

async function fetchJson(url: string, context: RemoteContext): Promise<unknown> {
  const bytes = await fetchBytes(url, context, MAX_METADATA_RESPONSE_BYTES, 'application/json');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Scholarly metadata service returned invalid JSON.');
  }
}

async function fetchBytes(
  initialUrl: string,
  context: RemoteContext,
  maxBytes: number,
  accept?: string,
): Promise<Buffer> {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttpsUrl(current, context.resolveHost);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: accept ?? 'application/pdf, application/xml, text/xml;q=0.9, */*;q=0.1',
        'User-Agent': `Octave/0.1 citation-fetcher${context.email ? ` (mailto:${context.email})` : ''}`,
      };
      const response = await context.fetch(current, { headers, redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Citation source returned a redirect without a location.');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new HttpStatusError(response.status, `Citation source returned HTTP ${response.status}.`);

      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > maxBytes) throw new Error(`Citation source exceeds the ${formatMegabytes(maxBytes)} MB download limit.`);
      return await readResponseBody(response, maxBytes);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Citation source request timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Citation source exceeded the redirect limit.');
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Citation source exceeds the ${formatMegabytes(maxBytes)} MB download limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function assertPublicHttpsUrl(url: URL, resolveHost: (hostname: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('Citation downloads require HTTPS.');
  if (url.username || url.password) throw new Error('Citation source URLs cannot include credentials.');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Citation source resolves to a local network host.');
  }
  const addresses = net.isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error('Citation source resolves to a private or non-routable address.');
  }
}

async function resolvePublicHost(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (net.isIPv4(normalized)) {
    const [first = 0, second = 0, third = 0] = normalized.split('.').map(Number);
    return (
      first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  if (net.isIPv6(normalized)) {
    const words = expandIpv6(normalized);
    if (!words) return true;
    const [first = 0, second = 0] = words;
    if (words.slice(0, 7).every((word) => word === 0) && (words[7] === 0 || words[7] === 1)) return true;
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
    if (first === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return true;
    if (first === 0x2001 && (second === 0x0002 || second === 0x0db8)) return true;
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
      return isPrivateAddress(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`);
    }
    if (first === 0x2002) {
      return isPrivateAddress(`${second >> 8}.${second & 0xff}.${words[2]! >> 8}.${words[2]! & 0xff}`);
    }
    return false;
  }
  return true;
}

function expandIpv6(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const values = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    .map((word) => Number.parseInt(word, 16));
  return values.length === 8 && values.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? values
    : null;
}

function validateSourceBytes(bytes: Buffer, mediaType: AcquisitionCandidate['mediaType']): void {
  if (!bytes.length) throw new Error('Citation source returned an empty file.');
  if (mediaType === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Citation source did not return a valid PDF file.');
  }
  if (mediaType === 'application/xml' && !bytes.toString('utf8', 0, Math.min(bytes.length, 500)).replace(/^\uFEFF/, '').trimStart().startsWith('<')) {
    throw new Error('Citation source did not return valid XML content.');
  }
}

async function readLocalCandidate(absolutePath: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error('Manual citation source is not a file.');
  if (stat.size > maxBytes) throw new Error(`Manual citation source exceeds the ${formatMegabytes(maxBytes)} MB limit.`);
  return fs.readFile(absolutePath);
}

async function acquisitionExists(workspaceRoot: string, record: CitationSourceRecord): Promise<boolean> {
  if (!record.acquisition) return false;
  try {
    await Promise.all([
      fs.access(resolveCitationArtifactPath(workspaceRoot, record.acquisition.originalPath)),
      fs.access(resolveCitationArtifactPath(workspaceRoot, record.acquisition.extractedPath)),
      fs.access(resolveCitationArtifactPath(workspaceRoot, record.acquisition.chunksPath)),
    ]);
    return true;
  } catch {
    return false;
  }
}

function addAttempt(
  record: CitationSourceRecord,
  context: RemoteContext,
  resolver: string,
  outcome: CitationSourceStatus,
  message: string,
  url?: string,
): void {
  const attempt: CitationAttempt = { attemptedAt: context.now().toISOString(), resolver, outcome, message };
  if (url) attempt.url = url;
  record.attempts = [...(record.attempts ?? []), attempt].slice(-MAX_ATTEMPTS_PER_RECORD);
}

function splitWithOverlap(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf(' ', end));
      if (boundary > start + Math.floor(maxChars * 0.6)) end = boundary + 1;
    }
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return parts.filter(Boolean);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function formatCrossrefAuthor(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const given = typeof value.given === 'string' ? value.given : '';
  const family = typeof value.family === 'string' ? value.family : '';
  return [family, given].filter(Boolean).join(', ') || undefined;
}

function crossrefYear(message: Record<string, unknown>): string | undefined {
  for (const key of ['published-print', 'published-online', 'issued', 'created']) {
    const date = message[key];
    if (!isObject(date) || !Array.isArray(date['date-parts'])) continue;
    const first = date['date-parts'][0];
    if (Array.isArray(first) && typeof first[0] === 'number') return String(first[0]);
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0].trim() || undefined : undefined;
}

function encodeDoiPath(doi: string): string {
  return doi.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

async function writeBufferAtomic(destination: string, value: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value);
  await fs.rename(temporary, destination);
}

async function writeTextAtomic(destination: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, destination);
}

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
