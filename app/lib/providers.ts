import {
  AnthropicProvider,
  OllamaProvider,
  type LLMProvider,
  type Message,
  type StreamChatOptions,
} from '@trafaelosborn/octave/providers';

export type ProviderId = 'ollama' | 'anthropic' | 'demo';

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  local: boolean;
}

export function createProvider(providerId: string, model?: string): LLMProvider {
  if (providerId === 'demo') return new DemoProvider();
  if (providerId === 'anthropic') {
    return model ? new AnthropicProvider({ model }) : new AnthropicProvider();
  }
  if (providerId === 'ollama') {
    return model ? new OllamaProvider({ model }) : new OllamaProvider();
  }
  throw new Error('Provider must be ollama, anthropic, or demo.');
}

export async function listProviderStatus(): Promise<ProviderStatus[]> {
  const ollama = new OllamaProvider();
  const anthropic = new AnthropicProvider();
  return [
    { id: 'ollama', name: ollama.name, available: await ollama.isAvailable(), local: true },
    { id: 'anthropic', name: anthropic.name, available: await anthropic.isAvailable(), local: false },
    { id: 'demo', name: 'Offline demo', available: true, local: true },
  ];
}

class DemoProvider implements LLMProvider {
  readonly id = 'demo';
  readonly name = 'Offline demo';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async *streamChat(messages: Message[], _options: StreamChatOptions = {}): AsyncIterable<string> {
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const question = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const documentMatch = system.match(/<document path="([^"]+)"/);
    const documentName = documentMatch?.[1] ?? 'the workspace';
    const hasContent = system.includes('<document ');
    const response = hasContent
      ? `Demo mode loaded **${documentName}** into bounded workspace context. Your question was: “${question}”\n\nConnect Ollama or Anthropic for substantive research analysis.`
      : `Demo mode received your question: “${question}”\n\nOpen a document or pin context files, then connect Ollama or Anthropic for substantive analysis.`;

    for (const chunk of response.match(/.{1,28}/g) ?? [response]) {
      yield chunk;
    }
  }
}
