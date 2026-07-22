const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const INSTALL_COMMANDS = Object.freeze({
  claude: 'irm https://claude.ai/install.ps1 | iex',
  codex: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
  gemini: 'npm install -g @google/gemini-cli',
});

async function resolveExecutable(command, environment = process.env) {
  const normalized = normalizeCommand(command);
  if (!normalized) return null;
  if (path.isAbsolute(normalized) || normalized.includes(path.sep) || (path.sep === '\\' && normalized.includes('/'))) {
    return (await isFile(normalized)) ? normalized : null;
  }

  const directories = String(environment.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, hasExtension(normalized, extensions) ? normalized : `${normalized}${extension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
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
  const installCommand = INSTALL_COMMANDS[preset];
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
  launchCliInstall,
  launchCliSetup,
  parseShellWords,
  resolveExecutable,
};
