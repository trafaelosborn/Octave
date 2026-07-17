import type { LLMProvider, Message, ModelInfo, StreamChatOptions } from './types.js';

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
}

interface OllamaChunk {
  done?: boolean;
  message?: {
    content?: string;
  };
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';

  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.defaultModel = options.model ?? process.env.OLLAMA_MODEL ?? 'llama3.1';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return (data.models ?? []).map(({ name }) => ({ id: name, name }));
    } catch {
      return [];
    }
  }

  async *streamChat(
    messages: Message[],
    options: StreamChatOptions = {},
  ): AsyncIterable<string> {
    const requestOptions: Record<string, number> = {
      temperature: options.temperature ?? 0.7,
    };
    if (options.maxTokens !== undefined) requestOptions.num_predict = options.maxTokens;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages,
        stream: true,
        options: requestOptions,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => '')).slice(0, 1_000);
      throw new Error(`Ollama error: ${response.status}${detail ? ` ${detail}` : ''}`);
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
          const chunk = parseChunk(line);
          if (chunk?.message?.content) yield chunk.message.content;
          if (chunk?.done) return;
        }
      }

      buffer += decoder.decode();
      const finalChunk = parseChunk(buffer);
      if (finalChunk?.message?.content) yield finalChunk.message.content;
    } finally {
      reader.releaseLock();
    }
  }
}

function parseChunk(line: string): OllamaChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as OllamaChunk;
  } catch {
    return null;
  }
}
