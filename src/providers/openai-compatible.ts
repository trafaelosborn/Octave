import type { LLMProvider, Message, ModelInfo, StreamChatOptions } from './types.js';

export interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  id?: string;
  name?: string;
  apiKeyEnvironmentVariable?: string;
  modelsPath?: string;
  modelFilter?: (id: string) => boolean;
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly apiKeyEnvironmentVariable: string;
  private readonly modelsPath: string;
  private readonly modelFilter: (id: string) => boolean;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.id = options.id ?? 'openai';
    this.name = options.name ?? 'OpenAI';
    this.apiKeyEnvironmentVariable = options.apiKeyEnvironmentVariable ?? 'OPENAI_API_KEY';
    this.apiKey = options.apiKey ?? process.env[this.apiKeyEnvironmentVariable] ?? '';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.defaultModel = options.model ?? 'gpt-5.6-sol';
    this.modelsPath = options.modelsPath ?? '/v1/models';
    this.modelFilter = options.modelFilter ?? (() => true);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return [{ id: this.defaultModel, name: this.defaultModel }];
    try {
      const response = await fetch(`${this.baseUrl}${this.modelsPath}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return [{ id: this.defaultModel, name: this.defaultModel }];
      const data = await response.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).filter(({ id }) => this.modelFilter(id)).map(({ id }) => ({ id, name: id }));
      if (!models.some(({ id }) => id === this.defaultModel)) models.unshift({ id: this.defaultModel, name: this.defaultModel });
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [{ id: this.defaultModel, name: this.defaultModel }];
    }
  }

  async *streamChat(messages: Message[], options: StreamChatOptions = {}): AsyncIterable<string> {
    if (!this.apiKey) throw new Error(`${this.apiKeyEnvironmentVariable} is not set.`);

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages,
      stream: true,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_completion_tokens = options.maxTokens;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => '')).slice(0, 1_000);
      throw new Error(`${this.name} error: ${response.status}${detail ? ` ${detail}` : ''}`);
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
          const chunk = parseEventLine(line);
          if (chunk) yield chunk;
        }
      }
      buffer += decoder.decode();
      const finalChunk = parseEventLine(buffer);
      if (finalChunk) yield finalChunk;
    } finally {
      reader.releaseLock();
    }
  }
}

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(options: Omit<OpenAICompatibleProviderOptions, 'id' | 'name' | 'apiKeyEnvironmentVariable'> = {}) {
    super({
      id: 'openai',
      name: 'OpenAI',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
      model: process.env.OPENAI_MODEL ?? 'gpt-5.6-sol',
      modelFilter: (id) => /^(gpt-|o[1-9]|chatgpt)/i.test(id),
      ...options,
    });
  }
}

export class XAIProvider extends OpenAICompatibleProvider {
  constructor(options: Omit<OpenAICompatibleProviderOptions, 'id' | 'name' | 'apiKeyEnvironmentVariable'> = {}) {
    super({
      id: 'xai',
      name: 'Grok (xAI)',
      apiKeyEnvironmentVariable: 'XAI_API_KEY',
      baseUrl: process.env.XAI_BASE_URL ?? 'https://api.x.ai',
      model: process.env.XAI_MODEL ?? 'grok-4.5-latest',
      modelsPath: '/v1/language-models',
      modelFilter: (id) => /^grok-(?!imagine)/i.test(id),
      ...options,
    });
  }
}

function parseEventLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try {
    const chunk = JSON.parse(data) as ChatCompletionChunk;
    return chunk.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}
