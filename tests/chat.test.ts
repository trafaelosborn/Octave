import { describe, expect, it } from 'vitest';
import { createNewChatSession, generateChatTitle, isChatSession } from '../src/core/chat.js';

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
});
