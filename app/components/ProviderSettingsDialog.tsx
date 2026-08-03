'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  DesktopCloudProviderId,
  DesktopProviderId,
  DesktopProviderSettings,
  DesktopProviderSettingsInput,
} from '../lib/client-types';
import { Icon } from './Icon';

type CliPresetId = 'codex' | 'claude' | 'gemini' | 'custom';
type CliStatusKind = 'idle' | 'ok' | 'warn' | 'error';
type CliHealth = {
  checked: boolean;
  installed: boolean;
  path: string | null;
  onPath: boolean;
  needsPathRepair: boolean;
  pathDirectory: string | null;
  accountStatus: 'unknown' | 'ok' | 'warn' | 'error';
  accountMessage: string;
  modelStatus: 'unknown' | 'ok' | 'warn' | 'error';
  modelMessage: string;
};
type CliInstallStatus = Record<CliPresetId, CliHealth>;
type PlatformId = 'openai' | 'anthropic' | 'xai' | 'gemini' | 'ollama' | 'demo';
type ConnectionMode = 'api' | 'cli' | 'local' | 'demo';
type ModelChoice = { id: string; name: string; detail?: string };

interface PlatformOption {
  id: PlatformId;
  name: string;
  detail: string;
  apiProvider?: DesktopCloudProviderId;
  cliPreset?: Exclude<CliPresetId, 'custom'>;
  localProvider?: Extract<DesktopProviderId, 'ollama'>;
  demoProvider?: Extract<DesktopProviderId, 'demo'>;
  frontierModel: string;
}

const CLI_PRESETS: Array<{
  id: CliPresetId;
  name: string;
  command: string;
  args: string;
  setupArgs: string;
  model: string;
  detail: string;
  account: string;
  installUrl?: string;
  installCommand?: string;
}> = [
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: 'exec --model {model} --output-last-message {outputFile} -',
    setupArgs: 'login',
    model: 'gpt-5.6-sol',
    detail: 'OpenAI account through the Codex CLI',
    account: 'OpenAI',
    installUrl: 'https://github.com/openai/codex',
    installCommand: 'irm https://chatgpt.com/codex/install.ps1 | iex',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: '-p --model {model}',
    setupArgs: '',
    model: 'sonnet',
    detail: 'Anthropic account through Claude Code',
    account: 'Anthropic',
    installUrl: 'https://code.claude.com/docs/en/setup',
    installCommand: 'irm https://claude.ai/install.ps1 | iex',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: '-p {prompt}',
    setupArgs: '',
    model: 'gemini-2.5-pro',
    detail: 'Google account through Gemini CLI',
    account: 'Google',
    installUrl: 'https://geminicli.com/docs/get-started/installation/',
    installCommand: 'npm install -g @google/gemini-cli',
  },
  {
    id: 'custom',
    name: 'Custom CLI',
    command: '',
    args: '',
    setupArgs: '',
    model: 'cli',
    detail: 'Any executable that prints an assistant response',
    account: 'Custom',
  },
];

const CLI_INSTALL_EMPTY: CliInstallStatus = {
  codex: emptyCliHealth(),
  claude: emptyCliHealth(),
  gemini: emptyCliHealth(),
  custom: emptyCliHealth(),
};

const CLOUD_PROVIDERS: Array<{ id: DesktopCloudProviderId; name: string; keyLabel: string }> = [
  { id: 'openai', name: 'OpenAI', keyLabel: 'OpenAI API key' },
  { id: 'xai', name: 'Grok (xAI)', keyLabel: 'xAI API key' },
  { id: 'anthropic', name: 'Claude (Anthropic)', keyLabel: 'Anthropic API key' },
];

const PLATFORMS: PlatformOption[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    detail: 'GPT frontier models through API keys or the Codex CLI.',
    apiProvider: 'openai',
    cliPreset: 'codex',
    frontierModel: 'gpt-5.6-sol',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    detail: 'Claude frontier models through API keys or Claude Code.',
    apiProvider: 'anthropic',
    cliPreset: 'claude',
    frontierModel: 'claude-sonnet-5',
  },
  {
    id: 'xai',
    name: 'Grok',
    detail: 'xAI/Grok frontier models through an API key.',
    apiProvider: 'xai',
    frontierModel: 'grok-4.5-latest',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    detail: 'Google Gemini through the installed Gemini CLI.',
    cliPreset: 'gemini',
    frontierModel: 'gemini-2.5-pro',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    detail: 'Local models running on this computer or your network.',
    localProvider: 'ollama',
    frontierModel: 'llama3.1',
  },
  {
    id: 'demo',
    name: 'Offline demo',
    detail: 'Explore Octave without signing in.',
    demoProvider: 'demo',
    frontierModel: 'demo',
  },
];

const API_MODEL_CHOICES: Partial<Record<DesktopCloudProviderId, ModelChoice[]>> = {
  openai: [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', detail: 'Frontier / highest capability' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', detail: 'Balanced everyday work' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', detail: 'Best speed/intelligence balance' },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', detail: 'Complex reasoning and agentic work' },
    { id: 'claude-fable-5', name: 'Claude Fable 5', detail: 'Highest available capability, if your account has access' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', detail: 'Fastest Claude option' },
  ],
  xai: [
    { id: 'grok-4.5-latest', name: 'Grok 4.5 latest', detail: 'xAI frontier default' },
  ],
};

const CLI_MODEL_CHOICES: Partial<Record<CliPresetId, ModelChoice[]>> = {
  codex: [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', detail: 'Frontier / highest capability' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', detail: 'Balanced everyday work' },
  ],
  claude: [
    { id: 'sonnet', name: 'Claude Sonnet', detail: 'Claude Code default daily frontier alias' },
    { id: 'opus', name: 'Claude Opus', detail: 'Claude Code complex reasoning alias' },
    { id: 'best', name: 'Best available Claude', detail: 'Uses Fable where available, otherwise latest Opus' },
    { id: 'fable', name: 'Claude Fable', detail: 'Hardest and longest-running tasks, if available' },
    { id: 'haiku', name: 'Claude Haiku', detail: 'Fast and efficient' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', detail: 'Pinned API model ID' },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', detail: 'Pinned API model ID' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', detail: 'Google frontier default' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', detail: 'Faster Gemini option' },
  ],
};

export function ProviderSettingsDialog({
  open,
  settings,
  saving,
  workspaceReady = false,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: DesktopProviderSettings;
  saving: boolean;
  workspaceReady?: boolean;
  onClose: () => void;
  onSave: (input: DesktopProviderSettingsInput) => Promise<void>;
}) {
  const [defaultProvider, setDefaultProvider] = useState<DesktopProviderId>(settings.defaultProvider);
  const [models, setModels] = useState(settings.models);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(settings.ollamaBaseUrl);
  const [cliCommand, setCliCommand] = useState(settings.cliCommand);
  const [cliArgs, setCliArgs] = useState(settings.cliArgs);
  const [cliSetupArgs, setCliSetupArgs] = useState('');
  const [cliPresetId, setCliPresetId] = useState<CliPresetId>('custom');
  const [cliInstallStatus, setCliInstallStatus] = useState<CliInstallStatus>(CLI_INSTALL_EMPTY);
  const [cliStatus, setCliStatus] = useState('');
  const [cliStatusKind, setCliStatusKind] = useState<CliStatusKind>('idle');
  const [cliAdvancedOpen, setCliAdvancedOpen] = useState(false);
  const [platformId, setPlatformId] = useState<PlatformId>('openai');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('api');
  const [credentials, setCredentials] = useState<DesktopProviderSettingsInput['credentials']>({});
  const [problem, setProblem] = useState('');
  const activePlatform = findPlatform(platformId);
  const activeCloudProvider = activePlatform.apiProvider
    ? CLOUD_PROVIDERS.find((provider) => provider.id === activePlatform.apiProvider)
    : undefined;

  useEffect(() => {
    if (!open) return;
    setDefaultProvider(settings.defaultProvider);
    setModels(settings.models);
    setOllamaBaseUrl(settings.ollamaBaseUrl);
    setCliCommand(settings.cliCommand);
    setCliArgs(settings.cliArgs);
    const preset = findCliPreset(settings.cliCommand, settings.cliArgs);
    setCliPresetId(preset.id);
    setCliSetupArgs(preset.setupArgs);
    const selection = inferPlatformSelection(settings.defaultProvider, preset.id);
    setPlatformId(selection.platform.id);
    setConnectionMode(selection.mode);
    setCliInstallStatus(CLI_INSTALL_EMPTY);
    setCliStatus('');
    setCliStatusKind('idle');
    setCliAdvancedOpen(preset.id === 'custom');
    setCredentials({});
    setProblem('');
    void detectCliTools();
  }, [open, settings]);

  if (!open) return null;

  const selectedCliPreset = CLI_PRESETS.find((candidate) => candidate.id === cliPresetId);
  const selectedCliHealth = cliInstallStatus[cliPresetId] ?? emptyCliHealth();
  const setupSteps = buildSetupSteps({
    activeCloudProvider,
    activePlatform,
    connectionMode,
    credentials,
    models,
    selectedCliHealth,
    selectedCliPreset,
    settings,
    workspaceReady,
  });
  const setupReadiness = setupSteps.every((step) => step.kind === 'done')
    ? 'Octave is ready. Save, then open your research folder.'
    : 'You can save and finish any warnings later. Validation just prevents surprise provider errors.';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setProblem('');
    try {
      await onSave({ defaultProvider, models, ollamaBaseUrl, cliCommand, cliArgs, credentials });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  function updateModel(provider: DesktopProviderId, value: string): void {
    setModels((current) => ({ ...current, [provider]: value }));
  }

  function updateCredential(provider: DesktopCloudProviderId, value: string | null | undefined): void {
    setCredentials((current) => {
      const next = { ...current };
      if (value === undefined) delete next[provider];
      else next[provider] = value;
      return next;
    });
  }

  function choosePlatform(value: PlatformId): void {
    const platform = findPlatform(value);
    const nextMode = defaultConnectionMode(platform, connectionMode);
    setPlatformId(platform.id);
    applyPlatformConnection(platform, nextMode);
  }

  function chooseConnectionMode(mode: ConnectionMode): void {
    applyPlatformConnection(findPlatform(platformId), mode);
  }

  function choosePlatformMode(value: PlatformId, mode: ConnectionMode): void {
    const platform = findPlatform(value);
    setPlatformId(platform.id);
    applyPlatformConnection(platform, mode);
  }

  function applyPlatformConnection(platform: PlatformOption, mode: ConnectionMode): void {
    setConnectionMode(mode);
    setCliStatus('');
    setCliStatusKind('idle');

    if (mode === 'api' && platform.apiProvider) {
      setDefaultProvider(platform.apiProvider);
      updateModel(platform.apiProvider, platform.frontierModel);
      return;
    }
    if (mode === 'cli' && platform.cliPreset) {
      const preset = findCliPresetById(platform.cliPreset);
      setDefaultProvider('cli');
      setCliPresetId(preset.id);
      setCliCommand(preset.command);
      setCliArgs(preset.args);
      setCliSetupArgs(preset.setupArgs);
      updateModel('cli', preset.model);
      setCliAdvancedOpen(false);
      return;
    }
    if (mode === 'local' && platform.localProvider) {
      setDefaultProvider(platform.localProvider);
      updateModel(platform.localProvider, platform.frontierModel);
      return;
    }
    if (mode === 'demo' && platform.demoProvider) {
      setDefaultProvider(platform.demoProvider);
      updateModel(platform.demoProvider, platform.frontierModel);
    }
  }

  async function detectCliTools(): Promise<void> {
    if (!window.octaveDesktop) return;
    const entries = await Promise.all(CLI_PRESETS.filter((preset) => preset.id !== 'custom').map(async (preset) => {
      try {
        const result = await window.octaveDesktop?.checkCliProvider({ command: preset.command });
        return [preset.id, {
          checked: true,
          installed: Boolean(result?.installed),
          path: result?.path ?? null,
          onPath: Boolean(result?.onPath),
          needsPathRepair: Boolean(result?.needsPathRepair),
          pathDirectory: result?.pathDirectory ?? null,
          accountStatus: 'unknown',
          accountMessage: '',
          modelStatus: 'unknown',
          modelMessage: '',
        }] as const;
      } catch {
        return [preset.id, emptyCliHealth(true)] as const;
      }
    }));
    setCliInstallStatus((current) => ({ ...current, ...Object.fromEntries(entries) }));
  }

  async function checkCli(presetId: CliPresetId = cliPresetId): Promise<boolean> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to check local CLI tools.');
      setCliStatusKind('warn');
      return false;
    }
    const preset = CLI_PRESETS.find((candidate) => candidate.id === presetId);
    const command = presetId === cliPresetId || preset?.id === 'custom' ? cliCommand : preset?.command ?? cliCommand;
    setCliStatus('Checking...');
    setCliStatusKind('idle');
    try {
      const result = await window.octaveDesktop.checkCliProvider({ command });
      setCliInstallStatus((current) => ({
        ...current,
        [presetId]: {
          checked: true,
          installed: result.installed,
          path: result.path,
          onPath: result.onPath,
          needsPathRepair: result.needsPathRepair,
          pathDirectory: result.pathDirectory,
          accountStatus: 'unknown',
          accountMessage: '',
          modelStatus: 'unknown',
          modelMessage: '',
        },
      }));
      setCliStatus(result.installed
        ? cliHealthMessage(preset, {
          checked: true,
          ...result,
          accountStatus: 'unknown',
          accountMessage: '',
          modelStatus: 'unknown',
          modelMessage: '',
        })
        : missingCliMessage(preset));
      setCliStatusKind(result.installed ? 'ok' : 'warn');
      return result.installed;
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
      return false;
    }
  }

  async function launchCliSetup(input: { command?: string; setupArgs?: string; name?: string } = {}): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to launch CLI sign-in.');
      setCliStatusKind('warn');
      return;
    }
    const command = input.command ?? cliCommand;
    const args = input.setupArgs ?? cliSetupArgs;
    const name = input.name ?? CLI_PRESETS.find((preset) => preset.id === cliPresetId)?.name ?? 'CLI';
    const preset = CLI_PRESETS.find((candidate) => candidate.command === command) ?? CLI_PRESETS.find((candidate) => candidate.id === cliPresetId);
    if (!(await checkCli(preset?.id ?? cliPresetId))) return;
    setCliStatus('Opening sign-in terminal...');
    setCliStatusKind('idle');
    try {
      await window.octaveDesktop.launchCliProviderSetup({ command, args });
      setCliStatus(`${name} opened in a terminal. Finish sign-in there, then save and restart Octave.`);
      setCliStatusKind('ok');
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
    }
  }

  async function installCli(): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to install CLI tools.');
      setCliStatusKind('warn');
      return;
    }
    if (!['codex', 'claude', 'gemini'].includes(cliPresetId)) {
      setCliStatus('Choose a supported CLI preset before installing.');
      setCliStatusKind('warn');
      return;
    }
    const preset = CLI_PRESETS.find((candidate) => candidate.id === cliPresetId);
    setCliStatus('Opening installer terminal...');
    setCliStatusKind('idle');
    try {
      await window.octaveDesktop.installCliProvider({ preset: cliPresetId as 'codex' | 'claude' | 'gemini' });
      setCliStatus(`${preset?.name ?? 'CLI'} installer opened. Finish the install there, restart Octave if PATH changed, then Check installed.`);
      setCliStatusKind('ok');
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
    }
  }

  async function repairCliPath(presetId: CliPresetId = cliPresetId): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to repair PATH.');
      setCliStatusKind('warn');
      return;
    }
    const preset = CLI_PRESETS.find((candidate) => candidate.id === presetId);
    const command = presetId === cliPresetId || preset?.id === 'custom' ? cliCommand : preset?.command ?? cliCommand;
    setCliStatus('Repairing PATH...');
    setCliStatusKind('idle');
    try {
      const result = await window.octaveDesktop.repairCliProviderPath({ command });
      setCliInstallStatus((current) => ({
        ...current,
        [presetId]: {
          checked: true,
          installed: result.installed,
          path: result.path,
          onPath: result.onPath,
          needsPathRepair: result.needsPathRepair,
          pathDirectory: result.pathDirectory,
          accountStatus: 'unknown',
          accountMessage: '',
          modelStatus: 'unknown',
          modelMessage: '',
        },
      }));
      setCliStatus(result.repaired
        ? `${preset?.name ?? 'CLI'} install directory was added to your Windows user PATH. Restart terminals to pick it up.`
        : `${preset?.name ?? 'CLI'} is already on PATH.`);
      setCliStatusKind('ok');
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
    }
  }

  async function validateCli(presetId: CliPresetId = cliPresetId): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to validate CLI account and model access.');
      setCliStatusKind('warn');
      return;
    }
    const preset = CLI_PRESETS.find((candidate) => candidate.id === presetId);
    const command = presetId === cliPresetId || preset?.id === 'custom' ? cliCommand : preset?.command ?? cliCommand;
    setCliStatus('Validating account and model...');
    setCliStatusKind('idle');
    try {
      const result = await window.octaveDesktop.validateCliProvider({ command, preset: presetId, model: models.cli });
      setCliInstallStatus((current) => ({
        ...current,
        [presetId]: {
          checked: true,
          installed: result.installed,
          path: result.path,
          onPath: result.onPath,
          needsPathRepair: result.needsPathRepair,
          pathDirectory: result.pathDirectory,
          accountStatus: result.accountStatus,
          accountMessage: result.accountMessage,
          modelStatus: result.modelStatus,
          modelMessage: result.modelMessage,
        },
      }));
      const ok = result.accountStatus === 'ok' && result.modelStatus === 'ok';
      setCliStatus(ok ? `${preset?.name ?? 'CLI'} is ready to chat with ${models.cli}.` : result.modelMessage || result.accountMessage);
      setCliStatusKind(ok ? 'ok' : 'warn');
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
    }
  }

  return (
    <div className="settings-scrim" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
        <header className="settings-header">
          <div>
            <p className="eyebrow">{settings.firstRun ? 'Welcome to Octave' : 'Desktop settings'}</p>
            <h2 id="provider-settings-title">Connect your AI</h2>
            <p>{settings.firstRun
              ? 'Choose how Octave should think. You can start offline and change this at any time.'
              : 'Manage the providers and model defaults used by this desktop app.'}</p>
          </div>
          {!settings.firstRun && (
            <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close provider settings">
              <Icon name="close" />
            </button>
          )}
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="settings-scroll">
            {settings.firstRun && (
              <section className="settings-section setup-overview">
                <div className="settings-section-heading">
                  <div>
                    <h3>Quick start</h3>
                    <p>Pick a platform, choose CLI login or API key, confirm the account/model, then open a workspace.</p>
                  </div>
                </div>
                <div className="quick-start-grid">
                  <button className="quick-start-card" type="button" onClick={() => choosePlatformMode('anthropic', 'cli')}>
                    <strong>Start with Claude Code</strong>
                    <span>Use your Claude account through the installed CLI.</span>
                  </button>
                  <button className="quick-start-card" type="button" onClick={() => choosePlatformMode('openai', 'cli')}>
                    <strong>Use Codex CLI</strong>
                    <span>Sign in with OpenAI and keep API keys out of Octave.</span>
                  </button>
                  <button className="quick-start-card" type="button" onClick={() => choosePlatformMode('demo', 'demo')}>
                    <strong>Skip for now</strong>
                    <span>Open Octave in offline demo mode and connect AI later.</span>
                  </button>
                </div>
                <ol className="setup-checklist" aria-label="Octave setup checklist">
                  {setupSteps.map((step) => (
                    <li className={`setup-step ${step.kind}`} key={step.label}>
                      <span>{step.kind === 'done' ? '✓' : step.kind === 'warn' ? '!' : '•'}</span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="settings-section">
              <div className="settings-section-heading"><div><h3>Choose platform</h3><p>Select the AI account or local runtime Octave should use by default.</p></div></div>
              <div className="platform-grid">
                {PLATFORMS.map((platform) => (
                  <button
                    aria-pressed={platform.id === platformId}
                    className={`platform-card ${platform.id === platformId ? 'selected' : ''}`}
                    key={platform.id}
                    type="button"
                    onClick={() => choosePlatform(platform.id)}
                  >
                    <strong>{platform.name}</strong>
                    <small>{platform.detail}</small>
                    <em>{platform.frontierModel}</em>
                  </button>
                ))}
              </div>
              <div className="connection-mode-row">
                {connectionModesFor(findPlatform(platformId)).map((mode) => (
                  <button
                    aria-pressed={mode === connectionMode}
                    className={mode === connectionMode ? 'selected' : ''}
                    key={mode}
                    type="button"
                    onClick={() => chooseConnectionMode(mode)}
                  >
                    {connectionModeLabel(mode)}
                  </button>
                ))}
              </div>
            </section>

            {connectionMode === 'api' && (
            <section className="settings-section">
              <div className="settings-section-heading">
                <div><h3>{activeCloudProvider?.name ?? activePlatform.name} API</h3><p>Paste a key only when adding or replacing it. Saved keys are never returned to this interface.</p></div>
                <span className={`secure-storage-status ${settings.encryptionAvailable ? 'available' : ''}`}>
                  {settings.encryptionAvailable ? 'OS encryption ready' : 'Encryption unavailable'}
                </span>
              </div>
              <div className="provider-settings-list">
                {(activeCloudProvider ? [activeCloudProvider] : []).map((provider) => {
                  const source = settings.credentialSources[provider.id];
                  const change = credentials[provider.id];
                  const removing = change === null;
                  return (
                    <article className="provider-settings-row" key={provider.id}>
                      <div className="provider-settings-name">
                        <strong>{provider.name}</strong>
                        <small>{removing ? 'Saved key will be removed' : credentialStatus(source, typeof change === 'string' && Boolean(change.trim()))}</small>
                      </div>
                      <label className="settings-field">
                        <span>{provider.keyLabel}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          disabled={removing || !settings.encryptionAvailable}
                          value={typeof change === 'string' ? change : ''}
                          placeholder={credentialPlaceholder(source)}
                          onChange={(event) => updateCredential(provider.id, event.target.value)}
                        />
                      </label>
                      <label className="settings-field">
                        <span>Preferred model</span>
                        <ModelSelect
                          providerLabel={provider.name}
                          value={models[provider.id]}
                          choices={API_MODEL_CHOICES[provider.id] ?? []}
                          onChange={(value) => updateModel(provider.id, value)}
                        />
                      </label>
                      {source === 'saved' && (
                        <button
                          className="text-button credential-remove"
                          type="button"
                          onClick={() => updateCredential(provider.id, removing ? undefined : null)}
                        >
                          {removing ? 'Keep saved key' : 'Remove saved key'}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
            )}

            {connectionMode === 'local' && (
            <section className="settings-section local-provider-settings">
              <div className="settings-section-heading"><div><h3>Local Ollama</h3><p>Use the default local service or another Ollama host you control.</p></div></div>
              <div className="settings-field-grid">
                <label className="settings-field"><span>Server URL</span><input value={ollamaBaseUrl} onChange={(event) => setOllamaBaseUrl(event.target.value)} /></label>
                <label className="settings-field"><span>Preferred model</span><input value={models.ollama} onChange={(event) => updateModel('ollama', event.target.value)} /></label>
              </div>
            </section>
            )}

            {connectionMode === 'cli' && (
            <section className="settings-section local-provider-settings">
              <div className="settings-section-heading"><div><h3>Command-line sign-in</h3><p>Octave will use the installed CLI for this platform and keep API keys out of Octave.</p></div></div>
              <div className="cli-selected-summary">
                {(() => {
                  const preset = CLI_PRESETS.find((candidate) => candidate.id === cliPresetId);
                  const status = cliInstallStatus[cliPresetId];
                  return (
                    <>
                      <strong>{preset?.name ?? 'Command-line AI'}</strong>
                      <span>{cliPresetId === 'custom' ? 'Enter the executable and arguments in Advanced.' : `Uses your ${preset?.account ?? 'CLI'} sign-in with ${models.cli || findPlatform(platformId).frontierModel} by default.`}</span>
                      {preset && status.checked && status.installed && (
                        <p className={`cli-health-line ${status.needsPathRepair ? 'warn' : 'ok'}`}>
                          <span>{cliHealthMessage(preset, status)}</span>
                          <span className={cliReadinessKind(status)}>{cliReadinessMessage(status)}</span>
                          {status.accountMessage && <small>{status.accountMessage}</small>}
                          {status.modelMessage && status.modelMessage !== status.accountMessage && <small>{status.modelMessage}</small>}
                          {status.path && <code>{status.path}</code>}
                        </p>
                      )}
                      {preset && status.checked && !status.installed && (
                        <p className="cli-install-help">
                          <span>{missingCliMessage(preset)}</span>
                          {preset.installCommand && <code>{preset.installCommand}</code>}
                          <span className="cli-install-actions">
                            <button className="text-button" type="button" onClick={() => void installCli()} disabled={saving}>Open installer</button>
                            {preset.installUrl && <a href={preset.installUrl} target="_blank" rel="noreferrer">Open install docs</a>}
                          </span>
                        </p>
                      )}
                    </>
                  );
                })()}
                <div>
                  <button className="button button-secondary" type="button" onClick={() => void checkCli()} disabled={saving || !cliCommand.trim()}>Check installed</button>
                  {cliInstallStatus[cliPresetId]?.needsPathRepair && (
                    <button className="button button-secondary" type="button" onClick={() => void repairCliPath()} disabled={saving || !cliCommand.trim()}>Repair PATH</button>
                  )}
                  <button className="button button-secondary" type="button" onClick={() => void validateCli()} disabled={saving || !cliCommand.trim() || cliPresetId === 'custom'}>Validate model</button>
                  <button className="button button-primary" type="button" onClick={() => void launchCliSetup()} disabled={saving || !cliCommand.trim()}>Connect account</button>
                </div>
              </div>
              <details className="cli-advanced-settings" open={cliAdvancedOpen} onToggle={(event) => setCliAdvancedOpen(event.currentTarget.open)}>
                <summary>Advanced CLI settings</summary>
                <div className="settings-field-grid settings-field-spaced">
                  <label className="settings-field"><span>Command</span><input value={cliCommand} placeholder="codex" onChange={(event) => { setCliCommand(event.target.value); setCliPresetId('custom'); }} /></label>
                  <label className="settings-field">
                    <span>Preferred model</span>
                    <ModelSelect
                      providerLabel={CLI_PRESETS.find((preset) => preset.id === cliPresetId)?.name ?? 'CLI'}
                      value={models.cli}
                      choices={CLI_MODEL_CHOICES[cliPresetId] ?? []}
                      onChange={(value) => updateModel('cli', value)}
                    />
                  </label>
                </div>
                <label className="settings-field settings-field-spaced"><span>Prompt arguments</span><input value={cliArgs} placeholder="exec -" onChange={(event) => { setCliArgs(event.target.value); setCliPresetId('custom'); }} /></label>
                <label className="settings-field settings-field-spaced"><span>Setup arguments</span><input value={cliSetupArgs} placeholder="login" onChange={(event) => setCliSetupArgs(event.target.value)} /></label>
              </details>
              {cliStatus && <p className={`cli-setup-status ${cliStatusKind}`}>{cliStatus}</p>}
            </section>
            )}

            {problem && <div className="settings-error" role="alert">{problem}</div>}
          </div>

          <footer className="settings-footer">
            <p>{settings.firstRun ? setupReadiness : "Keys and local provider settings are passed only to Octave's private local server. Saved API keys are encrypted through your operating system account."}</p>
            <div>
              {!settings.firstRun && <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>}
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? (settings.firstRun ? 'Opening Octave...' : 'Saving and restarting...') : settings.firstRun ? 'Save and open Octave' : 'Save and restart'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function credentialStatus(source: DesktopProviderSettings['credentialSources'][DesktopCloudProviderId], replacing: boolean): string {
  if (replacing) return 'New key ready to save';
  if (source === 'saved') return 'Saved securely on this computer';
  if (source === 'environment') return 'Provided by an environment variable';
  return 'Not connected';
}

function credentialPlaceholder(source: DesktopProviderSettings['credentialSources'][DesktopCloudProviderId]): string {
  if (source === 'saved') return 'Saved securely';
  if (source === 'environment') return 'Using environment configuration';
  return 'Paste a new key';
}

type SetupStep = { label: string; detail: string; kind: 'done' | 'pending' | 'warn' };

function buildSetupSteps({
  activeCloudProvider,
  activePlatform,
  connectionMode,
  credentials,
  models,
  selectedCliHealth,
  selectedCliPreset,
  settings,
  workspaceReady,
}: {
  activeCloudProvider: typeof CLOUD_PROVIDERS[number] | undefined;
  activePlatform: PlatformOption;
  connectionMode: ConnectionMode;
  credentials: DesktopProviderSettingsInput['credentials'];
  models: DesktopProviderSettings['models'];
  selectedCliHealth: CliHealth;
  selectedCliPreset: typeof CLI_PRESETS[number] | undefined;
  settings: DesktopProviderSettings;
  workspaceReady: boolean;
}): SetupStep[] {
  const providerName = activePlatform.name;
  const steps: SetupStep[] = [
    {
      label: 'AI platform',
      detail: `${providerName} selected with ${connectionModeLabel(connectionMode).toLowerCase()}.`,
      kind: 'done',
    },
  ];

  if (connectionMode === 'api') {
    const cloudProvider = activeCloudProvider;
    const credentialChange = cloudProvider ? credentials[cloudProvider.id] : undefined;
    const hasCredential = Boolean(cloudProvider && (
      settings.credentialSources[cloudProvider.id] === 'saved'
      || settings.credentialSources[cloudProvider.id] === 'environment'
      || (typeof credentialChange === 'string' && credentialChange.trim())
    ));
    steps.push({
      label: 'API key',
      detail: !settings.encryptionAvailable
        ? 'OS keychain encryption is unavailable, so Octave cannot save API keys yet.'
        : hasCredential ? `${cloudProvider?.name ?? providerName} key is ready.` : `Paste a ${cloudProvider?.name ?? providerName} key or switch to CLI login.`,
      kind: !settings.encryptionAvailable ? 'warn' : hasCredential ? 'done' : 'pending',
    });
    steps.push({
      label: 'Frontier model',
      detail: `${models[cloudProvider?.id ?? 'openai'] || activePlatform.frontierModel} selected by default.`,
      kind: 'done',
    });
  }

  if (connectionMode === 'cli') {
    const cliName = selectedCliPreset?.name ?? 'Command-line AI';
    steps.push({
      label: 'CLI installed',
      detail: !selectedCliHealth.checked
        ? `Checking for ${cliName}...`
        : selectedCliHealth.installed
          ? selectedCliHealth.needsPathRepair ? `${cliName} is installed; use Repair PATH for terminal parity.` : `${cliName} is installed.`
          : `${cliName} was not found. Use Open installer or choose API key.`,
      kind: !selectedCliHealth.checked ? 'pending' : selectedCliHealth.installed ? (selectedCliHealth.needsPathRepair ? 'warn' : 'done') : 'warn',
    });
    steps.push({
      label: 'Account connected',
      detail: selectedCliHealth.accountStatus === 'ok'
        ? selectedCliHealth.accountMessage || `${selectedCliPreset?.account ?? 'CLI'} account is signed in.`
        : selectedCliHealth.accountStatus === 'unknown' ? 'Click Connect account, then Validate model.' : selectedCliHealth.accountMessage || 'The CLI account needs attention.',
      kind: selectedCliHealth.accountStatus === 'ok' ? 'done' : selectedCliHealth.accountStatus === 'unknown' ? 'pending' : 'warn',
    });
    steps.push({
      label: 'Model validated',
      detail: selectedCliHealth.modelStatus === 'ok'
        ? selectedCliHealth.modelMessage || `${models.cli || selectedCliPreset?.model || activePlatform.frontierModel} is available.`
        : selectedCliHealth.modelStatus === 'unknown' ? 'Click Validate model to confirm access before chatting.' : selectedCliHealth.modelMessage || 'This model may not exist or may not be available on the account.',
      kind: selectedCliHealth.modelStatus === 'ok' ? 'done' : selectedCliHealth.modelStatus === 'unknown' ? 'pending' : 'warn',
    });
  }

  if (connectionMode === 'local') {
    steps.push({
      label: 'Local runtime',
      detail: `Octave will use Ollama at ${settings.ollamaBaseUrl || 'the default local URL'}.`,
      kind: 'pending',
    });
  }

  if (connectionMode === 'demo') {
    steps.push({
      label: 'Offline mode',
      detail: 'No account needed. Responses use the built-in demo provider until you connect AI.',
      kind: 'done',
    });
  }

  steps.push({
    label: 'Workspace',
    detail: workspaceReady ? 'A research folder is ready.' : 'After saving, Octave will guide you to choose a project folder.',
    kind: workspaceReady ? 'done' : 'pending',
  });

  return steps;
}

function emptyCliHealth(checked = false): CliHealth {
  return {
    checked,
    installed: false,
    path: null,
    onPath: false,
    needsPathRepair: false,
    pathDirectory: null,
    accountStatus: 'unknown',
    accountMessage: '',
    modelStatus: 'unknown',
    modelMessage: '',
  };
}

function cliHealthMessage(preset: typeof CLI_PRESETS[number] | undefined, health: CliHealth): string {
  const name = preset?.name ?? 'CLI';
  if (!health.installed) return missingCliMessage(preset);
  if (health.needsPathRepair) {
    return `${name} is installed, and Octave can use it, but its folder is not on your Windows PATH yet.`;
  }
  return `${name} is installed and available on PATH.`;
}

function cliReadinessMessage(health: CliHealth): string {
  const account = health.accountStatus === 'ok'
    ? 'Account ready'
    : health.accountStatus === 'unknown' ? 'Account not checked' : 'Account needs attention';
  const model = health.modelStatus === 'ok'
    ? 'Model ready'
    : health.modelStatus === 'unknown' ? 'Model not checked' : 'Model needs attention';
  return `${account}. ${model}.`;
}

function cliReadinessKind(health: CliHealth): 'ok' | 'warn' {
  return health.accountStatus === 'ok' && health.modelStatus === 'ok' ? 'ok' : 'warn';
}

function ModelSelect({
  choices,
  onChange,
  providerLabel,
  value,
}: {
  choices: ModelChoice[];
  onChange: (value: string) => void;
  providerLabel: string;
  value: string;
}) {
  const hasChoices = choices.length > 0;
  const selectedChoice = choices.find((choice) => choice.id === value);
  const isCustom = hasChoices && !selectedChoice;

  if (!hasChoices) {
    return <input value={value} onChange={(event) => onChange(event.target.value)} />;
  }

  return (
    <>
      <select
        aria-label={`${providerLabel} model`}
        value={isCustom ? '__custom__' : value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === '__custom__') {
            onChange('');
            return;
          }
          onChange(nextValue);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.detail ? `${choice.name} — ${choice.detail}` : choice.name}
          </option>
        ))}
        <option value="__custom__">Custom model…</option>
      </select>
      {isCustom && (
        <input
          aria-label={`${providerLabel} custom model`}
          value={value}
          placeholder="Enter custom model ID"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  );
}

function findCliPreset(command: string, args: string): typeof CLI_PRESETS[number] {
  const customPreset = CLI_PRESETS.find((preset) => preset.id === 'custom');
  if (!customPreset) throw new Error('Custom CLI preset is missing.');
  return CLI_PRESETS.find((preset) => preset.command === command && preset.args === args)
    ?? CLI_PRESETS.find((preset) => preset.command === command)
    ?? customPreset;
}

function cliInstallLabel(status: CliInstallStatus[CliPresetId]): string {
  if (!status.checked) return 'Checking install...';
  return status.installed ? 'Installed' : 'Not found';
}

function missingCliMessage(preset?: typeof CLI_PRESETS[number]): string {
  if (!preset) return 'This command was not found on PATH. Install it or choose API key instead.';
  return `${preset.name} is not installed or is not on PATH. Install it, then restart Octave or choose API key instead.`;
}

function findPlatform(id: PlatformId): PlatformOption {
  const platform = PLATFORMS.find((candidate) => candidate.id === id);
  if (!platform) throw new Error('Unknown AI platform.');
  return platform;
}

function findCliPresetById(id: Exclude<CliPresetId, 'custom'>): typeof CLI_PRESETS[number] {
  const preset = CLI_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error('Unknown CLI preset.');
  return preset;
}

function connectionModesFor(platform: PlatformOption): ConnectionMode[] {
  const modes: ConnectionMode[] = [];
  if (platform.apiProvider) modes.push('api');
  if (platform.cliPreset) modes.push('cli');
  if (platform.localProvider) modes.push('local');
  if (platform.demoProvider) modes.push('demo');
  return modes;
}

function defaultConnectionMode(platform: PlatformOption, preferred: ConnectionMode): ConnectionMode {
  const modes = connectionModesFor(platform);
  return modes.includes(preferred) ? preferred : modes[0] ?? 'demo';
}

function connectionModeLabel(mode: ConnectionMode): string {
  if (mode === 'api') return 'API key';
  if (mode === 'cli') return 'CLI login';
  if (mode === 'local') return 'Local';
  return 'Demo';
}

function inferPlatformSelection(defaultProvider: DesktopProviderId, cliPresetId: CliPresetId): { platform: PlatformOption; mode: ConnectionMode } {
  if (defaultProvider === 'cli') {
    const platform = PLATFORMS.find((candidate) => candidate.cliPreset === cliPresetId)
      ?? PLATFORMS.find((candidate) => candidate.cliPreset === 'codex');
    if (platform) return { platform, mode: 'cli' };
  }

  const platform = PLATFORMS.find((candidate) => candidate.apiProvider === defaultProvider)
    ?? PLATFORMS.find((candidate) => candidate.localProvider === defaultProvider)
    ?? PLATFORMS.find((candidate) => candidate.demoProvider === defaultProvider)
    ?? PLATFORMS[0];
  if (!platform) throw new Error('No AI platforms are configured.');

  if (platform.apiProvider === defaultProvider) return { platform, mode: 'api' };
  if (platform.localProvider === defaultProvider) return { platform, mode: 'local' };
  if (platform.demoProvider === defaultProvider) return { platform, mode: 'demo' };
  return { platform, mode: defaultConnectionMode(platform, 'api') };
}
