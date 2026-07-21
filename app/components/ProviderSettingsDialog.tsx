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

const CLI_PRESETS: Array<{
  id: CliPresetId;
  name: string;
  command: string;
  args: string;
  setupArgs: string;
  model: string;
  detail: string;
}> = [
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: 'exec -',
    setupArgs: '',
    model: 'gpt-5.6-sol',
    detail: 'OpenAI account through the Codex CLI',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: '-p',
    setupArgs: '',
    model: 'sonnet',
    detail: 'Anthropic account through Claude Code',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: '-p {prompt}',
    setupArgs: '',
    model: 'gemini',
    detail: 'Google account through Gemini CLI',
  },
  {
    id: 'custom',
    name: 'Custom CLI',
    command: '',
    args: '',
    setupArgs: '',
    model: 'cli',
    detail: 'Any executable that prints an assistant response',
  },
];

const PROVIDERS: Array<{ id: DesktopProviderId; name: string; detail: string }> = [
  { id: 'openai', name: 'OpenAI', detail: 'GPT and o-series models' },
  { id: 'xai', name: 'Grok (xAI)', detail: 'Grok language models' },
  { id: 'anthropic', name: 'Claude (Anthropic)', detail: 'Claude language models' },
  { id: 'cli', name: 'Command-line AI', detail: 'Use an installed AI CLI through stdin or arguments' },
  { id: 'ollama', name: 'Ollama', detail: 'Models running on this computer or your network' },
  { id: 'demo', name: 'Offline demo', detail: 'Explore Octave without an AI account' },
];

const CLOUD_PROVIDERS: Array<{ id: DesktopCloudProviderId; name: string; keyLabel: string }> = [
  { id: 'openai', name: 'OpenAI', keyLabel: 'OpenAI API key' },
  { id: 'xai', name: 'Grok (xAI)', keyLabel: 'xAI API key' },
  { id: 'anthropic', name: 'Claude (Anthropic)', keyLabel: 'Anthropic API key' },
];

export function ProviderSettingsDialog({
  open,
  settings,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: DesktopProviderSettings;
  saving: boolean;
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
  const [cliStatus, setCliStatus] = useState('');
  const [cliStatusKind, setCliStatusKind] = useState<'idle' | 'ok' | 'warn' | 'error'>('idle');
  const [credentials, setCredentials] = useState<DesktopProviderSettingsInput['credentials']>({});
  const [problem, setProblem] = useState('');

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
    setCliStatus('');
    setCliStatusKind('idle');
    setCredentials({});
    setProblem('');
  }, [open, settings]);

  if (!open) return null;

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

  function chooseCliPreset(value: CliPresetId): void {
    const preset = CLI_PRESETS.find((candidate) => candidate.id === value) ?? CLI_PRESETS.at(-1);
    if (!preset) return;
    setCliPresetId(preset.id);
    setCliStatus('');
    setCliStatusKind('idle');
    setCliCommand(preset.command);
    setCliArgs(preset.args);
    setCliSetupArgs(preset.setupArgs);
    updateModel('cli', preset.model);
  }

  async function checkCli(): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to check local CLI tools.');
      setCliStatusKind('warn');
      return;
    }
    setCliStatus('Checking...');
    setCliStatusKind('idle');
    try {
      const result = await window.octaveDesktop.checkCliProvider({ command: cliCommand });
      setCliStatus(result.installed
        ? `Installed${result.path ? ` at ${result.path}` : ''}`
        : 'Not installed or not on PATH');
      setCliStatusKind(result.installed ? 'ok' : 'warn');
    } catch (error) {
      setCliStatus(error instanceof Error ? error.message : String(error));
      setCliStatusKind('error');
    }
  }

  async function launchCliSetup(): Promise<void> {
    if (!window.octaveDesktop) {
      setCliStatus('Open the desktop app to launch CLI sign-in.');
      setCliStatusKind('warn');
      return;
    }
    setCliStatus('Opening sign-in terminal...');
    setCliStatusKind('idle');
    try {
      await window.octaveDesktop.launchCliProviderSetup({ command: cliCommand, args: cliSetupArgs });
      setCliStatus('Sign-in terminal opened. Finish setup there, then save and restart Octave.');
      setCliStatusKind('ok');
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
            <section className="settings-section">
              <label className="settings-field">
                <span>Default provider</span>
                <select value={defaultProvider} onChange={(event) => setDefaultProvider(event.target.value as DesktopProviderId)}>
                  {PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name} - {provider.detail}</option>
                  ))}
                </select>
              </label>
            </section>

            <section className="settings-section">
              <div className="settings-section-heading">
                <div><h3>Cloud providers</h3><p>Paste a key only when adding or replacing it. Saved keys are never returned to this interface.</p></div>
                <span className={`secure-storage-status ${settings.encryptionAvailable ? 'available' : ''}`}>
                  {settings.encryptionAvailable ? 'OS encryption ready' : 'Encryption unavailable'}
                </span>
              </div>
              <div className="provider-settings-list">
                {CLOUD_PROVIDERS.map((provider) => {
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
                        <input value={models[provider.id]} onChange={(event) => updateModel(provider.id, event.target.value)} />
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

            <section className="settings-section local-provider-settings">
              <div className="settings-section-heading"><div><h3>Local Ollama</h3><p>Use the default local service or another Ollama host you control.</p></div></div>
              <div className="settings-field-grid">
                <label className="settings-field"><span>Server URL</span><input value={ollamaBaseUrl} onChange={(event) => setOllamaBaseUrl(event.target.value)} /></label>
                <label className="settings-field"><span>Preferred model</span><input value={models.ollama} onChange={(event) => updateModel('ollama', event.target.value)} /></label>
              </div>
            </section>

            <section className="settings-section local-provider-settings">
              <div className="settings-section-heading"><div><h3>Command-line AI</h3><p>Use an installed CLI. Put {'{prompt}'} in args to pass the prompt as an argument; otherwise Octave writes it to stdin.</p></div></div>
              <label className="settings-field settings-field-spaced">
                <span>Choose CLI</span>
                <select value={cliPresetId} onChange={(event) => chooseCliPreset(event.target.value as CliPresetId)}>
                  {CLI_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} - {preset.detail}</option>)}
                </select>
              </label>
              <div className="settings-field-grid">
                <label className="settings-field"><span>Command</span><input value={cliCommand} placeholder="codex" onChange={(event) => setCliCommand(event.target.value)} /></label>
                <label className="settings-field"><span>Preferred model</span><input value={models.cli} onChange={(event) => updateModel('cli', event.target.value)} /></label>
              </div>
              <label className="settings-field settings-field-spaced"><span>Arguments</span><input value={cliArgs} placeholder="exec --model gpt-5.6-sol -" onChange={(event) => setCliArgs(event.target.value)} /></label>
              <div className="settings-field-grid settings-field-spaced">
                <label className="settings-field"><span>Sign-in command</span><input value={cliSetupArgs} placeholder="login" onChange={(event) => setCliSetupArgs(event.target.value)} /></label>
                <div className="cli-setup-actions">
                  <button className="button button-secondary" type="button" onClick={() => void checkCli()} disabled={saving || !cliCommand.trim()}>Check installed</button>
                  <button className="button button-secondary" type="button" onClick={() => void launchCliSetup()} disabled={saving || !cliCommand.trim()}>Sign in...</button>
                </div>
              </div>
              {cliStatus && <p className={`cli-setup-status ${cliStatusKind}`}>{cliStatus}</p>}
            </section>

            {problem && <div className="settings-error" role="alert">{problem}</div>}
          </div>

          <footer className="settings-footer">
            <p>Keys and local provider settings are passed only to Octave's private local server. Saved API keys are encrypted through your operating system account.</p>
            <div>
              {!settings.firstRun && <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>}
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving and restarting...' : settings.firstRun ? 'Save and open Octave' : 'Save and restart'}
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

function findCliPreset(command: string, args: string): typeof CLI_PRESETS[number] {
  const customPreset = CLI_PRESETS.find((preset) => preset.id === 'custom');
  if (!customPreset) throw new Error('Custom CLI preset is missing.');
  return CLI_PRESETS.find((preset) => preset.command === command && preset.args === args)
    ?? CLI_PRESETS.find((preset) => preset.command === command)
    ?? customPreset;
}
