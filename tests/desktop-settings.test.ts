import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createProviderSettingsStore } = require('../desktop/app/provider-settings.cjs') as {
  createProviderSettingsStore: (options: {
    filePath: string;
    encryption: {
      isAvailable: () => boolean;
      encrypt: (value: string) => string;
      decrypt: (value: string) => string;
    };
    environment?: Record<string, string | undefined>;
  }) => {
    getEnvironment: () => Promise<Record<string, string>>;
    getPublicSettings: () => Promise<{
      firstRun: boolean;
      encryptionAvailable: boolean;
      defaultProvider: string;
      models: Record<string, string>;
      cliCommand: string;
      cliArgs: string;
      credentialSources: Record<string, string>;
    }>;
    save: (input: unknown) => Promise<unknown>;
  };
};

const temporaryDirectories: string[] = [];
const encryption = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`protected:${value}`, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8').replace(/^protected:/, ''),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Electron provider settings', () => {
  it('uses environment configuration before first-run setup is completed', async () => {
    const { store } = await createStore({
      OPENAI_API_KEY: 'environment-secret',
      OPENAI_MODEL: 'gpt-environment',
      OCTAVE_DEFAULT_PROVIDER: 'openai',
    });

    const settings = await store.getPublicSettings();
    const environment = await store.getEnvironment();

    expect(settings).toMatchObject({
      firstRun: true,
      defaultProvider: 'openai',
      credentialSources: { openai: 'environment' },
    });
    expect(settings.models.openai).toBe('gpt-environment');
    expect(environment.OPENAI_API_KEY).toBe('environment-secret');
    expect(environment.OPENAI_MODEL).toBeUndefined();
  });

  it('encrypts saved keys and exposes them only to the local server environment', async () => {
    const { filePath, store } = await createStore();
    await store.save(settingsInput({ openai: 'sk-super-secret' }));

    const persisted = await fs.readFile(filePath, 'utf8');
    const settings = await store.getPublicSettings();
    const environment = await store.getEnvironment();

    expect(persisted).not.toContain('sk-super-secret');
    expect(settings).toMatchObject({
      firstRun: false,
      defaultProvider: 'openai',
      credentialSources: { openai: 'saved' },
    });
    expect(environment).toMatchObject({
      OCTAVE_DEFAULT_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-super-secret',
      OPENAI_MODEL: 'gpt-test',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    });
  });

  it('persists command-line provider configuration without treating it as a credential', async () => {
    const { store } = await createStore();
    await store.save({
      ...settingsInput({}),
      defaultProvider: 'cli',
      cliCommand: 'codex',
      cliArgs: 'exec --model gpt-test -',
    });

    const settings = await store.getPublicSettings();
    const environment = await store.getEnvironment();

    expect(settings).toMatchObject({
      firstRun: false,
      defaultProvider: 'cli',
      cliCommand: 'codex',
      cliArgs: 'exec --model gpt-test -',
    });
    expect(environment).toMatchObject({
      OCTAVE_DEFAULT_PROVIDER: 'cli',
      OCTAVE_CLI_COMMAND: 'codex',
      OCTAVE_CLI_ARGS: 'exec --model gpt-test -',
      OCTAVE_CLI_MODEL: 'cli-test',
    });
  });

  it('migrates retired Claude model IDs when reading saved settings', async () => {
    const { filePath, store } = await createStore();
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      completed: true,
      defaultProvider: 'anthropic',
      models: {
        demo: 'demo',
        ollama: 'llama3.1',
        cli: 'claude-sonnet-4-20250514',
        anthropic: 'claude-sonnet-4-20250514',
        openai: 'gpt-5.6-sol',
        xai: 'grok-4.5-latest',
      },
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      cliCommand: 'claude',
      cliArgs: '-p --model {model}',
      credentials: {},
    }));

    const settings = await store.getPublicSettings();
    const environment = await store.getEnvironment();

    expect(settings.models.anthropic).toBe('claude-sonnet-5');
    expect(settings.models.cli).toBe('claude-sonnet-5');
    expect(environment.ANTHROPIC_MODEL).toBe('claude-sonnet-5');
    expect(environment.OCTAVE_CLI_MODEL).toBe('claude-sonnet-5');
  });

  it('migrates the old Codex CLI preset to final-message output files', async () => {
    const { filePath, store } = await createStore();
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      completed: true,
      defaultProvider: 'cli',
      models: {
        demo: 'demo',
        ollama: 'llama3.1',
        cli: 'gpt-5.6-sol',
        anthropic: 'claude-sonnet-5',
        openai: 'gpt-5.6-sol',
        xai: 'grok-4.5-latest',
      },
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      cliCommand: 'codex',
      cliArgs: 'exec --model {model} -',
      credentials: {},
    }));

    const settings = await store.getPublicSettings();
    const environment = await store.getEnvironment();

    expect(settings.cliArgs).toBe('exec --model {model} --output-last-message {outputFile} -');
    expect(environment.OCTAVE_CLI_ARGS).toBe('exec --model {model} --output-last-message {outputFile} -');
  });

  it('removes a saved key without erasing an environment credential', async () => {
    const { store } = await createStore({ OPENAI_API_KEY: 'environment-secret' });
    await store.save(settingsInput({ openai: 'saved-secret' }));
    await store.save(settingsInput({ openai: null }));

    expect(await store.getPublicSettings()).toMatchObject({ credentialSources: { openai: 'environment' } });
    expect(await store.getEnvironment()).toMatchObject({ OPENAI_API_KEY: 'environment-secret' });
  });

  it('rejects plaintext credential storage and unsafe Ollama URLs', async () => {
    const { filePath } = await createStore();
    const unavailableStore = createProviderSettingsStore({
      filePath,
      encryption: { ...encryption, isAvailable: () => false },
      environment: {},
    });

    await expect(unavailableStore.save(settingsInput({ openai: 'secret' }))).rejects.toThrow('Secure credential storage');
    await expect(unavailableStore.save({ ...settingsInput({}), ollamaBaseUrl: 'file:///C:/secrets' })).rejects.toThrow('HTTP or HTTPS');
  });
});

async function createStore(environment: Record<string, string | undefined> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-provider-settings-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'provider-settings.json');
  return {
    filePath,
    store: createProviderSettingsStore({ filePath, encryption, environment }),
  };
}

function settingsInput(credentials: Record<string, string | null>) {
  return {
    defaultProvider: 'openai',
    models: {
      demo: 'demo',
      ollama: 'llama-test',
      cli: 'cli-test',
      anthropic: 'claude-test',
      openai: 'gpt-test',
      xai: 'grok-test',
    },
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    cliCommand: '',
    cliArgs: '',
    credentials,
  };
}
