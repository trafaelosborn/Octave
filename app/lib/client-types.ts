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
}

export interface ChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  content: string;
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
  summary: {
    cited: number;
    bibliography: number;
    missing: number;
    unused: number;
  };
}

export interface RevisionPreview {
  path: string;
  instruction: string;
  before: string;
  after: string;
}

export interface OutlineItem {
  level: 'section' | 'subsection' | 'subsubsection';
  title: string;
  line: number;
}

export type WorkView = 'editor' | 'chat' | 'review' | 'log' | 'pdf';
export type RailView = 'files' | 'search' | 'chats' | 'outline' | 'citations' | 'context';
