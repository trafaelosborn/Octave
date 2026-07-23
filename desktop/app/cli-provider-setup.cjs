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
  const onPath = await resolveExecutableFromPath(command, environment, environment);
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
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$directory = $args[0]',
        '$current = [Environment]::GetEnvironmentVariable("Path", "User")',
        '$entries = @()',
        'if ($current) { $entries = $current -split [IO.Path]::PathSeparator | Where-Object { $_ } }',
        '$exists = $entries | Where-Object { $_.TrimEnd("\\", "/").ToLowerInvariant() -eq $directory.TrimEnd("\\", "/").ToLowerInvariant() }',
        'if (-not $exists) { $entries += $directory }',
        '[Environment]::SetEnvironmentVariable("Path", ($entries -join [IO.Path]::PathSeparator), "User")',
      ].join('; '),
      normalized,
    ], { stdio: 'ignore', windowsHide: true, env: environment });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PATH repair exited with code ${code ?? 'unknown'}.`));
    });
  });
  const nextProcessPath = buildPathWithDirectory(pathEntries(environment), normalized);
  process.env.PATH = nextProcessPath;
  process.env.Path = nextProcessPath;
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
};
