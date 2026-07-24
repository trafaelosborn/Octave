const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INSTALL_COMMANDS = Object.freeze({
  claude: {
    win32: 'irm https://claude.ai/install.ps1 | iex',
    default: 'curl -fsSL https://claude.ai/install.sh | sh',
  },
  codex: {
    win32: 'irm https://chatgpt.com/codex/install.ps1 | iex',
    default: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
  },
  gemini: {
    default: 'npm install -g @google/gemini-cli',
  },
});

function augmentPathEnvironment(environment = process.env) {
  const entries = pathEntries(environment);
  const seen = new Set(entries.map((entry) => normalizePathKey(entry)));
  for (const directory of candidateCliDirectories(environment)) {
    const key = normalizePathKey(directory);
    if (!seen.has(key)) {
      entries.push(directory);
      seen.add(key);
    }
  }
  return {
    ...environment,
    PATH: entries.join(path.delimiter),
    Path: entries.join(path.delimiter),
  };
}

async function resolveExecutable(command, environment = process.env) {
  return resolveExecutableFromPath(command, augmentPathEnvironment(environment), environment);
}

async function checkCliProvider(command, environment = process.env) {
  const onPath = await resolveExecutableOnEffectivePath(command, environment);
  const resolvedPath = onPath ?? await resolveExecutable(command, environment);
  const pathDirectory = resolvedPath ? path.dirname(resolvedPath) : null;
  return {
    installed: Boolean(resolvedPath),
    path: resolvedPath,
    onPath: Boolean(onPath),
    needsPathRepair: Boolean(resolvedPath && !onPath),
    pathDirectory,
  };
}

async function resolveExecutableOnEffectivePath(command, environment = process.env) {
  const onProcessPath = await resolveExecutableFromPath(command, environment, environment);
  if (onProcessPath) return onProcessPath;
  if (process.platform !== 'win32' || environment !== process.env) return null;
  const userPath = await readWindowsUserPath(environment);
  if (!userPath) return null;
  return resolveExecutableFromPath(command, {
    ...environment,
    PATH: buildPathWithDirectory(pathEntries({ PATH: userPath }), ''),
    Path: buildPathWithDirectory(pathEntries({ PATH: userPath }), ''),
  }, environment);
}

async function validateCliProvider(input, environment = process.env) {
  const command = input && typeof input === 'object' ? input.command : '';
  const preset = input && typeof input === 'object' ? String(input.preset ?? '') : '';
  const model = input && typeof input === 'object' ? String(input.model ?? '').trim() : '';
  const health = await checkCliProvider(command, environment);
  if (!health.installed || !health.path) {
    return {
      ...health,
      accountStatus: 'unknown',
      accountMessage: 'Install the CLI before validating the account.',
      modelStatus: 'unknown',
      modelMessage: 'Install the CLI before validating a model.',
    };
  }

  if (preset === 'codex') return validateCodexCli(health.path, model, environment, health);
  if (preset === 'claude') return validatePromptCli(health.path, ['-p', '--model', model || 'sonnet', 'Reply with OK only.'], environment, health, 'Claude Code');
  if (preset === 'gemini') return validatePromptCli(health.path, ['-m', model || 'gemini-2.5-pro', '-p', 'Reply with OK only.'], environment, health, 'Gemini CLI');
  return {
    ...health,
    accountStatus: 'unknown',
    accountMessage: 'Custom CLI account validation is not available.',
    modelStatus: 'unknown',
    modelMessage: 'Custom CLI model validation is not available.',
  };
}

async function validateCodexCli(executable, model, environment, health) {
  const probe = await runCliProbe(executable, ['doctor', '--json'], environment, 20_000);
  const parsed = parseJsonObject(probe.stdout);
  const auth = parsed?.checks?.['auth.credentials'];
  const authOk = auth?.status === 'ok';
  const accountStatus = authOk ? 'ok' : 'error';
  const accountMessage = typeof auth?.summary === 'string'
    ? auth.summary
    : accountStatus === 'ok' ? 'Codex authentication is configured.' : 'Codex authentication was not confirmed.';
  if (!authOk) {
    return {
      ...health,
      accountStatus,
      accountMessage,
      modelStatus: 'unknown',
      modelMessage: 'Sign into Codex before validating a model.',
    };
  }
  if (!model) {
    return {
      ...health,
      accountStatus,
      accountMessage,
      modelStatus: 'unknown',
      modelMessage: 'Choose a model to validate.',
    };
  }
  const modelProbe = await runCliProbe(executable, ['exec', '--model', model, '-'], environment, 20_000, 'Reply with OK only.');
  return {
    ...health,
    accountStatus,
    accountMessage,
    modelStatus: modelProbe.code === 0 && modelProbe.stdout.trim() ? 'ok' : 'error',
    modelMessage: modelProbe.code === 0
      ? `${model} responded through Codex CLI.`
      : summarizeProbeFailure(modelProbe, `${model} did not validate through Codex CLI.`),
  };
}

async function validatePromptCli(executable, args, environment, health, name) {
  const probe = await runCliProbe(executable, args, environment, 20_000);
  const ok = probe.code === 0 && probe.stdout.trim();
  const message = ok
    ? `${name} account and selected model responded.`
    : summarizeProbeFailure(probe, `${name} did not validate. Connect your account or choose another model.`);
  return {
    ...health,
    accountStatus: ok ? 'ok' : 'error',
    accountMessage: message,
    modelStatus: ok ? 'ok' : 'error',
    modelMessage: message,
  };
}

async function runCliProbe(executable, args, environment, timeoutMs, stdin = '') {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: augmentPathEnvironment(environment),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: null, timedOut: true, stdout, stderr });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-16_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16_000);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, stdout, stderr: error.message });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, timedOut: false, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

async function repairCliProviderPath(command, environment = process.env) {
  const health = await checkCliProvider(command, environment);
  if (!health.installed || !health.pathDirectory) {
    throw new Error(`Command not found: ${normalizeCommand(command) || '(empty)'}`);
  }
  if (health.onPath) return { ...health, repaired: false };
  await addDirectoryToUserPath(health.pathDirectory, environment);
  return {
    ...(await checkCliProvider(command, {
      ...environment,
      PATH: buildPathWithDirectory(pathEntries(environment), health.pathDirectory),
      Path: buildPathWithDirectory(pathEntries(environment), health.pathDirectory),
    })),
    repaired: true,
  };
}

async function resolveExecutableFromPath(command, pathEnvironment, extensionEnvironment = pathEnvironment) {
  const normalized = normalizeCommand(command);
  if (!normalized) return null;
  if (path.isAbsolute(normalized) || normalized.includes(path.sep) || (path.sep === '\\' && normalized.includes('/'))) {
    return (await isFile(normalized)) ? normalized : null;
  }

  const directories = pathEntries(pathEnvironment);
  const extensions = process.platform === 'win32'
    ? String(extensionEnvironment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, hasExtension(normalized, extensions) ? normalized : `${normalized}${extension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

async function addDirectoryToUserPath(directory, environment = process.env) {
  const normalized = normalizeDirectory(directory);
  if (!normalized) throw new Error('Cannot repair PATH without an install directory.');
  if (process.platform !== 'win32') {
    throw new Error('Automatic user PATH repair is currently supported only on Windows.');
  }
  await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      buildUserPathRepairCommand(),
      normalized,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: environment });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-4_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(summarizePathRepairFailure(code, stdout, stderr)));
    });
  });
  const nextProcessPath = buildPathWithDirectory(pathEntries(environment), normalized);
  process.env.PATH = nextProcessPath;
  process.env.Path = nextProcessPath;
}

function buildUserPathRepairCommand() {
  return [
    '& {',
    'param([string] $directory)',
    "$ErrorActionPreference = 'Stop'",
    "if ([string]::IsNullOrWhiteSpace($directory)) { throw 'Cannot repair PATH without an install directory.' }",
    "$trimChars = [char[]]@('\\', '/')",
    '$directory = $directory.Trim().TrimEnd($trimChars)',
    '$current = [Environment]::GetEnvironmentVariable("Path", "User")',
    '$entries = @()',
    'if (-not [string]::IsNullOrWhiteSpace($current)) {',
    '  $entries = $current -split [IO.Path]::PathSeparator | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }',
    '}',
    '$directoryKey = $directory.TrimEnd($trimChars).ToLowerInvariant()',
    '$exists = $false',
    'foreach ($entry in $entries) {',
    '  if ($entry.TrimEnd($trimChars).ToLowerInvariant() -eq $directoryKey) { $exists = $true; break }',
    '}',
    'if (-not $exists) {',
    '  $entries += $directory',
    '  [Environment]::SetEnvironmentVariable("Path", ($entries -join [IO.Path]::PathSeparator), "User")',
    '  try {',
    "    $signature = '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'",
    "    $type = Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace OctavePathRepair -PassThru",
    '    $result = [UIntPtr]::Zero',
    "    [void] $type::SendMessageTimeout([IntPtr] 0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref] $result)",
    '  } catch { }',
    '}',
    '}',
  ].join('\n');
}

async function readWindowsUserPath(environment = process.env) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '[Environment]::GetEnvironmentVariable("Path", "User")',
    ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: environment });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-16_000);
    });
    child.once('error', () => resolve(''));
    child.once('exit', (code) => {
      resolve(code === 0 ? stdout.trim() : '');
    });
  });
}

function summarizePathRepairFailure(code, stdout, stderr) {
  const detail = (stderr || stdout || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  const suffix = detail ? ` ${detail}` : '';
  return `PATH repair exited with code ${code ?? 'unknown'}.${suffix}`;
}

async function launchCliSetup({ command, args }) {
  const executable = await resolveExecutable(command);
  if (!executable) throw new Error(`Command not found: ${normalizeCommand(command) || '(empty)'}`);
  const parsedArgs = parseShellWords(args ?? '');

  if (process.platform === 'win32') {
    const commandLine = [executable, ...parsedArgs].map(quotePowerShellArgument).join(' ');
    openWindowsTerminal(['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${commandLine}`]);
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', executable, ...parsedArgs], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const terminal = await resolveFirstExecutable(['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
  if (!terminal) throw new Error('No supported terminal emulator was found.');
  spawn(terminal, ['-e', executable, ...parsedArgs], { detached: true, stdio: 'ignore' }).unref();
}

async function launchCliInstall({ preset }) {
  const installCommand = installCommandFor(preset);
  if (!installCommand) throw new Error('Choose a supported CLI installer.');

  if (process.platform === 'win32') {
    openWindowsTerminal(['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installCommand]);
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', 'sh', '-lc', installCommand], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const terminal = await resolveFirstExecutable(['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
  if (!terminal) throw new Error('No supported terminal emulator was found.');
  spawn(terminal, ['-e', 'sh', '-lc', installCommand], { detached: true, stdio: 'ignore' }).unref();
}

function installCommandFor(preset, platform = process.platform) {
  const command = INSTALL_COMMANDS[preset];
  if (!command) return '';
  return command[platform] ?? command.default ?? '';
}

function parseShellWords(input) {
  const words = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of String(input ?? '')) {
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
  if (quote !== null) throw new Error('CLI setup arguments contain an unterminated quote.');
  if (current) words.push(current);
  return words;
}

function parseJsonObject(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function summarizeProbeFailure(probe, fallback) {
  if (probe.timedOut) return `${fallback} The validation timed out.`;
  const detail = (probe.stderr || probe.stdout || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  return detail ? `${fallback} ${detail}` : fallback;
}

function normalizeCommand(command) {
  if (typeof command !== 'string') return '';
  const normalized = command.trim();
  if (normalized.length > 2_000) throw new Error('CLI command is too long.');
  if (/[\r\n]/.test(normalized)) throw new Error('CLI command must fit on one line.');
  return normalized;
}

function quotePowerShellArgument(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function openWindowsTerminal(powershellArgs) {
  spawn('cmd.exe', ['/d', '/s', '/c', 'start', 'Octave CLI setup', 'powershell.exe', ...powershellArgs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function hasExtension(command, extensions) {
  const lower = command.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension.toLowerCase()));
}

function pathEntries(environment) {
  return String(environment.PATH ?? environment.Path ?? '').split(path.delimiter).filter(Boolean);
}

function buildPathWithDirectory(entries, directory) {
  const normalized = normalizeDirectory(directory);
  if (!normalized) return entries.join(path.delimiter);
  const nextEntries = entries.filter(Boolean);
  const seen = new Set(nextEntries.map((entry) => normalizePathKey(entry)));
  if (!seen.has(normalizePathKey(normalized))) nextEntries.push(normalized);
  return nextEntries.join(path.delimiter);
}

function candidateCliDirectories(environment) {
  const home = environment.USERPROFILE ?? environment.HOME;
  const localAppData = environment.LOCALAPPDATA;
  const appData = environment.APPDATA;
  return [
    home ? path.join(home, '.local', 'bin') : '',
    home ? path.join(home, '.claude', 'local') : '',
    home ? path.join(home, '.codex', 'bin') : '',
    home ? path.join(home, '.gemini', 'bin') : '',
    appData ? path.join(appData, 'npm') : '',
    localAppData ? path.join(localAppData, 'npm') : '',
    ...(home ? discoverVscodeCodexDirectories(home) : []),
    localAppData ? path.join(localAppData, 'Programs', 'Claude', 'bin') : '',
    localAppData ? path.join(localAppData, 'Programs', 'Claude Code', 'bin') : '',
  ].filter(Boolean);
}

function discoverVscodeCodexDirectories(home) {
  const extensionRoots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
  ];
  const directories = [];
  for (const root of extensionRoots) {
    try {
      for (const entry of fsSync.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('openai.chatgpt-')) continue;
        directories.push(path.join(root, entry.name, 'bin', process.platform === 'win32' ? 'windows-x86_64' : process.platform));
      }
    } catch {
      // Missing VS Code extension folders are normal.
    }
  }
  return directories;
}

function normalizePathKey(value) {
  const normalized = normalizeDirectory(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeDirectory(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\\/]+$/, '');
}

async function resolveFirstExecutable(commands) {
  for (const command of commands) {
    const resolved = await resolveExecutable(command);
    if (resolved) return resolved;
  }
  return null;
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

module.exports = {
  INSTALL_COMMANDS,
  augmentPathEnvironment,
  buildPathWithDirectory,
  checkCliProvider,
  installCommandFor,
  launchCliInstall,
  launchCliSetup,
  parseShellWords,
  repairCliProviderPath,
  resolveExecutable,
  validateCliProvider,
};
