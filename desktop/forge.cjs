const path = require('node:path');
const { api } = require('@electron-forge/core');

const command = process.argv[2];
const projectDirectory = path.join(__dirname, 'app');

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  if (command === 'package') {
    await api.package({ dir: projectDirectory, interactive: true });
    return;
  }
  if (command === 'make') {
    await api.make({ dir: projectDirectory, interactive: true });
    return;
  }
  throw new Error('Desktop Forge command must be "package" or "make".');
}
