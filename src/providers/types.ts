export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly name: string;

  streamChat(messages: Message[], options?: StreamChatOptions): AsyncIterable<string>;
  isAvailable?(): Promise<boolean>;
  listModels?(): Promise<ModelInfo[]>;
}
