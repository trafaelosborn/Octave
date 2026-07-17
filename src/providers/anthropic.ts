import type { LLMProvider, Message, ModelInfo, StreamChatOptions } from './types.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface AnthropicEvent {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Claude (Anthropic)';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.defaultModel = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.defaultModel, name: 'Configured Claude model' }];
  }

  async *streamChat(
    messages: Message[],
    options: StreamChatOptions = {},
  ): AsyncIterable<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const conversation = messages
      .filter((message): message is Message & { role: 'user' | 'assistant' } => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    if (conversation.length === 0) {
      throw new Error('Anthropic chat requires at least one user or assistant message.');
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 8_192,
        temperature: options.temperature ?? 0.7,
        system,
        messages: conversation,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => '')).slice(0, 1_000);
      throw new Error(`Anthropic error: ${response.status}${detail ? ` ${detail}` : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const text = parseEventLine(line);
          if (text) yield text;
        }
      }

      buffer += decoder.decode();
      const finalText = parseEventLine(buffer);
      if (finalText) yield finalText;
    } finally {
      reader.releaseLock();
    }
  }
}

function parseEventLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;

  const data = trimmed.slice('data:'.length).trim();
  if (!data || data === '[DONE]') return null;

  try {
    const event = JSON.parse(data) as AnthropicEvent;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text ?? null;
    }
  } catch {
    return null;
  }

  return null;
}
