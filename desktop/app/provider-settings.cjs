const fs = require('node:fs/promises');
const path = require('node:path');

const CLOUD_PROVIDERS = ['anthropic', 'openai', 'xai'];
const PROVIDERS = ['demo', 'ollama', 'cli', ...CLOUD_PROVIDERS];
const DEFAULT_MODELS = Object.freeze({
  demo: 'demo',
  ollama: 'llama3.1',
  cli: 'gpt-5.6-sol',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-sol',
  xai: 'grok-4.5',
});
const MODEL_REPLACEMENTS = Object.freeze({
  'claude-sonnet-4-20250514': 'claude-sonnet-5',
  'claude-opus-4-20250514': 'claude-opus-4-8',
  'grok-4.5-latest': 'grok-4.5',
});
const CLI_ARG_REPLACEMENTS = Object.freeze({
  'codex\0exec --model {model} -': 'exec --model {model} --output-last-message {outputFile} -',
});
const KEY_ENVIRONMENT_VARIABLES = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
});
const MODEL_ENVIRONMENT_VARIABLES = Object.freeze({
  ollama: 'OLLAMA_MODEL',
  cli: 'OCTAVE_CLI_MODEL',
  anthropic: 'ANTHROPIC_MODEL',
  openai: 'OPENAI_MODEL',
  xai: 'XAI_MODEL',
});

function createProviderSettingsStore({ filePath, encryption, environment = process.env }) {
  if (!path.isAbsolute(filePath)) throw new Error('Provider settings path must be absolute.');

  return Object.freeze({
    getEnvironment: async () => toEnvironment(await readDocument(filePath), encryption, environment),
    getPublicSettings: async () => toPublicSettings(await readDocument(filePath), encryption, environment),
    save: async (input) => {
      const current = await readDocument(filePath);
      const next = normalizeInput(input, current, encryption);
      await writeDocument(filePath, next);
      return toPublicSettings(next, encryption, environment);
    },
  });
}

function createSafeStorageEncryption(safeStorage) {
  return Object.freeze({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
  });
}

async function readDocument(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return defaultDocument();
    throw error;
  }

  try {
    return normalizeStoredDocument(JSON.parse(raw));
  } catch {
    throw new Error('Octave provider settings are unreadable. Remove provider-settings.json to reset them.');
  }
}

async function writeDocument(filePath, document) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function defaultDocument() {
  return {
    version: 1,
    completed: false,
    defaultProvider: 'demo',
    models: { ...DEFAULT_MODELS },
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    cliCommand: '',
    cliArgs: '',
    credentials: {},
  };
}

function normalizeStoredDocument(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) throw new Error('Unsupported settings document.');
  const defaults = defaultDocument();
  const models = value.models && typeof value.models === 'object' ? value.models : {};
  const credentials = value.credentials && typeof value.credentials === 'object' ? value.credentials : {};
  const normalizedCredentials = {};
  for (const provider of CLOUD_PROVIDERS) {
    if (typeof credentials[provider] === 'string' && credentials[provider].length <= 50_000) {
      normalizedCredentials[provider] = credentials[provider];
    }
  }
  return {
    version: 1,
    completed: value.completed === true,
    defaultProvider: PROVIDERS.includes(value.defaultProvider) ? value.defaultProvider : defaults.defaultProvider,
    models: Object.fromEntries(PROVIDERS.map((provider) => [provider, normalizeModel(models[provider], defaults.models[provider])])),
    ollamaBaseUrl: normalizeOllamaUrl(value.ollamaBaseUrl, defaults.ollamaBaseUrl),
    cliCommand: normalizeCommand(value.cliCommand, defaults.cliCommand),
    cliArgs: normalizeCliArgs(value.cliArgs, defaults.cliArgs, value.cliCommand),
    credentials: normalizedCredentials,
  };
}

function normalizeInput(input, current, encryption) {
  if (!input || typeof input !== 'object') throw new Error('Provider settings must be an object.');
  if (!PROVIDERS.includes(input.defaultProvider)) throw new Error('Choose a valid default provider.');
  if (!input.models || typeof input.models !== 'object') throw new Error('Provider models are required.');

  const credentials = { ...current.credentials };
  const credentialChanges = input.credentials && typeof input.credentials === 'object' ? input.credentials : {};
  for (const provider of CLOUD_PROVIDERS) {
    const value = credentialChanges[provider];
    if (value === null) {
      delete credentials[provider];
    } else if (typeof value === 'string' && value.trim()) {
      if (value.length > 10_000) throw new Error(`${provider} API key is too long.`);
      if (!encryption.isAvailable()) throw new Error('Secure credential storage is unavailable on this computer.');
      credentials[provider] = encryption.encrypt(value.trim());
    } else if (value !== undefined && value !== '') {
      throw new Error(`${provider} credential change is invalid.`);
    }
  }

  return {
    version: 1,
    completed: true,
    defaultProvider: input.defaultProvider,
    models: Object.fromEntries(PROVIDERS.map((provider) => [
      provider,
      normalizeModel(input.models[provider], current.models[provider]),
    ])),
    ollamaBaseUrl: normalizeOllamaUrl(input.ollamaBaseUrl, current.ollamaBaseUrl),
    cliCommand: normalizeCommand(input.cliCommand, current.cliCommand),
    cliArgs: normalizeCliArgs(input.cliArgs, current.cliArgs, input.cliCommand),
    credentials,
  };
}

function toPublicSettings(document, encryption, environment) {
  const credentialSources = {};
  for (const provider of CLOUD_PROVIDERS) {
    credentialSources[provider] = document.credentials[provider]
      ? 'saved'
      : environment[KEY_ENVIRONMENT_VARIABLES[provider]]
        ? 'environment'
        : 'none';
  }
  const models = { ...document.models };
  if (!document.completed) {
    for (const [provider, variable] of Object.entries(MODEL_ENVIRONMENT_VARIABLES)) {
      if (environment[variable]) models[provider] = environment[variable];
    }
  }
  return {
    firstRun: !document.completed,
    encryptionAvailable: encryption.isAvailable(),
    defaultProvider: !document.completed && PROVIDERS.includes(environment.OCTAVE_DEFAULT_PROVIDER)
      ? environment.OCTAVE_DEFAULT_PROVIDER
      : document.defaultProvider,
    models,
    ollamaBaseUrl: !document.completed && environment.OLLAMA_BASE_URL
      ? normalizeOllamaUrl(environment.OLLAMA_BASE_URL, document.ollamaBaseUrl)
      : document.ollamaBaseUrl,
    cliCommand: !document.completed && environment.OCTAVE_CLI_COMMAND
      ? normalizeCommand(environment.OCTAVE_CLI_COMMAND, document.cliCommand)
      : document.cliCommand,
    cliArgs: !document.completed && environment.OCTAVE_CLI_ARGS
      ? normalizeCliArgs(environment.OCTAVE_CLI_ARGS, document.cliArgs, document.cliCommand)
      : document.cliArgs,
    credentialSources,
  };
}

function toEnvironment(document, encryption, environment) {
  const result = {};
  if (document.completed) {
    result.OCTAVE_DEFAULT_PROVIDER = document.defaultProvider;
    result.OLLAMA_BASE_URL = document.ollamaBaseUrl;
    result.OCTAVE_CLI_COMMAND = document.cliCommand;
    result.OCTAVE_CLI_ARGS = document.cliArgs;
    for (const [provider, variable] of Object.entries(MODEL_ENVIRONMENT_VARIABLES)) {
      result[variable] = document.models[provider];
    }
  }
  if (encryption.isAvailable()) {
    for (const provider of CLOUD_PROVIDERS) {
      const encrypted = document.credentials[provider];
      if (encrypted) {
        try {
          result[KEY_ENVIRONMENT_VARIABLES[provider]] = encryption.decrypt(encrypted);
        } catch {
          // Keep the app recoverable if OS-bound ciphertext was moved from another account or computer.
        }
      }
    }
  }
  for (const variable of Object.values(KEY_ENVIRONMENT_VARIABLES)) {
    if (!result[variable] && environment[variable]) result[variable] = environment[variable];
  }
  return result;
}

function normalizeModel(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  if (normalized.length > 200) throw new Error('Provider model names must be 200 characters or fewer.');
  return MODEL_REPLACEMENTS[normalized] || normalized;
}

function normalizeOllamaUrl(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  if (value.length > 2_000) throw new Error('Ollama URL is too long.');
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Ollama URL must be a valid HTTP or HTTPS address.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Ollama URL must be an HTTP or HTTPS address without embedded credentials.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeCommand(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (normalized.length > 2_000) throw new Error('CLI command is too long.');
  if (/[\r\n]/.test(normalized)) throw new Error('CLI command must fit on one line.');
  return normalized;
}

function normalizeCliArgs(value, fallback, command = '') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (normalized.length > 8_000) throw new Error('CLI arguments are too long.');
  if (/[\r\n]/.test(normalized)) throw new Error('CLI arguments must fit on one line.');
  return CLI_ARG_REPLACEMENTS[`${normalizeCommand(command, '')}\0${normalized}`] || normalized;
}

module.exports = {
  CLOUD_PROVIDERS,
  DEFAULT_MODELS,
  createProviderSettingsStore,
  createSafeStorageEncryption,
};
