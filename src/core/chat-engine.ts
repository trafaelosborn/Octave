import type { ChatMessage, ChatSession } from './chat.js';
import { buildWorkspaceContext } from './context.js';
import type { LLMProvider, Message as ProviderMessage, StreamChatOptions } from '../providers/types.js';
import { appendMessage, loadChat, saveChat } from '../storage/chat-storage.js';

export interface SendMessageOptions {
  workspaceRoot: string;
  chatId: string;
  userMessage: string;
  provider: LLMProvider;
  currentDocumentPath?: string;
  pinnedFiles?: string[];
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

  let session = await appendMessage(options.workspaceRoot, options.chatId, 'user', userContent);
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
    ...session.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const streamOptions: StreamChatOptions = {};
  if (options.model !== undefined) streamOptions.model = options.model;
  if (options.temperature !== undefined) streamOptions.temperature = options.temperature;
  if (options.maxTokens !== undefined) streamOptions.maxTokens = options.maxTokens;

  let assistantContent = '';
  try {
    for await (const delta of options.provider.streamChat(providerMessages, streamOptions)) {
      assistantContent += delta;
      onDelta?.(delta);
    }
  } catch (error) {
    if (assistantContent.trim()) {
      await appendMessage(options.workspaceRoot, options.chatId, 'assistant', assistantContent);
    }
    throw error;
  }

  if (!assistantContent.trim()) throw new Error('Model returned an empty response.');

  session = await appendMessage(options.workspaceRoot, options.chatId, 'assistant', assistantContent);
  const assistantMessage = session.messages.at(-1);
  if (!assistantMessage) throw new Error('Failed to persist the assistant message.');

  return {
    userMessage: savedUserMessage,
    assistantMessage,
    updatedSession: session,
  };
}
