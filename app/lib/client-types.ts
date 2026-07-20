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
  id: 'ollama' | 'anthropic' | 'openai' | 'xai' | 'demo';
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

export interface RevisionPreview {
  path: string;
  instruction: string;
  before: string;
  after: string;
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

export type WorkView = 'editor' | 'chat' | 'review' | 'memo' | 'log' | 'pdf';
export type RailView = 'files' | 'search' | 'chats' | 'reviews' | 'outline' | 'citations' | 'context';

export interface OctaveDesktopBridge {
  isDesktop: true;
  pickWorkspace: () => Promise<string | null>;
}

declare global {
  interface Window {
    octaveDesktop?: OctaveDesktopBridge;
  }
}
