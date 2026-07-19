import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  sendChatMessage,
} from '../src/core/chat-engine.js';
import { MAX_ATTACHMENT_CONTEXT_CHARS, MAX_CHAT_ATTACHMENTS } from '../src/core/chat.js';
import type { LLMProvider, Message } from '../src/providers/types.js';
import { createChat, loadChat } from '../src/storage/chat-storage.js';

class RecordingProvider implements LLMProvider {
  readonly id = 'recording';
  readonly name = 'Recording provider';
  messages: Message[] = [];

  async *streamChat(messages: Message[]): AsyncIterable<string> {
    this.messages = messages;
    yield 'First ';
    yield 'response';
  }
}

describe('chat engine', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-engine-'));
    await fs.writeFile(path.join(workspaceRoot, 'paper.tex'), '\\section{Result}\nThe invariant is monotone.', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('streams document-aware chat and persists both messages', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'document', documentPath: 'paper.tex' });
    const provider = new RecordingProvider();
    const deltas: string[] = [];

    const result = await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'What does the result say?',
      provider,
      currentDocumentPath: 'paper.tex',
      model: 'recording-model',
    }, (delta) => deltas.push(delta));

    expect(deltas.join('')).toBe('First response');
    expect(result.assistantMessage.content).toBe('First response');
    expect(result.assistantMessage).toMatchObject({ providerId: 'recording', modelId: 'recording-model' });
    expect(result.updatedSession.messages).toHaveLength(2);
    expect(provider.messages[0]?.content).toContain('The invariant is monotone.');
    expect(provider.messages.at(-1)).toEqual({ role: 'user', content: 'What does the result say?' });
    expect((await loadChat(workspaceRoot, chat.id))?.lastDocumentPath).toBe('paper.tex');
  });

  it('adds citation evidence guardrails only when a review requests them', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'document', documentPath: 'paper.tex' });
    const provider = new RecordingProvider();

    await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Verify the citations.',
      provider,
      includeCitationEvidence: true,
    });

    expect(provider.messages[0]?.content).toContain('<citation-evidence status="unavailable">');
    expect(provider.messages[0]?.content).toContain('Do not describe any citation as verified');
  });

  it('keeps workspace chats independent of the open document', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'workspace' });
    const provider = new RecordingProvider();

    await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Discuss the project.',
      provider,
      currentDocumentPath: 'paper.tex',
    });

    expect(provider.messages[0]?.content).toContain('No document content is attached');
    expect((await loadChat(workspaceRoot, chat.id))?.lastDocumentPath).toBeUndefined();
  });

  it('prevents document chats from changing their bound document', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'document', documentPath: 'paper.tex' });
    await expect(sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Switch documents.',
      provider: new RecordingProvider(),
      currentDocumentPath: 'other.tex',
    })).rejects.toThrow('cannot switch');
  });

  it('refuses to send against an unknown chat', async () => {
    await expect(sendChatMessage({
      workspaceRoot,
      chatId: 'missing-chat',
      userMessage: 'Hello',
      provider: new RecordingProvider(),
    })).rejects.toThrow('not found');
  });

  it('snapshots attached files onto their message and replays the snapshot on later turns', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'notes.md'), 'Original attached evidence.', 'utf8');
    const chat = await createChat(workspaceRoot, { scope: 'workspace' });
    const provider = new RecordingProvider();

    const first = await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Use these notes.',
      provider,
      attachmentPaths: ['notes.md'],
    });

    expect(first.userMessage.attachments).toMatchObject([{
      path: 'notes.md',
      name: 'notes.md',
      kind: 'text',
      content: 'Original attached evidence.',
    }]);
    expect(provider.messages.at(-1)?.content).toContain('<attachment index="1" path="notes.md" kind="text">');
    expect(provider.messages.at(-1)?.content).toContain('Original attached evidence.');

    await fs.writeFile(path.join(workspaceRoot, 'notes.md'), 'Changed after the first turn.', 'utf8');
    await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'What did the earlier evidence say?',
      provider,
    });

    expect(provider.messages[1]?.content).toContain('Original attached evidence.');
    expect(provider.messages[1]?.content).not.toContain('Changed after the first turn.');
    expect((await loadChat(workspaceRoot, chat.id))?.messages[0]?.attachments?.[0]?.content)
      .toBe('Original attached evidence.');
  });

  it('enforces attachment count and workspace boundaries before persisting the user message', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'workspace' });
    const base = {
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Inspect these.',
      provider: new RecordingProvider(),
    };

    await expect(sendChatMessage({
      ...base,
      attachmentPaths: Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, index) => `file-${index}.md`),
    })).rejects.toThrow(`at most ${MAX_CHAT_ATTACHMENTS}`);
    await expect(sendChatMessage({ ...base, attachmentPaths: ['../outside.md'] }))
      .rejects.toThrow('escapes the workspace');
    expect((await loadChat(workspaceRoot, chat.id))?.messages).toEqual([]);
  });

  it('bounds stored attachment text to the combined context limit', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'long.md'),
      'x'.repeat(MAX_ATTACHMENT_CONTEXT_CHARS + 500),
      'utf8',
    );
    const chat = await createChat(workspaceRoot, { scope: 'workspace' });

    const result = await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'Read the long attachment.',
      provider: new RecordingProvider(),
      attachmentPaths: ['long.md'],
    });

    expect(result.userMessage.attachments?.[0]?.content).toHaveLength(MAX_ATTACHMENT_CONTEXT_CHARS);
    expect(result.userMessage.attachments?.[0]?.truncated).toBe(true);
  });
});
