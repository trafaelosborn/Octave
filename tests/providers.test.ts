import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { CliProvider, parseShellWords } from '../src/providers/cli.js';
import { OllamaProvider } from '../src/providers/ollama.js';
import { OpenAIProvider, XAIProvider } from '../src/providers/openai-compatible.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider streaming', () => {
  it('parses Ollama newline-delimited chunks including a final unterminated line', async () => {
    const body = streamFrom([
      '{"message":{"content":"local "}}\n',
      '{"message":{"content":"answer"},"done":true}',
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const provider = new OllamaProvider({ baseUrl: 'http://ollama.test', model: 'test' });
    const chunks: string[] = [];
    for await (const chunk of provider.streamChat([{ role: 'user', content: 'Hello' }])) chunks.push(chunk);

    expect(chunks.join('')).toBe('local answer');
  });

  it('parses Anthropic server-sent text deltas', async () => {
    const body = streamFrom([
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}\n\n',
    ]);
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AnthropicProvider({ apiKey: 'test', baseUrl: 'https://anthropic.test' });
    const chunks: string[] = [];
    for await (const chunk of provider.streamChat([
      { role: 'system', content: 'Be precise.' },
      { role: 'user', content: 'Hello' },
    ])) chunks.push(chunk);

    expect(chunks).toEqual(['Claude']);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) throw new Error('Expected Anthropic request options.');
    expect(JSON.parse(String(request.body))).toMatchObject({
      system: 'Be precise.',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it.each([
    ['OpenAI', new OpenAIProvider({ apiKey: 'test', baseUrl: 'https://openai.test', model: 'test' })],
    ['xAI', new XAIProvider({ apiKey: 'test', baseUrl: 'https://xai.test', model: 'test' })],
  ])('parses %s chat-completion streaming deltas', async (_name, provider) => {
    const body = streamFrom([
      'data: {"choices":[{"delta":{"content":"research "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const chunks: string[] = [];
    for await (const chunk of provider.streamChat([{ role: 'user', content: 'Hello' }])) chunks.push(chunk);
    expect(chunks.join('')).toBe('research answer');
  });

  it('streams responses from a command-line provider through stdin', async () => {
    const provider = new CliProvider({
      command: process.execPath,
      args: ['-e', 'process.stdin.on("data", data => process.stdout.write("cli:" + data.toString().includes("Hello")))'],
    });
    const chunks: string[] = [];
    for await (const chunk of provider.streamChat([{ role: 'user', content: 'Hello' }])) chunks.push(chunk);
    expect(chunks.join('')).toBe('cli:true');
  });

  it('supports shell-like CLI argument parsing', () => {
    expect(parseShellWords('exec --model "gpt test" --flag\\ value')).toEqual(['exec', '--model', 'gpt test', '--flag value']);
  });
});

function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}
