const { spawn } = require('node:child_process');
const electronBinary = require('electron');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronProcess = spawn(electronBinary, [path.join(__dirname, 'app')], {
  cwd: projectRoot,
  env: { ...process.env, OCTAVE_DESKTOP_PROJECT_ROOT: projectRoot },
  stdio: 'inherit',
  windowsHide: true,
});

electronProcess.once('exit', (code) => {
  process.exitCode = code ?? 0;
});

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

function stop(code) {
  process.exitCode = code;
  if (electronProcess.killed || !electronProcess.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(electronProcess.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    electronProcess.kill('SIGTERM');
  }
}
