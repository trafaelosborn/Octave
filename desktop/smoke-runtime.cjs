const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findOpenPort, waitForHttp } = require('./app/runtime-utils.cjs');

void smoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function smoke() {
  const runtimeDirectory = path.join(__dirname, 'app', 'runtime');
  const serverFile = path.join(runtimeDirectory, 'server.js');
  await fs.access(serverFile);
  const configDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-desktop-smoke-'));
  const port = await findOpenPort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [serverFile], {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      OCTAVE_CONFIG_DIR: configDirectory,
      PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8_000);
  });

  try {
    await waitForHttp(`${origin}/api/providers`, 30_000);
    const response = await fetch(`${origin}/api/providers`);
    const payload = await response.json();
    if (!response.ok || !payload || !Array.isArray(payload.providers)) {
      throw new Error('Packaged provider API returned an invalid response.');
    }
    console.log(`Desktop runtime smoke test passed with ${payload.providers.length} providers.`);
  } catch (error) {
    throw new Error([error instanceof Error ? error.message : String(error), stderr.trim()].filter(Boolean).join('\n\n'));
  } finally {
    server.kill();
    await removeTemporaryDirectory(configDirectory);
  }
}

async function removeTemporaryDirectory(directory) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  const relative = path.relative(temporaryRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove an unexpected smoke-test directory.');
  }
  await fs.rm(resolved, { recursive: true, force: true });
}
