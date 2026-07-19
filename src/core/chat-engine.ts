import path from 'node:path';
import {
  MAX_ATTACHMENT_CONTEXT_CHARS,
  MAX_ATTACHMENT_SOURCE_BYTES,
  MAX_CHAT_ATTACHMENTS,
  type ChatAttachment,
  type ChatMessage,
  type ChatMessageAttribution,
  type ChatSession,
} from './chat.js';
import { buildWorkspaceContext } from './context.js';
import { readDocument } from './path.js';
import type { LLMProvider, Message as ProviderMessage, StreamChatOptions } from '../providers/types.js';
import { appendMessage, loadChat, saveChat } from '../storage/chat-storage.js';

export interface SendMessageOptions {
  workspaceRoot: string;
  chatId: string;
  userMessage: string;
  provider: LLMProvider;
  currentDocumentPath?: string;
  pinnedFiles?: string[];
  attachmentPaths?: string[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxContextChars?: number;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  updatedSession: ChatSession;
}

export async function sendChatMessage(
  options: SendMessageOptions,
  onDelta?: (text: string) => void,
): Promise<SendMessageResult> {
  const userContent = options.userMessage.trim();
  if (!userContent) throw new Error('A user message is required.');

  const existing = await loadChat(options.workspaceRoot, options.chatId);
  if (!existing) throw new Error(`Chat session not found: ${options.chatId}`);
  if (
    existing.scope === 'document' &&
    options.currentDocumentPath !== undefined &&
    options.currentDocumentPath !== existing.documentPath
  ) {
    throw new Error('Document chat scope cannot switch to a different document.');
  }
  const scopedDocumentPath = existing.scope === 'document' ? existing.documentPath : undefined;
  const attachments = await extractAttachments(options.workspaceRoot, options.attachmentPaths ?? []);

  let session = await appendMessage(
    options.workspaceRoot,
    options.chatId,
    'user',
    userContent,
    attachments.length > 0 ? attachments : undefined,
  );
  if (scopedDocumentPath !== undefined) {
    session.lastDocumentPath = scopedDocumentPath;
    await saveChat(options.workspaceRoot, session);
  }

  const savedUserMessage = session.messages.at(-1);
  if (!savedUserMessage) throw new Error('Failed to persist the user message.');

  const contextOptions: Parameters<typeof buildWorkspaceContext>[0] = {
    workspaceRoot: options.workspaceRoot,
  };
  if (scopedDocumentPath !== undefined) contextOptions.currentDocumentPath = scopedDocumentPath;
  if (options.pinnedFiles !== undefined) contextOptions.pinnedFiles = options.pinnedFiles;
  if (options.maxContextChars !== undefined) contextOptions.maxContextChars = options.maxContextChars;

  const systemContext = await buildWorkspaceContext(contextOptions);
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: systemContext },
    ...session.messages.map(toProviderMessage),
  ];

  const streamOptions: StreamChatOptions = {};
  if (options.model !== undefined) streamOptions.model = options.model;
  if (options.temperature !== undefined) streamOptions.temperature = options.temperature;
  if (options.maxTokens !== undefined) streamOptions.maxTokens = options.maxTokens;
  const attribution: ChatMessageAttribution = { providerId: options.provider.id };
  if (options.model !== undefined) attribution.modelId = options.model;

  let assistantContent = '';
  try {
    for await (const delta of options.provider.streamChat(providerMessages, streamOptions)) {
      assistantContent += delta;
      onDelta?.(delta);
    }
  } catch (error) {
    if (assistantContent.trim()) {
      await appendMessage(options.workspaceRoot, options.chatId, 'assistant', assistantContent, undefined, attribution);
    }
    throw error;
  }

  if (!assistantContent.trim()) throw new Error('Model returned an empty response.');

  session = await appendMessage(
    options.workspaceRoot,
    options.chatId,
    'assistant',
    assistantContent,
    undefined,
    attribution,
  );
  const assistantMessage = session.messages.at(-1);
  if (!assistantMessage) throw new Error('Failed to persist the assistant message.');

  return {
    userMessage: savedUserMessage,
    assistantMessage,
    updatedSession: session,
  };
}

async function extractAttachments(workspaceRoot: string, attachmentPaths: string[]): Promise<ChatAttachment[]> {
  const normalizedPaths = attachmentPaths.map((attachmentPath) => attachmentPath.trim());
  if (normalizedPaths.some((attachmentPath) => !attachmentPath)) {
    throw new Error('Attachment paths cannot be empty.');
  }
  if (normalizedPaths.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`A chat message can include at most ${MAX_CHAT_ATTACHMENTS} attachments.`);
  }
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new Error('A file can only be attached once per message.');
  }

  const attachments: ChatAttachment[] = [];
  let remainingChars = MAX_ATTACHMENT_CONTEXT_CHARS;
  let sourceBytes = 0;

  for (const [index, attachmentPath] of normalizedPaths.entries()) {
    const remainingFiles = normalizedPaths.length - index;
    const maxChars = Math.max(1, Math.floor(remainingChars / remainingFiles));
    const document = await readDocument(attachmentPath, workspaceRoot, maxChars);
    sourceBytes += document.sourceBytes;
    if (sourceBytes > MAX_ATTACHMENT_SOURCE_BYTES) {
      throw new Error('Attachments exceed the 25 MB combined source-size limit.');
    }

    attachments.push({
      path: document.path,
      name: path.posix.basename(document.path),
      kind: document.kind,
      content: document.content,
      warnings: document.warnings,
      sourceBytes: document.sourceBytes,
      truncated: document.truncated,
    });
    remainingChars -= document.content.length;
  }

  return attachments;
}

function toProviderMessage(message: ChatMessage): ProviderMessage {
  if (message.role !== 'user' || !message.attachments?.length) {
    return { role: message.role, content: message.content };
  }

  const attachmentBlocks = message.attachments.map((attachment, index) => {
    const notes = [
      ...(attachment.truncated ? ['Content was truncated to fit the attachment context limit.'] : []),
      ...attachment.warnings,
    ];
    return [
      `<attachment index="${index + 1}" path="${escapeAttribute(attachment.path)}" kind="${attachment.kind}">`,
      attachment.content,
      ...(notes.length > 0 ? [`[Extraction notes: ${notes.join(' ')}]`] : []),
      '</attachment>',
    ].join('\n');
  });

  return {
    role: 'user',
    content: [
      message.content,
      '',
      'The following workspace files were attached specifically to this message:',
      '<attachments>',
      ...attachmentBlocks,
      '</attachments>',
    ].join('\n'),
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
