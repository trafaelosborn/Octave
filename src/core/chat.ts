import { randomUUID } from 'node:crypto';

export interface ChatMessage {
  ts: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  lastDocumentPath?: string;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastDocumentPath?: string;
}

export function createNewChatSession(title = 'New chat'): ChatSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: title.trim() || 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
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
    (session.lastDocumentPath === undefined || typeof session.lastDocumentPath === 'string')
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.ts === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}
