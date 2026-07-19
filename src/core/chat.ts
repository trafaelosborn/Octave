import { randomUUID } from 'node:crypto';
import type { ExtractedDocumentKind } from './extract.js';

export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_CONTEXT_CHARS = 60_000;

export interface ChatAttachment {
  path: string;
  name: string;
  kind: ExtractedDocumentKind;
  content: string;
  warnings: string[];
  sourceBytes: number;
  truncated: boolean;
}

export interface ChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  providerId?: string;
  modelId?: string;
}

export interface ChatMessageAttribution {
  providerId: string;
  modelId?: string;
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

export function createNewChatSession(
  title = 'New chat',
  scope: ChatScope = 'workspace',
  documentPath?: string,
): ChatSession {
  if (scope === 'document' && !documentPath?.trim()) {
    throw new Error('Document chats require a document path.');
  }
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(),
    title: title.trim() || 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    scope,
  };
  if (documentPath?.trim()) session.documentPath = documentPath.trim();
  return session;
}

export function generateChatTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New chat';
  return cleaned.length > 70 ? `${cleaned.slice(0, 67)}...` : cleaned;
}

export function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false;

  const session = value as Partial<ChatSession>;
  return (
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    typeof session.createdAt === 'string' &&
    typeof session.updatedAt === 'string' &&
    Array.isArray(session.messages) &&
    session.messages.every(isChatMessage) &&
    (session.scope === 'workspace' || session.scope === 'document') &&
    (session.documentPath === undefined || typeof session.documentPath === 'string') &&
    (session.scope !== 'document' || Boolean(session.documentPath?.trim())) &&
    (session.lastDocumentPath === undefined || typeof session.lastDocumentPath === 'string')
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.ts === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    (message.attachments === undefined || (
      message.role === 'user' &&
      isValidAttachmentSet(message.attachments)
    )) &&
    (message.providerId === undefined || (
      message.role === 'assistant' && typeof message.providerId === 'string' && Boolean(message.providerId.trim())
    )) &&
    (message.modelId === undefined || (
      message.role === 'assistant' && typeof message.modelId === 'string' && Boolean(message.modelId.trim())
    ))
  );
}

function isValidAttachmentSet(value: unknown): value is ChatAttachment[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS || !value.every(isChatAttachment)) {
    return false;
  }
  return (
    value.reduce((total, attachment) => total + attachment.sourceBytes, 0) <= MAX_ATTACHMENT_SOURCE_BYTES &&
    value.reduce((total, attachment) => total + attachment.content.length, 0) <= MAX_ATTACHMENT_CONTEXT_CHARS
  );
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Partial<ChatAttachment>;
  return (
    typeof attachment.path === 'string' &&
    Boolean(attachment.path.trim()) &&
    typeof attachment.name === 'string' &&
    Boolean(attachment.name.trim()) &&
    (attachment.kind === 'text' || attachment.kind === 'pdf' || attachment.kind === 'office' || attachment.kind === 'image') &&
    typeof attachment.content === 'string' &&
    Array.isArray(attachment.warnings) &&
    attachment.warnings.every((warning) => typeof warning === 'string') &&
    typeof attachment.sourceBytes === 'number' &&
    Number.isSafeInteger(attachment.sourceBytes) &&
    attachment.sourceBytes >= 0 &&
    typeof attachment.truncated === 'boolean'
  );
}
