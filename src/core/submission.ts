import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipFile } from 'yazl';

export const SUBMISSION_MANIFEST_VERSION = 1;
export type SubmissionProfileId = 'generic' | 'anonymous-conference' | 'arxiv';
export type SubmissionIssueSeverity = 'error' | 'warning' | 'manual';

export interface SubmissionAuthor {
  name: string;
  email?: string;
  affiliation?: string;
  orcid?: string;
  corresponding?: boolean;
}

export interface SubmissionDeclarations {
  authorshipConfirmed: boolean;
  conflictsReviewed: boolean;
  fundingReviewed: boolean;
  ethicsReviewed: boolean;
  licenseReviewed: boolean;
}

export interface SubmissionManifest {
  version: 1;
  title: string;
  abstract: string;
  authors: SubmissionAuthor[];
  keywords: string[];
  manuscriptPath: string;
  supplementaryFiles: string[];
  venue: {
    profile: SubmissionProfileId;
    name: string;
    articleType: string;
    maxPages?: number;
  };
  declarations: SubmissionDeclarations;
  updatedAt: string;
}

export interface SubmissionIssue {
  severity: SubmissionIssueSeverity;
  code: string;
  message: string;
  path?: string;
  line?: number;
}

export interface SubmissionPreflight {
  generatedAt: string;
  ready: boolean;
  packageable: boolean;
  manuscriptPdfPath?: string;
  pdfPages?: number;
  sourceFiles: string[];
  totalSourceBytes: number;
  issues: SubmissionIssue[];
  summary: Record<SubmissionIssueSeverity, number>;
}

export interface SubmissionArtifact {
  name: string;
  bytes: number;
  sha256: string;
}

export interface SubmissionPackage {
  id: string;
  createdAt: string;
  directory: string;
  title: string;
  venue: string;
  artifacts: SubmissionArtifact[];
  preflight: SubmissionPreflight;
}

const MANIFEST_PATH = path.join('.octave', 'submission.json');
const PACKAGES_DIRECTORY = path.join('.octave', 'submissions');
const PACKAGE_RECORD = 'package-record.json';
const PACKAGE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;
const MAX_SOURCE_FILES = 500;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_SUPPLEMENT_BYTES = 250 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const FIXED_ZIP_TIME = new Date('2000-01-01T00:00:00.000Z');
const SOURCE_EXTENSIONS = new Set([
  '.tex', '.bib', '.bbl', '.sty', '.cls', '.bst', '.bbx', '.cbx',
  '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg',
  '.csv', '.tsv', '.txt', '.md', '.json', '.yaml', '.yml',
]);
const SUPPLEMENT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.py', '.r', '.js', '.ts', '.html', '.xml',
]);

export async function loadSubmissionManifest(workspaceRoot: string): Promise<SubmissionManifest | null> {
  try {
    const manifestFile = await resolveWorkspaceFile(workspaceRoot, MANIFEST_PATH, new Set(['.json']));
    const raw = await fs.readFile(manifestFile.absolute, 'utf8');
    return normalizeSubmissionManifest(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    if (error instanceof SyntaxError) throw new Error('The workspace submission manifest contains invalid JSON.');
    throw error;
  }
}

export async function saveSubmissionManifest(
  workspaceRoot: string,
  input: unknown,
): Promise<SubmissionManifest> {
  const manifest = normalizeSubmissionManifest(input, true);
  const metadataRoot = await ensureWorkspaceDirectory(workspaceRoot, '.octave');
  const destination = path.join(metadataRoot, 'submission.json');
  await writeJsonAtomic(destination, manifest);
  return manifest;
}

export async function createSubmissionDraft(
  workspaceRoot: string,
  manuscriptPath = '',
): Promise<SubmissionManifest> {
  const existing = await loadSubmissionManifest(workspaceRoot);
  if (existing) return existing;

  const draft: SubmissionManifest = {
    version: SUBMISSION_MANIFEST_VERSION,
    title: '',
    abstract: '',
    authors: [],
    keywords: [],
    manuscriptPath: normalizeRelativePath(manuscriptPath),
    supplementaryFiles: [],
    venue: { profile: 'generic', name: '', articleType: '' },
    declarations: emptyDeclarations(),
    updatedAt: new Date().toISOString(),
  };

  if (draft.manuscriptPath.toLowerCase().endsWith('.tex')) {
    try {
      const resolved = await resolveWorkspaceFile(workspaceRoot, draft.manuscriptPath, SOURCE_EXTENSIONS);
      const source = await fs.readFile(resolved.absolute, 'utf8');
      draft.title = cleanTex(extractTexCommand(source, 'title') ?? '');
      draft.abstract = cleanTex(extractTexEnvironment(source, 'abstract') ?? '');
      const authorSource = extractTexCommand(source, 'author') ?? '';
      draft.authors = authorSource
        .split(/\\and|\\\\/)
        .map((name) => cleanTex(name))
        .filter(Boolean)
        .map((name) => ({ name }));
    } catch {
      // A partially typed path should still produce an editable draft.
    }
  }
  return draft;
}

export async function preflightSubmission(
  workspaceRoot: string,
  input: unknown,
): Promise<SubmissionPreflight> {
  const manifest = normalizeSubmissionManifest(input);
  const issues: SubmissionIssue[] = [];
  validateMetadata(manifest, issues);

  const sourceResult = await collectSubmissionSources(workspaceRoot, manifest.manuscriptPath, issues);
  let manuscriptPdfPath: string | undefined;
  let pdfPages: number | undefined;

  if (!manifest.manuscriptPath) {
    issues.push(issue('error', 'manuscript_missing', 'Choose the manuscript that will be submitted.'));
  } else if (/\.tex$/i.test(manifest.manuscriptPath)) {
    const candidate = manifest.manuscriptPath.replace(/\.tex$/i, '.pdf');
    try {
      const resolved = await resolveWorkspaceFile(workspaceRoot, candidate, new Set(['.pdf']));
      manuscriptPdfPath = resolved.relative;
      const pdfStat = await fs.stat(resolved.absolute);
      if (pdfStat.size > MAX_PDF_BYTES) issues.push(issue('error', 'pdf_size_limit', 'The manuscript PDF exceeds the 100 MB package limit.', candidate));
      const newestSourceMtime = sourceResult.files.reduce((latest, file) => Math.max(latest, file.mtimeMs), 0);
      if (newestSourceMtime > pdfStat.mtimeMs + 1_000) {
        issues.push(issue('error', 'pdf_stale', 'The compiled PDF is older than one or more source files. Compile the manuscript again.', candidate));
      }
      pdfPages = await readPdfPageCount(resolved.absolute, issues, manifest.venue.profile === 'anonymous-conference');
    } catch (error) {
      issues.push(issue('error', 'pdf_missing', `A compiled PDF is required: ${errorMessage(error)}`, candidate));
    }
  } else if (/\.pdf$/i.test(manifest.manuscriptPath)) {
    try {
      const resolved = await resolveWorkspaceFile(workspaceRoot, manifest.manuscriptPath, new Set(['.pdf']));
      manuscriptPdfPath = resolved.relative;
      if (resolved.size > MAX_PDF_BYTES) issues.push(issue('error', 'pdf_size_limit', 'The manuscript PDF exceeds the 100 MB package limit.', resolved.relative));
      pdfPages = await readPdfPageCount(resolved.absolute, issues, manifest.venue.profile === 'anonymous-conference');
    } catch (error) {
      issues.push(issue('error', 'pdf_missing', errorMessage(error), manifest.manuscriptPath));
    }
  } else {
    issues.push(issue('error', 'manuscript_format', 'Submission packaging currently requires a TeX source file or a final PDF.', manifest.manuscriptPath));
  }

  if (manifest.venue.maxPages !== undefined && pdfPages !== undefined && pdfPages > manifest.venue.maxPages) {
    issues.push(issue('error', 'page_limit', `The PDF has ${pdfPages} pages; the configured limit is ${manifest.venue.maxPages}.`, manuscriptPdfPath));
  }

  if (manifest.venue.profile === 'arxiv' && !manifest.manuscriptPath.toLowerCase().endsWith('.tex')) {
    issues.push(issue('error', 'arxiv_source_required', 'The arXiv profile requires a TeX manuscript so Octave can build a source archive.'));
  }

  await inspectSourceContent(workspaceRoot, manifest, sourceResult.files, issues);
  await inspectSupplements(workspaceRoot, manifest.supplementaryFiles, issues);
  addDeclarationIssues(manifest.declarations, issues);

  const summary = summarizeIssues(issues);
  const result: SubmissionPreflight = {
    generatedAt: new Date().toISOString(),
    ready: summary.error === 0 && summary.manual === 0,
    packageable: summary.error === 0,
    sourceFiles: sourceResult.files.map((file) => file.relative),
    totalSourceBytes: sourceResult.files.reduce((sum, file) => sum + file.size, 0),
    issues,
    summary,
  };
  if (manuscriptPdfPath !== undefined) result.manuscriptPdfPath = manuscriptPdfPath;
  if (pdfPages !== undefined) result.pdfPages = pdfPages;
  return result;
}

export async function createSubmissionPackage(
  workspaceRoot: string,
  input: unknown,
): Promise<SubmissionPackage> {
  const manifest = await saveSubmissionManifest(workspaceRoot, input);
  const preflight = await preflightSubmission(workspaceRoot, manifest);
  if (!preflight.packageable || !preflight.manuscriptPdfPath) {
    throw new Error('Resolve the blocking preflight errors before creating a submission package.');
  }

  const root = await fs.realpath(path.resolve(workspaceRoot));
  const id = packageId(manifest);
  const packagesRoot = await ensureWorkspaceDirectory(root, PACKAGES_DIRECTORY);
  const destination = path.join(packagesRoot, id);
  const temporary = await fs.mkdtemp(path.join(packagesRoot, `${id}.tmp-`));
  assertInsideRoot(temporary, root);

  try {
    const manuscriptPdf = await resolveWorkspaceFile(root, preflight.manuscriptPdfPath, new Set(['.pdf']));
    await fs.copyFile(manuscriptPdf.absolute, path.join(temporary, 'manuscript.pdf'));
    await writeJsonAtomic(path.join(temporary, 'submission.json'), manifest);
    await writeJsonAtomic(path.join(temporary, 'preflight.json'), preflight);

    if (preflight.sourceFiles.length > 0) {
      const sourceEntries = await Promise.all(preflight.sourceFiles.map((file) => resolveWorkspaceFile(root, file, SOURCE_EXTENSIONS)));
      await writeZip(path.join(temporary, 'source.zip'), sourceEntries.map((file) => ({ absolute: file.absolute, archivePath: file.relative })));
    }

    for (const supplement of manifest.supplementaryFiles) {
      const resolved = await resolveWorkspaceFile(root, supplement, SUPPLEMENT_EXTENSIONS);
      const target = path.join(temporary, 'supplementary', ...resolved.relative.split('/'));
      assertInsideRoot(target, temporary);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(resolved.absolute, target);
    }

    const uploadArtifacts = await artifactRecords(await listFilesRecursive(temporary));
    await writeJsonAtomic(path.join(temporary, 'checksums.json'), {
      algorithm: 'sha256',
      generatedAt: new Date().toISOString(),
      artifacts: uploadArtifacts,
    });
    const bundleEntries = await listFilesRecursive(temporary);
    await writeZip(
      path.join(temporary, 'submission-bundle.zip'),
      bundleEntries
        .filter((file) => file.relative !== 'submission-bundle.zip' && file.relative !== PACKAGE_RECORD)
        .map((file) => ({ absolute: file.absolute, archivePath: file.relative })),
    );

    const artifacts = await artifactRecords(
      (await listFilesRecursive(temporary)).filter((file) => file.relative !== PACKAGE_RECORD),
    );
    const record: SubmissionPackage = {
      id,
      createdAt: new Date().toISOString(),
      directory: path.relative(root, destination).replace(/\\/g, '/'),
      title: manifest.title,
      venue: manifest.venue.name,
      artifacts,
      preflight,
    };
    await writeJsonAtomic(path.join(temporary, PACKAGE_RECORD), record);
    await fs.rename(temporary, destination);
    return record;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function listSubmissionPackages(workspaceRoot: string): Promise<SubmissionPackage[]> {
  let packagesRoot;
  try {
    packagesRoot = await resolveWorkspaceDirectory(workspaceRoot, PACKAGES_DIRECTORY);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  let entries;
  try {
    entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const packages: SubmissionPackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PACKAGE_ID_PATTERN.test(entry.name)) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(packagesRoot, entry.name, PACKAGE_RECORD), 'utf8')) as SubmissionPackage;
      if (isSubmissionPackage(parsed, entry.name)) packages.push(parsed);
    } catch {
      // One incomplete package should not hide valid neighboring packages.
    }
  }
  return packages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function resolveSubmissionArtifact(
  workspaceRoot: string,
  packageIdValue: string,
  artifactName: string,
): Promise<{ absolute: string; name: string }> {
  if (!PACKAGE_ID_PATTERN.test(packageIdValue)) throw new Error('Invalid submission package ID.');
  const packages = await listSubmissionPackages(workspaceRoot);
  const submissionPackage = packages.find((candidate) => candidate.id === packageIdValue);
  if (!submissionPackage) throw new Error('Submission package not found.');
  const artifact = submissionPackage.artifacts.find((candidate) => candidate.name === artifactName);
  if (!artifact) throw new Error('Submission artifact not found.');
  const packagesRoot = await resolveWorkspaceDirectory(workspaceRoot, PACKAGES_DIRECTORY);
  const packageRoot = path.join(packagesRoot, packageIdValue);
  const absolute = path.resolve(packageRoot, ...artifact.name.split('/'));
  assertInsideRoot(absolute, packageRoot);
  const real = await fs.realpath(absolute);
  assertInsideRoot(real, packageRoot);
  return { absolute: real, name: path.basename(artifact.name) };
}

export function normalizeSubmissionManifest(value: unknown, touch = false): SubmissionManifest {
  if (!value || typeof value !== 'object') throw new Error('Submission manifest must be an object.');
  const candidate = value as Partial<SubmissionManifest>;
  const venue: Partial<SubmissionManifest['venue']> = candidate.venue && typeof candidate.venue === 'object'
    ? candidate.venue
    : { profile: 'generic', name: '', articleType: '' };
  const profile = venue.profile;
  if (!['generic', 'anonymous-conference', 'arxiv'].includes(String(profile))) {
    throw new Error('Unknown submission venue profile.');
  }
  const maxPages = venue.maxPages;
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10_000)) {
    throw new Error('Page limit must be an integer between 1 and 10,000.');
  }
  const authors = Array.isArray(candidate.authors) ? candidate.authors.map(normalizeAuthor) : [];
  if (authors.length > 500) throw new Error('Submission manifest cannot contain more than 500 authors.');
  const declarations = candidate.declarations && typeof candidate.declarations === 'object'
    ? candidate.declarations
    : emptyDeclarations();
  const manifest: SubmissionManifest = {
    version: SUBMISSION_MANIFEST_VERSION,
    title: boundedString(candidate.title, 2_000, 'Title'),
    abstract: boundedString(candidate.abstract, 100_000, 'Abstract'),
    authors,
    keywords: uniqueStrings(candidate.keywords, 100, 200, 'Keywords'),
    manuscriptPath: normalizeRelativePath(candidate.manuscriptPath),
    supplementaryFiles: uniqueStrings(candidate.supplementaryFiles, 100, 2_000, 'Supplementary files').map(normalizeRelativePath),
    venue: {
      profile: profile as SubmissionProfileId,
      name: boundedString(venue.name, 1_000, 'Venue name'),
      articleType: boundedString(venue.articleType, 500, 'Article type'),
    },
    declarations: {
      authorshipConfirmed: declarations.authorshipConfirmed === true,
      conflictsReviewed: declarations.conflictsReviewed === true,
      fundingReviewed: declarations.fundingReviewed === true,
      ethicsReviewed: declarations.ethicsReviewed === true,
      licenseReviewed: declarations.licenseReviewed === true,
    },
    updatedAt: touch ? new Date().toISOString() : validIso(candidate.updatedAt) ?? new Date().toISOString(),
  };
  if (maxPages !== undefined) manifest.venue.maxPages = maxPages;
  return manifest;
}

function normalizeAuthor(value: unknown): SubmissionAuthor {
  if (!value || typeof value !== 'object') throw new Error('Each submission author must be an object.');
  const author = value as Partial<SubmissionAuthor>;
  const normalized: SubmissionAuthor = { name: boundedString(author.name, 500, 'Author name') };
  const email = boundedOptionalString(author.email, 500, 'Author email');
  const affiliation = boundedOptionalString(author.affiliation, 2_000, 'Author affiliation');
  const orcid = boundedOptionalString(author.orcid, 100, 'Author ORCID');
  if (email) normalized.email = email;
  if (affiliation) normalized.affiliation = affiliation;
  if (orcid) normalized.orcid = orcid;
  if (author.corresponding === true) normalized.corresponding = true;
  return normalized;
}

function validateMetadata(manifest: SubmissionManifest, issues: SubmissionIssue[]): void {
  if (!manifest.title) issues.push(issue('error', 'title_missing', 'Add the submission title.'));
  if (!manifest.abstract) issues.push(issue('warning', 'abstract_missing', 'Add the abstract before portal submission.'));
  if (manifest.authors.length === 0) issues.push(issue('error', 'authors_missing', 'Add at least one author.'));
  if (!manifest.venue.name) issues.push(issue('warning', 'venue_missing', 'Name the target journal, conference, or repository.'));
  if (!manifest.venue.articleType) issues.push(issue('warning', 'article_type_missing', 'Choose or record the venue article type.'));
  manifest.authors.forEach((author, index) => {
    if (!author.name) issues.push(issue('error', 'author_name_missing', `Author ${index + 1} needs a name.`));
    if (author.email && !/^\S+@\S+\.\S+$/.test(author.email)) issues.push(issue('warning', 'author_email_invalid', `${author.name || `Author ${index + 1}`} has an unusual email address.`));
    if (author.orcid && !/^(?:https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-[\dX]{4}$/i.test(author.orcid)) {
      issues.push(issue('warning', 'author_orcid_invalid', `${author.name || `Author ${index + 1}`} has an invalid ORCID format.`));
    }
  });
}

async function collectSubmissionSources(
  workspaceRoot: string,
  manuscriptPath: string,
  issues: SubmissionIssue[],
): Promise<{ files: WorkspaceFile[] }> {
  if (!manuscriptPath.toLowerCase().endsWith('.tex')) return { files: [] };
  const files = new Map<string, WorkspaceFile>();
  const pending = [{ relative: manuscriptPath, required: true }];
  let totalBytes = 0;

  while (pending.length > 0) {
    const next = pending.shift();
    if (!next) break;
    let file;
    try {
      file = await resolveWorkspaceFile(workspaceRoot, next.relative, SOURCE_EXTENSIONS);
    } catch (error) {
      if (next.required) issues.push(issue('error', 'source_dependency_missing', errorMessage(error), normalizeRelativePath(next.relative)));
      continue;
    }
    if (files.has(file.relative)) continue;
    if (totalBytes + file.size > MAX_SOURCE_BYTES) {
      issues.push(issue('error', 'source_size_limit', `The source archive exceeds ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`));
      break;
    }
    files.set(file.relative, file);
    totalBytes += file.size;
    if (files.size > MAX_SOURCE_FILES) {
      issues.push(issue('error', 'source_file_limit', `The source tree exceeds ${MAX_SOURCE_FILES} files.`));
      break;
    }
    if (file.extension !== '.tex') continue;
    if (file.relative === normalizeRelativePath(manuscriptPath)) {
      const bblPath = file.relative.replace(/\.tex$/i, '.bbl');
      try {
        const bbl = await resolveWorkspaceFile(workspaceRoot, bblPath, SOURCE_EXTENSIONS);
        pending.push({ relative: bbl.relative, required: false });
      } catch {
        // A BBL is optional for most profiles, but included when compilation produced one.
      }
    }
    const source = await fs.readFile(file.absolute, 'utf8');
    const directory = path.posix.dirname(file.relative);
    for (const dependency of texDependencies(source)) {
      for (const candidate of dependencyCandidates(directory, dependency.value, dependency.extensions)) {
        try {
          const resolved = await resolveWorkspaceFile(workspaceRoot, candidate, SOURCE_EXTENSIONS);
          pending.push({ relative: resolved.relative, required: dependency.required });
          break;
        } catch {
          // Try the next extension candidate.
        }
      }
      if (dependency.required && !dependencyCandidates(directory, dependency.value, dependency.extensions)
        .some((candidate) => files.has(normalizeRelativePath(candidate)) || pending.some((item) => item.relative === normalizeRelativePath(candidate)))) {
        const exists = await firstExistingWorkspaceFile(workspaceRoot, directory, dependency);
        if (!exists) issues.push(issue('error', 'source_dependency_missing', `Referenced source file was not found: ${dependency.value}`, file.relative));
      }
    }
  }

  return { files: [...files.values()].sort((a, b) => a.relative.localeCompare(b.relative)) };
}

async function inspectSourceContent(
  workspaceRoot: string,
  manifest: SubmissionManifest,
  files: WorkspaceFile[],
  issues: SubmissionIssue[],
): Promise<void> {
  const bibliographyKeys = new Set<string>();
  const citations: Array<{ key: string; path: string; line: number }> = [];
  for (const file of files) {
    if (!['.tex', '.bib', '.bbl', '.txt', '.md', '.json', '.yaml', '.yml'].includes(file.extension) || file.size > 5 * 1024 * 1024) continue;
    const source = await fs.readFile(file.absolute, 'utf8');
    const secret = secretMatch(source);
    if (secret) issues.push(issue('error', 'secret_detected', `Possible credential or private key detected (${secret}). Remove it from the submission source.`, file.relative));
    if (file.extension === '.bib') {
      for (const match of source.matchAll(/@\w+\s*[{(]\s*([^,\s]+)/g)) if (match[1]) bibliographyKeys.add(match[1].trim());
    }
    if (file.extension !== '.tex') continue;
    for (const match of source.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) if (match[1]) bibliographyKeys.add(match[1].trim());
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\\(?:todo|marginpar|show|includeonly)\b|%\s*(?:TODO|FIXME|WTF)\b/i.test(line)) {
        issues.push(issue('warning', 'draft_marker', 'Draft-only command or comment remains in the TeX source.', file.relative, index + 1));
      }
      for (const match of line.matchAll(/\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g)) {
        for (const key of (match[1] ?? '').split(',').map((value) => value.trim()).filter(Boolean)) citations.push({ key, path: file.relative, line: index + 1 });
      }
    });
  }
  for (const citation of citations) {
    if (!bibliographyKeys.has(citation.key)) issues.push(issue('error', 'citation_missing', `Citation key has no packaged bibliography entry: ${citation.key}`, citation.path, citation.line));
  }

  if (manifest.manuscriptPath.toLowerCase().endsWith('.tex')) {
    try {
      const main = await resolveWorkspaceFile(workspaceRoot, manifest.manuscriptPath, SOURCE_EXTENSIONS);
      const source = await fs.readFile(main.absolute, 'utf8');
      const sourceTitle = cleanTex(extractTexCommand(source, 'title') ?? '');
      if (sourceTitle && manifest.title && normalizeComparison(sourceTitle) !== normalizeComparison(manifest.title)) {
        issues.push(issue('warning', 'title_mismatch', 'The manifest title differs from the TeX \\title value.', main.relative));
      }
      if (manifest.venue.profile === 'anonymous-conference') {
        const author = cleanTex(extractTexCommand(source, 'author') ?? '');
        if (author && !/anonymous/i.test(author)) issues.push(issue('error', 'anonymity_author', 'The anonymous profile found a non-anonymous \\author value.', main.relative));
        if (/\\(?:email|affiliation|institute|orcid|thanks)\b|pdfauthor\s*=/i.test(source)) {
          issues.push(issue('error', 'anonymity_metadata', 'The anonymous profile found author-identifying TeX metadata.', main.relative));
        }
      }
    } catch {
      // The missing manuscript is already reported elsewhere.
    }
  }

  if (manifest.manuscriptPath.toLowerCase().endsWith('.tex')) {
    const logPath = manifest.manuscriptPath.replace(/\.tex$/i, '.log');
    try {
      const log = await resolveWorkspaceFile(workspaceRoot, logPath, new Set(['.log']));
      const content = await fs.readFile(log.absolute, 'utf8');
      if (/undefined references|Citation .* undefined|There were undefined citations/i.test(content)) {
        issues.push(issue('error', 'latex_unresolved', 'The latest LaTeX log reports unresolved references or citations.', log.relative));
      }
      if (/Overfull \\hbox/i.test(content)) issues.push(issue('warning', 'latex_overfull', 'The latest LaTeX log reports overfull boxes.', log.relative));
    } catch {
      issues.push(issue('warning', 'latex_log_missing', 'No LaTeX log was found; compile in Octave before final submission.'));
    }
  }
}

async function inspectSupplements(workspaceRoot: string, files: string[], issues: SubmissionIssue[]): Promise<void> {
  let totalBytes = 0;
  for (const file of files) {
    try {
      const resolved = await resolveWorkspaceFile(workspaceRoot, file, SUPPLEMENT_EXTENSIONS);
      totalBytes += resolved.size;
      if (resolved.size <= 5 * 1024 * 1024 && ['.txt', '.md', '.json', '.yaml', '.yml', '.py', '.r', '.js', '.ts'].includes(resolved.extension)) {
        const source = await fs.readFile(resolved.absolute, 'utf8');
        const secret = secretMatch(source);
        if (secret) issues.push(issue('error', 'secret_detected', `Possible credential detected in supplementary material (${secret}).`, resolved.relative));
      }
    } catch (error) {
      issues.push(issue('error', 'supplement_missing', errorMessage(error), normalizeRelativePath(file)));
    }
  }
  if (totalBytes > MAX_SUPPLEMENT_BYTES) issues.push(issue('error', 'supplement_size_limit', 'Supplementary files exceed the 250 MB package limit.'));
}

async function readPdfPageCount(absolute: string, issues: SubmissionIssue[], anonymous: boolean): Promise<number | undefined> {
  try {
    const data = new Uint8Array(await fs.readFile(absolute));
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({ data });
    const document = await loading.promise;
    const pages = document.numPages;
    if (anonymous) {
      const metadata = await document.getMetadata();
      const info = metadata.info as Record<string, unknown>;
      const author = typeof info.Author === 'string' ? info.Author.trim() : '';
      if (author && !/anonymous/i.test(author)) {
        issues.push(issue('error', 'anonymity_pdf_metadata', 'The PDF metadata contains a non-anonymous author value.', path.basename(absolute)));
      }
    }
    await loading.destroy();
    return pages;
  } catch (error) {
    issues.push(issue('warning', 'pdf_inspection_failed', `Octave could not count PDF pages: ${errorMessage(error)}`, path.basename(absolute)));
    return undefined;
  }
}

function addDeclarationIssues(declarations: SubmissionDeclarations, issues: SubmissionIssue[]): void {
  const checks: Array<[keyof SubmissionDeclarations, string]> = [
    ['authorshipConfirmed', 'Every listed author has approved the submission and author order.'],
    ['conflictsReviewed', 'Conflicts of interest and suggested/opposed reviewers have been reviewed.'],
    ['fundingReviewed', 'Funding and grant disclosures have been reviewed.'],
    ['ethicsReviewed', 'Ethics, consent, data, and code statements have been reviewed where applicable.'],
    ['licenseReviewed', 'Copyright, license, originality, and venue declarations have been reviewed.'],
  ];
  for (const [key, message] of checks) if (!declarations[key]) issues.push(issue('manual', `declaration_${key}`, message));
}

interface WorkspaceFile {
  absolute: string;
  relative: string;
  extension: string;
  size: number;
  mtimeMs: number;
}

async function resolveWorkspaceFile(root: string, input: string, extensions: Set<string>): Promise<WorkspaceFile> {
  const relative = normalizeRelativePath(input);
  if (!relative) throw new Error('A workspace-relative file path is required.');
  const extension = path.posix.extname(relative).toLowerCase();
  if (!extensions.has(extension)) throw new Error(`File type is not allowed in a submission package: ${extension || '(none)'}`);
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const candidate = path.resolve(resolvedRoot, ...relative.split('/'));
  assertInsideRoot(candidate, resolvedRoot);
  const absolute = await fs.realpath(candidate);
  assertInsideRoot(absolute, resolvedRoot);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`Submission path is not a file: ${relative}`);
  return { absolute, relative, extension, size: stat.size, mtimeMs: stat.mtimeMs };
}

async function resolveWorkspaceDirectory(root: string, input: string): Promise<string> {
  const relative = normalizeRelativePath(input);
  if (!relative) throw new Error('A workspace-relative directory path is required.');
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const candidate = path.resolve(resolvedRoot, ...relative.split('/'));
  assertInsideRoot(candidate, resolvedRoot);
  const absolute = await fs.realpath(candidate);
  assertInsideRoot(absolute, resolvedRoot);
  const stat = await fs.stat(absolute);
  if (!stat.isDirectory()) throw new Error(`Submission path is not a directory: ${relative}`);
  return absolute;
}

async function ensureWorkspaceDirectory(root: string, input: string): Promise<string> {
  const relative = normalizeRelativePath(input);
  if (!relative) throw new Error('A workspace-relative directory path is required.');
  const resolvedRoot = await fs.realpath(path.resolve(root));
  let current = resolvedRoot;
  for (const segment of relative.split('/')) {
    const candidate = path.join(current, segment);
    assertInsideRoot(candidate, resolvedRoot);
    try {
      const absolute = await fs.realpath(candidate);
      assertInsideRoot(absolute, resolvedRoot);
      const stat = await fs.stat(absolute);
      if (!stat.isDirectory()) throw new Error(`Submission path is not a directory: ${relative}`);
      current = absolute;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      await fs.mkdir(candidate);
      current = await fs.realpath(candidate);
      assertInsideRoot(current, resolvedRoot);
    }
  }
  return current;
}

function texDependencies(source: string): Array<{ value: string; extensions: string[]; required: boolean }> {
  const clean = source.split(/\r?\n/).map(stripTexComment).join('\n');
  const dependencies: Array<{ value: string; extensions: string[]; required: boolean }> = [];
  const patterns: Array<[RegExp, string[], boolean, boolean]> = [
    [/\\(?:input|include|subfile)\s*\{([^}]+)\}/g, ['.tex'], true, false],
    [/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg'], true, false],
    [/\\(?:addbibresource)(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.bib'], true, false],
    [/\\bibliography\s*\{([^}]+)\}/g, ['.bib'], true, true],
    [/\\documentclass(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.cls'], false, false],
    [/\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.sty'], false, true],
  ];
  for (const [pattern, extensions, required, commaSeparated] of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const values = commaSeparated ? (match[1] ?? '').split(',') : [match[1] ?? ''];
      for (const value of values.map((item) => item.trim()).filter(Boolean)) dependencies.push({ value, extensions, required });
    }
  }
  return dependencies;
}

function dependencyCandidates(directory: string, value: string, extensions: string[]): string[] {
  const raw = normalizeRelativePath(path.posix.join(directory === '.' ? '' : directory, value));
  if (path.posix.extname(raw)) return [raw];
  return extensions.map((extension) => `${raw}${extension}`);
}

async function firstExistingWorkspaceFile(
  workspaceRoot: string,
  directory: string,
  dependency: { value: string; extensions: string[] },
): Promise<boolean> {
  for (const candidate of dependencyCandidates(directory, dependency.value, dependency.extensions)) {
    try {
      await resolveWorkspaceFile(workspaceRoot, candidate, SOURCE_EXTENSIONS);
      return true;
    } catch {
      // Continue through extension candidates.
    }
  }
  return false;
}

async function writeZip(destination: string, entries: Array<{ absolute: string; archivePath: string }>): Promise<void> {
  const zip = new ZipFile();
  const output = createWriteStream(destination, { mode: 0o600 });
  zip.outputStream.pipe(output);
  for (const entry of entries.sort((a, b) => a.archivePath.localeCompare(b.archivePath))) {
    zip.addFile(entry.absolute, entry.archivePath.replace(/\\/g, '/'), { mtime: FIXED_ZIP_TIME, mode: 0o100644 });
  }
  zip.end();
  await finished(output);
}

async function listFilesRecursive(root: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        files.push({
          absolute,
          relative: path.relative(root, absolute).replace(/\\/g, '/'),
          extension: path.extname(entry.name).toLowerCase(),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function writeJsonAtomic(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, destination);
}

async function fileHash(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  return hash.digest('hex');
}

async function artifactRecords(files: WorkspaceFile[]): Promise<SubmissionArtifact[]> {
  return Promise.all(files.map(async (file) => ({
    name: file.relative,
    bytes: file.size,
    sha256: await fileHash(file.absolute),
  })));
}

function summarizeIssues(issues: SubmissionIssue[]): Record<SubmissionIssueSeverity, number> {
  return issues.reduce<Record<SubmissionIssueSeverity, number>>((summary, current) => {
    summary[current.severity] += 1;
    return summary;
  }, { error: 0, warning: 0, manual: 0 });
}

function issue(severity: SubmissionIssueSeverity, code: string, message: string, file?: string, line?: number): SubmissionIssue {
  const result: SubmissionIssue = { severity, code, message };
  if (file) result.path = file;
  if (line !== undefined) result.line = line;
  return result;
}

function secretMatch(source: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key'],
    [/(?:OPENAI|ANTHROPIC|XAI)_API_KEY\s*[:=]\s*[^\s"']{8,}/i, 'provider API key'],
    [/\bsk-(?:ant-)?[a-zA-Z0-9_-]{16,}\b/, 'API key'],
    [/\bgh[pousr]_[a-zA-Z0-9]{20,}\b/, 'GitHub token'],
  ];
  return patterns.find(([pattern]) => pattern.test(source))?.[1] ?? null;
}

function stripTexComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '%' && line[index - 1] !== '\\') return line.slice(0, index);
  }
  return line;
}

function extractTexCommand(source: string, command: string): string | null {
  const marker = new RegExp(`\\\\${command}(?:\\[[^\\]]*\\])?\\s*\\{`, 'i').exec(source);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  return null;
}

function extractTexEnvironment(source: string, name: string): string | null {
  const match = new RegExp(`\\\\begin\\{${name}\\}([\\s\\S]*?)\\\\end\\{${name}\\}`, 'i').exec(source);
  return match?.[1] ?? null;
}

function cleanTex(value: string): string {
  return value
    .replace(/%.*$/gm, ' ')
    .replace(/\\(?:thanks|email|affiliation|institute|orcid)(?:\[[^\]]*\])?\{[^}]*\}/gi, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRelativePath(value: unknown): string {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized) return '';
  if (normalized.includes('\0') || /^[a-z]:/i.test(normalized)) throw new Error('Submission file paths must be workspace-relative.');
  const clean = path.posix.normalize(normalized);
  if (clean === '..' || clean.startsWith('../') || path.posix.isAbsolute(clean)) throw new Error('Submission file path escapes the workspace.');
  return clean.replace(/^\.\//, '');
}

function packageId(manifest: SubmissionManifest): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const label = slug(manifest.venue.name || manifest.title || 'submission').slice(0, 64) || 'submission';
  return `${timestamp}-${label}`;
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function normalizeComparison(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function boundedString(value: unknown, maxLength: number, name: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} exceeds ${maxLength.toLocaleString()} characters.`);
  return normalized;
}

function boundedOptionalString(value: unknown, maxLength: number, name: string): string | undefined {
  const normalized = boundedString(value, maxLength, name);
  return normalized || undefined;
}

function uniqueStrings(value: unknown, maxItems: number, maxLength: number, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`);
  if (value.length > maxItems) throw new Error(`${name} cannot contain more than ${maxItems} items.`);
  return [...new Set(value.map((item) => boundedString(item, maxLength, name)).filter(Boolean))];
}

function emptyDeclarations(): SubmissionDeclarations {
  return {
    authorshipConfirmed: false,
    conflictsReviewed: false,
    fundingReviewed: false,
    ethicsReviewed: false,
    licenseReviewed: false,
  };
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function assertInsideRoot(target: string, root: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Submission path escapes the workspace.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isSubmissionPackage(value: unknown, id: string): value is SubmissionPackage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SubmissionPackage>;
  return candidate.id === id && typeof candidate.createdAt === 'string' && Array.isArray(candidate.artifacts);
}
