import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendMessage,
  createChat,
  deleteChat,
  listChats,
  loadChat,
  renameChat,
} from '../src/storage/chat-storage.js';

describe('workspace chat storage', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-storage-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('creates, updates, lists, and deletes a chat', async () => {
    const chat = await createChat(workspaceRoot);
    const updated = await appendMessage(workspaceRoot, chat.id, 'user', 'Check the proof');

    expect(updated.title).toBe('Check the proof');
    expect((await loadChat(workspaceRoot, chat.id))?.messages).toHaveLength(1);
    expect(await listChats(workspaceRoot)).toMatchObject([{ id: chat.id, title: 'Check the proof' }]);
    expect(await deleteChat(workspaceRoot, chat.id)).toBe(true);
    expect(await deleteChat(workspaceRoot, chat.id)).toBe(false);
  });

  it('renames chats with normalized bounded titles', async () => {
    const chat = await createChat(workspaceRoot);
    const renamed = await renameChat(workspaceRoot, chat.id, `  ${'important '.repeat(12)}  `);

    expect(renamed.title).toHaveLength(70);
    expect(renamed.title.endsWith('...')).toBe(true);
    expect(await listChats(workspaceRoot)).toMatchObject([{ id: chat.id, title: renamed.title }]);
    await expect(renameChat(workspaceRoot, chat.id, '   ')).rejects.toThrow('Chat title');
  });

  it('rejects path-like chat IDs', async () => {
    await expect(loadChat(workspaceRoot, '../outside')).rejects.toThrow('Invalid chat ID');
    await expect(loadChat(workspaceRoot, 'folder/chat')).rejects.toThrow('Invalid chat ID');
  });

  it('persists chat scope and its bound document in history metadata', async () => {
    const chat = await createChat(workspaceRoot, { scope: 'document', documentPath: 'proof.tex' });
    expect(await loadChat(workspaceRoot, chat.id)).toMatchObject({ scope: 'document', documentPath: 'proof.tex' });
    expect(await listChats(workspaceRoot)).toMatchObject([{ scope: 'document', documentPath: 'proof.tex' }]);
  });

  it('atomically persists attachment snapshots on user messages', async () => {
    const chat = await createChat(workspaceRoot);
    const attachments = [{
      path: 'evidence.md',
      name: 'evidence.md',
      kind: 'text' as const,
      content: 'Durable evidence snapshot.',
      warnings: [],
      sourceBytes: 26,
      truncated: false,
    }];

    await appendMessage(workspaceRoot, chat.id, 'user', 'Use this evidence.', attachments);

    expect((await loadChat(workspaceRoot, chat.id))?.messages[0]?.attachments).toEqual(attachments);
    await expect(appendMessage(workspaceRoot, chat.id, 'assistant', 'No attachment.', attachments))
      .rejects.toThrow('Assistant messages');
  });

  it('persists provider attribution on assistant responses', async () => {
    const chat = await createChat(workspaceRoot);
    const updated = await appendMessage(
      workspaceRoot,
      chat.id,
      'assistant',
      'A saved review candidate.',
      undefined,
      { providerId: 'xai', modelId: 'grok-test' },
    );

    expect(updated.messages[0]).toMatchObject({ providerId: 'xai', modelId: 'grok-test' });
    await expect(appendMessage(
      workspaceRoot,
      chat.id,
      'user',
      'No attribution.',
      undefined,
      { providerId: 'xai' },
    )).rejects.toThrow('Only assistant');
  });
});
