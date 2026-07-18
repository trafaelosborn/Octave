import {
  AnthropicProvider,
  OllamaProvider,
  OpenAIProvider,
  XAIProvider,
  type LLMProvider,
  type Message,
  type StreamChatOptions,
} from '@trafaelosborn/octave/providers';

export type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'xai' | 'demo';

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  available: boolean;
  local: boolean;
  models: Array<{ id: string; name?: string }>;
  setupHint?: string;
}

export function createProvider(providerId: string, model?: string): LLMProvider {
  if (providerId === 'demo') return new DemoProvider();
  if (providerId === 'anthropic') {
    return model ? new AnthropicProvider({ model }) : new AnthropicProvider();
  }
  if (providerId === 'ollama') {
    return model ? new OllamaProvider({ model }) : new OllamaProvider();
  }
  if (providerId === 'openai') return model ? new OpenAIProvider({ model }) : new OpenAIProvider();
  if (providerId === 'xai') return model ? new XAIProvider({ model }) : new XAIProvider();
  throw new Error('Provider must be ollama, anthropic, openai, xai, or demo.');
}

export async function listProviderStatus(): Promise<ProviderStatus[]> {
  const ollama = new OllamaProvider();
  const anthropic = new AnthropicProvider();
  const openai = new OpenAIProvider();
  const xai = new XAIProvider();
  const providers = [
    { provider: ollama, local: true },
    { provider: anthropic, local: false, setupHint: 'Set ANTHROPIC_API_KEY in .env.local.' },
    { provider: openai, local: false, setupHint: 'Set OPENAI_API_KEY in .env.local.' },
    { provider: xai, local: false, setupHint: 'Set XAI_API_KEY in .env.local.' },
  ];
  const statuses = await Promise.all(providers.map(async ({ provider, local, setupHint }) => {
    const available = await provider.isAvailable?.() ?? true;
    const status: ProviderStatus = {
      id: provider.id as ProviderId,
      name: provider.name,
      available,
      local,
      models: await provider.listModels?.() ?? [],
    };
    if (!available && setupHint) status.setupHint = setupHint;
    return status;
  }));
  return [
    ...statuses,
    { id: 'demo', name: 'Offline demo', available: true, local: true, models: [{ id: 'demo', name: 'Offline demo' }] },
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
