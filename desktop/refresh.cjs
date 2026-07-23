const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { api } = require('@electron-forge/core');

const repositoryRoot = path.resolve(__dirname, '..');
const desktopAppDirectory = path.join(__dirname, 'app');
const currentOutDirectory = path.join(desktopAppDirectory, 'current');
const packagedDirectory = path.join(currentOutDirectory, 'Octave-win32-x64');
const packagedExecutable = path.join(packagedDirectory, 'Octave.exe');

void refresh().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function refresh() {
  const shouldLaunch = !process.argv.includes('--no-launch');
  await stopPackagedOctave(packagedDirectory);
  await run('npm.cmd', ['run', 'desktop:prepare'], repositoryRoot);
  await api.package({ dir: desktopAppDirectory, outDir: currentOutDirectory, interactive: true });
  await fs.access(packagedExecutable);
  await createDesktopShortcut(packagedExecutable);
  await run('npm.cmd', ['run', 'desktop:smoke'], repositoryRoot);
  if (shouldLaunch) await launchViaExplorer(await desktopShortcutPath());
  console.log(`Octave desktop package refreshed at ${packagedExecutable}`);
}

async function stopPackagedOctave(targetDirectory) {
  if (process.platform !== 'win32') return;
  const script = [
    '$target = $env:OCTAVE_REFRESH_TARGET',
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$target*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], repositoryRoot, {
    ...process.env,
    OCTAVE_REFRESH_TARGET: targetDirectory,
  });
}

async function createDesktopShortcut(target) {
  if (process.platform !== 'win32') return;
  const shortcutPath = await desktopShortcutPath();
  const workingDirectory = path.dirname(target);
  const script = [
    '$shortcutPath = $env:OCTAVE_SHORTCUT_PATH',
    '$target = $env:OCTAVE_SHORTCUT_TARGET',
    '$workingDirectory = $env:OCTAVE_SHORTCUT_WORKING_DIRECTORY',
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath = $target',
    '$shortcut.WorkingDirectory = $workingDirectory',
    '$shortcut.IconLocation = $target',
    "$shortcut.Description = 'Octave research workstation'",
    '$shortcut.Save()',
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], repositoryRoot, {
    ...process.env,
    OCTAVE_SHORTCUT_PATH: shortcutPath,
    OCTAVE_SHORTCUT_TARGET: target,
    OCTAVE_SHORTCUT_WORKING_DIRECTORY: workingDirectory,
  });
}

async function desktopShortcutPath() {
  if (process.platform !== 'win32') return '';
  const output = await capture('powershell.exe', ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")']);
  return path.join(output.trim(), 'Octave.lnk');
}

async function launchViaExplorer(shortcutPath) {
  if (process.platform !== 'win32') return;
  await spawnDetached('explorer.exe', [shortcutPath]);
}

async function run(command, args, cwd = repositoryRoot, env = process.env) {
  await new Promise((resolve, reject) => {
    const invocation = command.toLowerCase().endsWith('.cmd')
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
      : { command, args };
    const child = spawn(invocation.command, invocation.args, { cwd, env: cleanEnvironment(env), stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function cleanEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter((entry) => typeof entry[1] === 'string'));
}

async function capture(command, args, cwd = repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function spawnDetached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
