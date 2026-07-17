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

  it('rejects path-like chat IDs', async () => {
    await expect(loadChat(workspaceRoot, '../outside')).rejects.toThrow('Invalid chat ID');
    await expect(loadChat(workspaceRoot, 'folder/chat')).rejects.toThrow('Invalid chat ID');
  });
});
