import { describe, expect, it } from 'vitest';
import {
  createNewChatSession,
  generateChatTitle,
  isChatSession,
  MAX_CHAT_ATTACHMENTS,
} from '../src/core/chat.js';

describe('chat model', () => {
  it('creates a valid empty session', () => {
    const session = createNewChatSession();
    expect(session.title).toBe('New chat');
    expect(session.messages).toEqual([]);
    expect(session.scope).toBe('workspace');
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isChatSession(session)).toBe(true);
  });

  it('requires a path for document-scoped sessions', () => {
    expect(() => createNewChatSession('Proof chat', 'document')).toThrow('document path');
    expect(createNewChatSession('Proof chat', 'document', 'paper.tex')).toMatchObject({
      scope: 'document',
      documentPath: 'paper.tex',
    });
  });

  it('creates a compact title from the first message', () => {
    const title = generateChatTitle(`  ${'research '.repeat(12)}  `);
    expect(title).toHaveLength(70);
    expect(title.endsWith('...')).toBe(true);
  });

  it('rejects malformed persisted sessions', () => {
    expect(isChatSession({ id: 'chat', messages: 'not-an-array' })).toBe(false);
  });

  it('accepts persisted user attachments and rejects them on assistant messages', () => {
    const session = createNewChatSession();
    const attachment = {
      path: 'notes.md',
      name: 'notes.md',
      kind: 'text' as const,
      content: 'Snapshot',
      warnings: [],
      sourceBytes: 8,
      truncated: false,
    };
    session.messages.push({
      ts: new Date().toISOString(),
      role: 'user',
      content: 'Read this.',
      attachments: [attachment],
    });
    expect(isChatSession(session)).toBe(true);

    session.messages[0] = {
      ts: new Date().toISOString(),
      role: 'assistant',
      content: 'No.',
      attachments: [attachment],
    };
    expect(isChatSession(session)).toBe(false);

    session.messages[0] = {
      ts: new Date().toISOString(),
      role: 'user',
      content: 'Too many.',
      attachments: Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, () => attachment),
    };
    expect(isChatSession(session)).toBe(false);
  });

  it('accepts provider attribution only on assistant messages', () => {
    const session = createNewChatSession();
    session.messages.push({
      ts: new Date().toISOString(),
      role: 'assistant',
      content: 'Review complete.',
      providerId: 'openai',
      modelId: 'gpt-test',
    });
    expect(isChatSession(session)).toBe(true);

    session.messages[0] = {
      ts: new Date().toISOString(),
      role: 'user',
      content: 'Invalid attribution.',
      providerId: 'openai',
    };
    expect(isChatSession(session)).toBe(false);
  });
});
