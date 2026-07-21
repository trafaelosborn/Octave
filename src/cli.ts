#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDocument } from './core/compile.js';
import { sendChatMessage } from './core/chat-engine.js';
import { listProjectFiles } from './core/path.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CliProvider } from './providers/cli.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAIProvider, XAIProvider } from './providers/openai-compatible.js';
import type { LLMProvider } from './providers/types.js';
import { createChat, loadChat } from './storage/chat-storage.js';

interface ParsedArguments {
  positionals: string[];
  options: Map<string, string[]>;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArguments(argv);
  const command = parsed.positionals[0];

  if (!command || command === 'help' || hasOption(parsed, 'help')) {
    printHelp();
    return 0;
  }

  if (command === 'files') return runFiles(parsed);
  if (command === 'compile') return runCompile(parsed);
  if (command === 'chat') return runChat(parsed);

  throw new Error(`Unknown command: ${command}`);
}

async function runFiles(parsed: ParsedArguments): Promise<number> {
  const workspaceRoot = path.resolve(parsed.positionals[1] ?? getOption(parsed, 'workspace') ?? '.');
  const files = await listProjectFiles(workspaceRoot);

  if (files.length === 0) {
    console.log('No supported research documents found.');
    return 0;
  }

  for (const file of files) {
    console.log(`${file.path}\t${formatBytes(file.size)}`);
  }
  return 0;
}

async function runCompile(parsed: ParsedArguments): Promise<number> {
  const documentPath = parsed.positionals[1];
  if (!documentPath) throw new Error('Usage: octave compile <document> [--workspace <path>]');

  const workspaceRoot = path.resolve(getOption(parsed, 'workspace') ?? '.');
  const engineValue = getOption(parsed, 'engine') ?? 'pdflatex';
  if (!['pdflatex', 'lualatex', 'tectonic'].includes(engineValue)) {
    throw new Error('Engine must be pdflatex, lualatex, or tectonic.');
  }

  const result = await compileDocument(documentPath, workspaceRoot, {
    engine: engineValue as 'pdflatex' | 'lualatex' | 'tectonic',
  });
  console.log(result.log);
  console.log(result.pdfAvailable ? `\nPDF: ${result.pdfPath}` : '\nNo PDF was produced.');
  return result.ok ? 0 : 1;
}

async function runChat(parsed: ParsedArguments): Promise<number> {
  const message = parsed.positionals[1];
  if (!message) throw new Error('Usage: octave chat <message> [--workspace <path>] [--document <path>]');

  const workspaceRoot = path.resolve(getOption(parsed, 'workspace') ?? '.');
  const providerName = getOption(parsed, 'provider') ?? 'ollama';
  const provider = createProvider(providerName, getOption(parsed, 'model'));
  const requestedChatId = getOption(parsed, 'chat');
  const session = requestedChatId
    ? await loadChat(workspaceRoot, requestedChatId)
    : await createChat(workspaceRoot);

  if (!session) throw new Error(`Chat session not found: ${requestedChatId}`);

  const options: Parameters<typeof sendChatMessage>[0] = {
    workspaceRoot,
    chatId: session.id,
    userMessage: message,
    provider,
  };

  const documentPath = getOption(parsed, 'document');
  const model = getOption(parsed, 'model');
  const pinnedFiles = parsed.options.get('pin');
  if (documentPath !== undefined) options.currentDocumentPath = documentPath;
  if (model !== undefined) options.model = model;
  if (pinnedFiles !== undefined) options.pinnedFiles = pinnedFiles;

  console.error(`Chat: ${session.id}`);
  await sendChatMessage(options, (delta) => process.stdout.write(delta));
  process.stdout.write('\n');
  return 0;
}

function createProvider(name: string, model?: string): LLMProvider {
  if (name === 'ollama') {
    return model === undefined ? new OllamaProvider() : new OllamaProvider({ model });
  }
  if (name === 'anthropic') {
    return model === undefined ? new AnthropicProvider() : new AnthropicProvider({ model });
  }
  if (name === 'openai') {
    return model === undefined ? new OpenAIProvider() : new OpenAIProvider({ model });
  }
  if (name === 'xai') {
    return model === undefined ? new XAIProvider() : new XAIProvider({ model });
  }
  if (name === 'cli') {
    return model === undefined ? new CliProvider() : new CliProvider({ model });
  }
  throw new Error('Provider must be ollama, cli, anthropic, openai, or xai.');
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = { positionals: [], options: new Map() };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    if (!argument.startsWith('--')) {
      parsed.positionals.push(argument);
      continue;
    }

    const equalsIndex = argument.indexOf('=');
    const key = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    let value = 'true';

    if (equalsIndex !== -1) {
      value = argument.slice(equalsIndex + 1);
    } else if (argv[index + 1] !== undefined && !argv[index + 1]?.startsWith('--')) {
      value = argv[index + 1] ?? '';
      index += 1;
    }

    const existing = parsed.options.get(key) ?? [];
    existing.push(value);
    parsed.options.set(key, existing);
  }

  return parsed;
}

function getOption(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.options.get(name)?.at(-1);
}

function hasOption(parsed: ParsedArguments, name: string): boolean {
  return parsed.options.has(name);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function printHelp(): void {
  console.log(`Octave - local-first research document tools

Usage:
  octave files [workspace]
  octave compile <document> [--workspace <path>] [--engine pdflatex|lualatex|tectonic]
  octave chat <message> [--workspace <path>] [--document <path>]
                     [--pin <path>] [--provider ollama|cli|anthropic|openai|xai]
                     [--model <name>] [--chat <id>]

Examples:
  octave files ./paper
  octave compile main.tex --workspace ./paper
  octave chat "Review the main claim" --workspace ./paper --document main.tex
`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Octave: ${message}`);
    process.exitCode = 1;
  });
}
