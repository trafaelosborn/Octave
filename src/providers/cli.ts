import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LLMProvider, Message, ModelInfo, StreamChatOptions } from './types.js';

export interface CliProviderOptions {
  command?: string;
  args?: string[];
  model?: string;
  name?: string;
}

export class CliProvider implements LLMProvider {
  readonly id = 'cli';
  readonly name: string;

  private readonly command: string;
  private readonly args: string[];
  private readonly defaultModel: string;

  constructor(options: CliProviderOptions = {}) {
    this.name = options.name ?? 'Command-line AI';
    this.command = options.command ?? process.env.OCTAVE_CLI_COMMAND ?? '';
    this.args = options.args ?? parseShellWords(process.env.OCTAVE_CLI_ARGS ?? '');
    this.defaultModel = options.model ?? process.env.OCTAVE_CLI_MODEL ?? 'gpt-5.6-sol';
  }

  async isAvailable(): Promise<boolean> {
    if (!this.command.trim()) return false;
    return commandExists(this.command);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.defaultModel, name: this.defaultModel }];
  }

  async *streamChat(messages: Message[], options: StreamChatOptions = {}): AsyncIterable<string> {
    if (!this.command.trim()) throw new Error('OCTAVE_CLI_COMMAND is not set.');
    if (!(await commandExists(this.command))) throw new Error(`CLI provider command was not found: ${this.command}`);

    const model = options.model ?? this.defaultModel;
    const prompt = formatMessages(messages, model);
    const args = this.args.map((argument) => argument.replaceAll('{prompt}', prompt).replaceAll('{model}', model));
    const sendsPromptOnArgv = this.args.some((argument) => argument.includes('{prompt}'));
    const child = spawn(this.command, args, {
      cwd: process.cwd(),
      env: { ...process.env, OCTAVE_MODEL: model },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });

    if (sendsPromptOnArgv) {
      child.stdin.end();
    } else {
      child.stdin.end(prompt);
    }

    const exitCode = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    child.stdout.setEncoding('utf8');
    for await (const chunk of child.stdout) {
      if (typeof chunk === 'string' && chunk) yield chunk;
    }

    const code = await exitCode;
    if (code !== 0) {
      const detail = stderr.trim().slice(0, 1_000);
      throw new Error(`CLI provider exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`);
    }
  }
}

export function parseShellWords(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === char ? null : char;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += '\\';
  if (quote !== null) throw new Error('CLI arguments contain an unterminated quote.');
  if (current) words.push(current);
  return words;
}

function formatMessages(messages: Message[], model: string): string {
  return [
    `You are the language model backend for Octave, a local-first research workstation.`,
    `Requested model: ${model}`,
    `Return only the assistant response for the final user request.`,
    '',
    ...messages.map((message) => `<${message.role}>\n${message.content}\n</${message.role}>`),
  ].join('\n');
}

async function commandExists(command: string): Promise<boolean> {
  if (path.isAbsolute(command) || command.includes(path.sep) || (path.sep === '\\' && command.includes('/'))) {
    return fileExists(command);
  }

  const pathVariable = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  const directories = pathVariable.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command.endsWith(extension.toLowerCase()) || command.endsWith(extension)
        ? command
        : `${command}${extension}`);
      if (await fileExists(candidate)) return true;
    }
  }

  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return false;
    return os.platform() === 'win32' || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
