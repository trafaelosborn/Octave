const fs = require('node:fs/promises');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const standaloneRoot = path.join(repositoryRoot, '.next', 'standalone');
const runtimeRoot = path.join(__dirname, 'app', 'runtime');

void prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function prepare() {
  const serverFile = path.join(standaloneRoot, 'server.js');
  try {
    await fs.access(serverFile);
  } catch {
    throw new Error('Next standalone output is missing. Run npm run build before preparing the desktop runtime.');
  }

  assertGeneratedRuntime(runtimeRoot);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.cp(standaloneRoot, runtimeRoot, { recursive: true });
  await fs.cp(path.join(repositoryRoot, '.next', 'static'), path.join(runtimeRoot, '.next', 'static'), { recursive: true });

  const publicDirectory = path.join(repositoryRoot, 'public');
  try {
    await fs.cp(publicDirectory, path.join(runtimeRoot, 'public'), { recursive: true });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  console.log(`Prepared Electron runtime at ${runtimeRoot}`);
}

function assertGeneratedRuntime(target) {
  const expected = path.join(repositoryRoot, 'desktop', 'app', 'runtime');
  if (path.resolve(target) !== expected || path.dirname(target) === repositoryRoot) {
    throw new Error('Refusing to replace an unexpected desktop runtime directory.');
  }
}
