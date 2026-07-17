import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createChat,
  sendChatMessage,
  type LLMProvider,
  type Message,
} from '../src/index.js';

class OfflineDemoProvider implements LLMProvider {
  readonly id = 'offline-demo';
  readonly name = 'Offline demo provider';

  async *streamChat(messages: Message[]): AsyncIterable<string> {
    const context = messages.find((message) => message.role === 'system')?.content ?? '';
    const foundClaim = context.includes('Every compact metric space is complete');
    yield foundClaim ? 'I found the claim in the attached note. ' : 'I could not find the claim. ';
    yield 'A production provider would now analyze it in detail.';
  }
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-demo-'));

try {
  await fs.writeFile(
    path.join(workspaceRoot, 'note.md'),
    '# Topology note\n\nEvery compact metric space is complete.\n',
    'utf8',
  );

  const chat = await createChat(workspaceRoot, 'Compactness');
  const result = await sendChatMessage({
    workspaceRoot,
    chatId: chat.id,
    userMessage: 'What claim does this note make?',
    provider: new OfflineDemoProvider(),
    currentDocumentPath: 'note.md',
  });

  console.log(result.assistantMessage.content);
  console.log(`Stored ${result.updatedSession.messages.length} messages in workspace-local chat history.`);
} finally {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
