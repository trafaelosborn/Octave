const { spawn } = require('node:child_process');
const electronBinary = require('electron');
const path = require('node:path');
const { findOpenPort } = require('./app/runtime-utils.cjs');

let webProcess = null;
let electronProcess = null;
let stopping = false;

void start().catch((error) => {
  console.error(error);
  stop(1);
});

async function start() {
  const port = await findOpenPort();
  const appUrl = `http://127.0.0.1:${port}`;
  webProcess = startWebServer(port);
  electronProcess = spawn(electronBinary, [path.join(__dirname, 'app')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, OCTAVE_DESKTOP_URL: appUrl },
    stdio: 'inherit',
    windowsHide: true,
  });
  electronProcess.once('exit', (code) => stop(code ?? 0));
  webProcess.once('exit', (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}

function startWebServer(port) {
  const cwd = path.resolve(__dirname, '..');
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', [
      '/d', '/s', '/c', `npm.cmd run dev:web -- --port ${port}`,
    ], { cwd, stdio: 'inherit', windowsHide: true });
  }
  return spawn('npm', ['run', 'dev:web', '--', '--port', String(port)], {
    cwd,
    detached: true,
    stdio: 'inherit',
  });
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
  if (webProcess && !webProcess.killed) terminateTree(webProcess);
  process.exitCode = code;
}

function terminateTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));
