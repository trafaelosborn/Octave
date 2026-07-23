import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { INSTALL_COMMANDS, augmentPathEnvironment, buildPathWithDirectory, checkCliProvider, installCommandFor, parseShellWords, resolveExecutable } = require('../desktop/app/cli-provider-setup.cjs') as {
  INSTALL_COMMANDS: Record<string, Record<string, string>>;
  augmentPathEnvironment: (environment?: Record<string, string | undefined>) => Record<string, string>;
  buildPathWithDirectory: (entries: string[], directory: string) => string;
  checkCliProvider: (command: string, environment?: Record<string, string | undefined>) => Promise<{
    installed: boolean;
    path: string | null;
    onPath: boolean;
    needsPathRepair: boolean;
    pathDirectory: string | null;
  }>;
  installCommandFor: (preset: string, platform?: string) => string;
  parseShellWords: (input: string) => string[];
  resolveExecutable: (command: string, environment?: Record<string, string | undefined>) => Promise<string | null>;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('desktop CLI provider setup', () => {
  it('resolves commands from PATH', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-cli-provider-'));
    temporaryDirectories.push(directory);
    const executableName = process.platform === 'win32' ? 'octave-test-cli.CMD' : 'octave-test-cli';
    const executablePath = path.join(directory, executableName);
    await fs.writeFile(executablePath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf8');
    if (process.platform !== 'win32') await fs.chmod(executablePath, 0o755);

    const resolved = await resolveExecutable('octave-test-cli', {
      PATH: directory,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });

    expect(resolved?.toLowerCase()).toBe(executablePath.toLowerCase());
  });

  it('auto-discovers user-local CLI install directories', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-cli-home-'));
    temporaryDirectories.push(home);
    const binDirectory = path.join(home, '.local', 'bin');
    await fs.mkdir(binDirectory, { recursive: true });
    const executablePath = path.join(binDirectory, process.platform === 'win32' ? 'claude.EXE' : 'claude');
    await fs.writeFile(executablePath, process.platform === 'win32' ? 'placeholder' : '#!/bin/sh\n', 'utf8');
    if (process.platform !== 'win32') await fs.chmod(executablePath, 0o755);

    const environment = { PATH: '', USERPROFILE: home, HOME: home, PATHEXT: '.EXE;.CMD;.BAT;.COM' };
    expect(augmentPathEnvironment(environment).PATH).toContain(path.join(home, '.local', 'bin'));
    expect(await resolveExecutable('claude', environment)).toBe(executablePath);
  });

  it('auto-discovers npm global CLIs and Codex bundled with the VS Code extension', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-cli-vscode-'));
    const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-cli-appdata-'));
    temporaryDirectories.push(home, appData);

    const npmDirectory = path.join(appData, 'npm');
    await fs.mkdir(npmDirectory, { recursive: true });
    const geminiPath = path.join(npmDirectory, process.platform === 'win32' ? 'gemini.CMD' : 'gemini');
    await fs.writeFile(geminiPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf8');
    if (process.platform !== 'win32') await fs.chmod(geminiPath, 0o755);

    const codexDirectory = path.join(home, '.vscode', 'extensions', 'openai.chatgpt-test-win32-x64', 'bin', process.platform === 'win32' ? 'windows-x86_64' : process.platform);
    await fs.mkdir(codexDirectory, { recursive: true });
    const codexPath = path.join(codexDirectory, process.platform === 'win32' ? 'codex.EXE' : 'codex');
    await fs.writeFile(codexPath, process.platform === 'win32' ? 'placeholder' : '#!/bin/sh\n', 'utf8');
    if (process.platform !== 'win32') await fs.chmod(codexPath, 0o755);

    const environment = { PATH: '', USERPROFILE: home, HOME: home, APPDATA: appData, PATHEXT: '.EXE;.CMD;.BAT;.COM' };

    expect(await resolveExecutable('gemini', environment)).toBe(geminiPath);
    expect(await resolveExecutable('codex', environment)).toBe(codexPath);
  });

  it('reports when an auto-discovered CLI needs user PATH repair', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-cli-health-'));
    temporaryDirectories.push(home);
    const binDirectory = path.join(home, '.local', 'bin');
    await fs.mkdir(binDirectory, { recursive: true });
    const executablePath = path.join(binDirectory, process.platform === 'win32' ? 'codex.CMD' : 'codex');
    await fs.writeFile(executablePath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf8');
    if (process.platform !== 'win32') await fs.chmod(executablePath, 0o755);

    const health = await checkCliProvider('codex', {
      PATH: '',
      USERPROFILE: home,
      HOME: home,
      PATHEXT: '.EXE;.CMD;.BAT;.COM',
    });

    expect(health).toMatchObject({
      installed: true,
      path: executablePath,
      onPath: false,
      needsPathRepair: true,
      pathDirectory: binDirectory,
    });
  });

  it('adds CLI install directories to PATH without duplicating entries', () => {
    const first = buildPathWithDirectory(['C:\\Tools'], 'C:\\Users\\Clem\\.local\\bin\\');
    const second = buildPathWithDirectory(first.split(path.delimiter), 'C:\\Users\\Clem\\.local\\bin');

    expect(second.split(path.delimiter).filter((entry) => entry.toLowerCase() === 'c:\\users\\clem\\.local\\bin')).toHaveLength(1);
  });

  it('parses setup arguments without invoking a shell parser', () => {
    expect(parseShellWords('login --model "gpt test" --flag\\ value')).toEqual(['login', '--model', 'gpt test', '--flag value']);
  });

  it('keeps CLI installer commands on an explicit allowlist', () => {
    expect(installCommandFor('claude', 'win32')).toBe('irm https://claude.ai/install.ps1 | iex');
    expect(installCommandFor('codex', 'win32')).toBe('irm https://chatgpt.com/codex/install.ps1 | iex');
    expect(installCommandFor('codex', 'linux')).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(installCommandFor('gemini', 'win32')).toBe('npm install -g @google/gemini-cli');
    expect(Object.keys(INSTALL_COMMANDS).sort()).toEqual(['claude', 'codex', 'gemini']);
  });
});
