export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastDocumentPath?: string;
}

export interface OctaveFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  editable: boolean;
}

export interface ChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  providerId?: string;
  modelId?: string;
}

export interface ChatAttachment {
  path: string;
  name: string;
  kind: 'text' | 'pdf' | 'office' | 'image';
  content: string;
  warnings: string[];
  sourceBytes: number;
  truncated: boolean;
}

export type ChatScope = 'workspace' | 'document';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  scope: ChatScope;
  documentPath?: string;
  lastDocumentPath?: string;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  scope: ChatScope;
  documentPath?: string;
  lastDocumentPath?: string;
}

export interface ProviderStatus {
  id: 'ollama' | 'cli' | 'anthropic' | 'openai' | 'xai' | 'demo';
  name: string;
  available: boolean;
  local: boolean;
  models: Array<{ id: string; name?: string }>;
  setupHint?: string;
}

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface CitationIssue {
  key: string;
  path: string;
  line: number;
}

export interface CitationScan {
  citedKeys: string[];
  bibliographyKeys: string[];
  missing: CitationIssue[];
  unused: string[];
  sources: CitationSourceRecord[];
  sourceSummary: Record<CitationSourceStatus, number>;
  unpaywallConfigured: boolean;
  audit: {
    generatedAt: string;
    path: string;
    stale: boolean;
    truncated: boolean;
    summary: {
      claims: number;
      evidenceFound: number;
      noLexicalMatch: number;
      sourceUnavailable: number;
    };
    byCitation: Record<string, { claims: number; evidenceFound: number; unavailable: number }>;
  } | null;
  check: {
    generatedAt: string;
    path: string;
    markdownPath: string;
    stale: boolean;
    summary: {
      claims: number;
      likelySupported: number;
      weakMatch: number;
      noCandidatePassage: number;
      sourceUnavailable: number;
      bibliographyMissing: number;
      warnings: number;
      errors: number;
    };
  } | null;
  summary: {
    cited: number;
    bibliography: number;
    missing: number;
    unused: number;
  };
}

export type CitationSourceStatus =
  | 'not_requested'
  | 'unresolved'
  | 'downloaded'
  | 'metadata_only'
  | 'manual_required'
  | 'blocked_by_license'
  | 'ambiguous'
  | 'failed';

export interface CitationSourceRecord {
  key: string;
  directory: string;
  cited: boolean;
  status: CitationSourceStatus;
  fingerprint: string;
  entryType: string;
  bibPaths: string[];
  identifiers: { doi?: string; arxivId?: string; pmid?: string; pmcid?: string };
  metadata: { title?: string; authors?: string[]; year?: string; venue?: string; url?: string };
  reason?: string;
  acquisition?: {
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
    extractionWarnings?: string[];
  };
  attempts?: Array<{
    attemptedAt: string;
    resolver: string;
    outcome: CitationSourceStatus;
    message: string;
    url?: string;
  }>;
}

export type SourceRole = 'primary' | 'secondary' | 'dataset_archive' | 'unknown';

export interface SourceInventoryItem {
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  role: SourceRole;
  roleSource: 'inferred' | 'manual';
  tags: string[];
  rationale: string;
}

export interface SourceInventory {
  version: 1;
  generatedAt: string;
  inventoryPath: '.octave/source-inventory.json';
  sourceRoots: string[];
  sourceRootsPresent: boolean;
  items: SourceInventoryItem[];
  summary: Record<SourceRole, number> & { total: number; manual: number };
}

export interface EvidenceMapMeta {
  version: 1;
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
  sources: Array<{
    path: string;
    role: SourceRole;
    roleSource: 'inferred' | 'manual';
    tags: string[];
    name: string;
    extension: string;
    size: number;
    mtimeMs: number;
  }>;
  warnings: string[];
  passageCount: number;
}

export interface RevisionPreview {
  path: string;
  instruction: string;
  before: string;
  after: string;
}

export type SubmissionProfileId = 'generic' | 'anonymous-conference' | 'arxiv';
export type SubmissionIssueSeverity = 'error' | 'warning' | 'manual';

export interface SubmissionAuthor {
  name: string;
  email?: string;
  affiliation?: string;
  orcid?: string;
  corresponding?: boolean;
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
  declarations: {
    authorshipConfirmed: boolean;
    conflictsReviewed: boolean;
    fundingReviewed: boolean;
    ethicsReviewed: boolean;
    licenseReviewed: boolean;
  };
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

export interface SubmissionState {
  manifest: SubmissionManifest;
  preflight: SubmissionPreflight;
  packages: SubmissionPackage[];
  created?: SubmissionPackage;
}

export interface ReviewMemo {
  id: string;
  title: string;
  createdAt: string;
  sourceChatId: string;
  sourceMessageTs: string;
  sourceMessageIndex: number;
  artifactPath: string;
  content: string;
  documentPath?: string;
  providerId?: string;
  modelId?: string;
}

export type ReviewMemoMeta = Omit<ReviewMemo, 'content'>;

export interface OutlineItem {
  level: 'section' | 'subsection' | 'subsubsection';
  title: string;
  line: number;
}

export type WorkView = 'editor' | 'chat' | 'review' | 'memo' | 'submission' | 'log' | 'pdf';
export type RailView = 'files' | 'sources' | 'search' | 'chats' | 'reviews' | 'outline' | 'citations' | 'context';

export type DesktopProviderId = ProviderStatus['id'];
export type DesktopCloudProviderId = 'anthropic' | 'openai' | 'xai';
export type DesktopCredentialSource = 'saved' | 'environment' | 'none';

export interface DesktopProviderSettings {
  firstRun: boolean;
  encryptionAvailable: boolean;
  defaultProvider: DesktopProviderId;
  models: Record<DesktopProviderId, string>;
  ollamaBaseUrl: string;
  cliCommand: string;
  cliArgs: string;
  credentialSources: Record<DesktopCloudProviderId, DesktopCredentialSource>;
}

export interface DesktopProviderSettingsInput {
  defaultProvider: DesktopProviderId;
  models: Record<DesktopProviderId, string>;
  ollamaBaseUrl: string;
  cliCommand: string;
  cliArgs: string;
  credentials: Partial<Record<DesktopCloudProviderId, string | null>>;
}

export interface OctaveDesktopBridge {
  isDesktop: true;
  checkCliProvider: (input: { command: string }) => Promise<{
    installed: boolean;
    path: string | null;
    onPath: boolean;
    needsPathRepair: boolean;
    pathDirectory: string | null;
  }>;
  getProviderSettings: () => Promise<DesktopProviderSettings>;
  installCliProvider: (input: { preset: 'codex' | 'claude' | 'gemini' | 'grok' }) => Promise<{ launched: true }>;
  launchCliProviderSetup: (input: { command: string; args: string }) => Promise<{ launched: true }>;
  repairCliProviderPath: (input: { command: string }) => Promise<{
    installed: boolean;
    path: string | null;
    onPath: boolean;
    needsPathRepair: boolean;
    pathDirectory: string | null;
    repaired: boolean;
  }>;
  validateCliProvider: (input: { command: string; preset: 'codex' | 'claude' | 'gemini' | 'grok' | 'custom'; model: string }) => Promise<{
    installed: boolean;
    path: string | null;
    onPath: boolean;
    needsPathRepair: boolean;
    pathDirectory: string | null;
    accountStatus: 'unknown' | 'ok' | 'warn' | 'error';
    accountMessage: string;
    modelStatus: 'unknown' | 'ok' | 'warn' | 'error';
    modelMessage: string;
  }>;
  pickWorkspace: () => Promise<string | null>;
  saveProviderSettings: (settings: DesktopProviderSettingsInput) => Promise<DesktopProviderSettings>;
}

declare global {
  interface Window {
    octaveDesktop?: OctaveDesktopBridge;
  }
}
