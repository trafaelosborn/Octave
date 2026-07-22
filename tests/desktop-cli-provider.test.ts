import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { INSTALL_COMMANDS, augmentPathEnvironment, parseShellWords, resolveExecutable } = require('../desktop/app/cli-provider-setup.cjs') as {
  INSTALL_COMMANDS: Record<string, string>;
  augmentPathEnvironment: (environment?: Record<string, string | undefined>) => Record<string, string>;
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

  it('parses setup arguments without invoking a shell parser', () => {
    expect(parseShellWords('login --model "gpt test" --flag\\ value')).toEqual(['login', '--model', 'gpt test', '--flag value']);
  });

  it('keeps CLI installer commands on an explicit allowlist', () => {
    expect(INSTALL_COMMANDS.claude).toBe('irm https://claude.ai/install.ps1 | iex');
    expect(Object.keys(INSTALL_COMMANDS).sort()).toEqual(['claude', 'codex', 'gemini']);
  });
});
