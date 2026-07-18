import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createNewChatSession,
  generateChatTitle,
  isChatSession,
  type ChatSession,
  type ChatSessionMeta,
  type ChatScope,
  type ChatAttachment,
  type ChatMessage,
} from '../core/chat.js';

const CHATS_DIRECTORY = path.join('.octave', 'chats');
const CHAT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export async function ensureChatDirectory(workspaceRoot: string): Promise<string> {
  const directory = path.join(path.resolve(workspaceRoot), CHATS_DIRECTORY);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export function assertValidChatId(chatId: string): void {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new Error('Invalid chat ID.');
  }
}

export async function listChats(workspaceRoot: string): Promise<ChatSessionMeta[]> {
  const directory = await ensureChatDirectory(workspaceRoot);
  const files = await fs.readdir(directory).catch(() => []);
  const metadata: ChatSessionMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const chatId = file.slice(0, -'.json'.length);
    if (!CHAT_ID_PATTERN.test(chatId)) continue;

    try {
      const session = await readSession(path.join(directory, file));
      metadata.push(toMetadata(session));
    } catch {
      // A malformed chat should not make the rest of the workspace unreadable.
    }
  }

  return metadata.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadChat(workspaceRoot: string, chatId: string): Promise<ChatSession | null> {
  assertValidChatId(chatId);

  try {
    return await readSession(await chatFilePath(workspaceRoot, chatId));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function saveChat(workspaceRoot: string, session: ChatSession): Promise<void> {
  assertValidChatId(session.id);
  if (!isChatSession(session)) {
    throw new Error('Cannot save an invalid chat session.');
  }

  const destination = await chatFilePath(workspaceRoot, session.id);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

export async function createChat(
  workspaceRoot: string,
  input: string | { title?: string; scope?: ChatScope; documentPath?: string } = {},
): Promise<ChatSession> {
  const options = typeof input === 'string' ? { title: input } : input;
  const session = createNewChatSession(options.title, options.scope, options.documentPath);
  await saveChat(workspaceRoot, session);
  return session;
}

export async function appendMessage(
  workspaceRoot: string,
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  attachments?: ChatAttachment[],
): Promise<ChatSession> {
  const normalizedContent = content.trim();
  if (!normalizedContent) throw new Error('Chat messages cannot be empty.');

  const session = await loadChat(workspaceRoot, chatId);
  if (!session) throw new Error(`Chat session not found: ${chatId}`);

  if (role === 'assistant' && attachments !== undefined) {
    throw new Error('Assistant messages cannot include file attachments.');
  }

  const message: ChatMessage = {
    ts: new Date().toISOString(),
    role,
    content: normalizedContent,
  };
  if (attachments !== undefined) message.attachments = attachments;
  session.messages.push(message);
  session.updatedAt = new Date().toISOString();

  if (!session.title || session.title === 'New chat') {
    const firstUserMessage = session.messages.find((message) => message.role === 'user');
    if (firstUserMessage) session.title = generateChatTitle(firstUserMessage.content);
  }

  await saveChat(workspaceRoot, session);
  return session;
}

export async function deleteChat(workspaceRoot: string, chatId: string): Promise<boolean> {
  assertValidChatId(chatId);

  try {
    await fs.unlink(await chatFilePath(workspaceRoot, chatId));
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function chatFilePath(workspaceRoot: string, chatId: string): Promise<string> {
  assertValidChatId(chatId);
  const directory = await ensureChatDirectory(workspaceRoot);
  return path.join(directory, `${chatId}.json`);
}

async function readSession(filePath: string): Promise<ChatSession> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid chat JSON: ${path.basename(filePath)}`);
  }

  const candidate = migrateLegacySession(parsed);
  if (!isChatSession(candidate)) {
    throw new Error(`Invalid chat session: ${path.basename(filePath)}`);
  }

  return candidate;
}

function migrateLegacySession(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const session = value as Record<string, unknown>;
  if (session.scope !== undefined) return value;
  return { ...session, scope: 'workspace' };
}

function toMetadata(session: ChatSession): ChatSessionMeta {
  const metadata: ChatSessionMeta = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    scope: session.scope,
  };
  if (session.documentPath !== undefined) metadata.documentPath = session.documentPath;
  if (session.lastDocumentPath !== undefined) {
    metadata.lastDocumentPath = session.lastDocumentPath;
  }
  return metadata;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
