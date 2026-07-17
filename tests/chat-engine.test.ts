import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendChatMessage } from '../src/core/chat-engine.js';
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
    const chat = await createChat(workspaceRoot);
    const provider = new RecordingProvider();
    const deltas: string[] = [];

    const result = await sendChatMessage({
      workspaceRoot,
      chatId: chat.id,
      userMessage: 'What does the result say?',
      provider,
      currentDocumentPath: 'paper.tex',
    }, (delta) => deltas.push(delta));

    expect(deltas.join('')).toBe('First response');
    expect(result.assistantMessage.content).toBe('First response');
    expect(result.updatedSession.messages).toHaveLength(2);
    expect(provider.messages[0]?.content).toContain('The invariant is monotone.');
    expect(provider.messages.at(-1)).toEqual({ role: 'user', content: 'What does the result say?' });
    expect((await loadChat(workspaceRoot, chat.id))?.lastDocumentPath).toBe('paper.tex');
  });

  it('refuses to send against an unknown chat', async () => {
    await expect(sendChatMessage({
      workspaceRoot,
      chatId: 'missing-chat',
      userMessage: 'Hello',
      provider: new RecordingProvider(),
    })).rejects.toThrow('not found');
  });
});
