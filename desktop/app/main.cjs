const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require('electron');
const {
  createProviderSettingsStore,
  createSafeStorageEncryption,
} = require('./provider-settings.cjs');
const {
  augmentPathEnvironment,
  launchCliInstall,
  launchCliSetup,
  resolveExecutable,
} = require('./cli-provider-setup.cjs');
const {
  findOpenPort,
  isSafeExternalUrl,
  isTrustedAppUrl,
  waitForHttp,
} = require('./runtime-utils.cjs');

const singleInstance = app.requestSingleInstanceLock();
let mainWindow = null;
let serverProcess = null;
let serverProcessIsTree = false;
let providerSettingsStore = null;
let appOrigin = '';
let quitting = false;
let recentServerError = '';

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktop).catch(async (error) => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Octave could not start',
      message: 'Octave could not start its local research workspace.',
      detail: error instanceof Error ? error.message : String(error),
    });
    app.quit();
  });
}

async function startDesktop() {
  providerSettingsStore = createProviderSettingsStore({
    filePath: path.join(app.getPath('userData'), 'provider-settings.json'),
    encryption: createSafeStorageEncryption(safeStorage),
  });
  registerDesktopBridge();
  const appUrl = await startLocalApplication();
  appOrigin = new URL(appUrl).origin;
  mainWindow = createMainWindow(appUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(appUrl);
  });
}

async function startLocalApplication() {
  if (!providerSettingsStore) throw new Error('Provider settings are not ready.');
  recentServerError = '';
  const providerEnvironment = await providerSettingsStore.getEnvironment();
  const port = await findOpenPort();
  const url = `http://127.0.0.1:${port}`;
  const configDirectory = path.join(app.getPath('userData'), 'state');
  const serverEnvironment = augmentPathEnvironment({
    ...process.env,
    ...providerEnvironment,
    HOSTNAME: '127.0.0.1',
    OCTAVE_CONFIG_DIR: configDirectory,
    OCTAVE_DESKTOP: '1',
    PORT: String(port),
  });
  const developmentRoot = process.env.OCTAVE_DESKTOP_PROJECT_ROOT?.trim();
  if (developmentRoot) {
    if (!path.isAbsolute(developmentRoot)) throw new Error('OCTAVE_DESKTOP_PROJECT_ROOT must be absolute.');
    serverProcessIsTree = true;
    serverProcess = process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', [
        '/d', '/s', '/c', `npm.cmd run dev:web -- --port ${port}`,
      ], {
        cwd: developmentRoot,
        env: serverEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      : spawn('npm', ['run', 'dev:web', '--', '--port', String(port)], {
        cwd: developmentRoot,
        detached: true,
        env: serverEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  } else {
    const runtimeDirectory = path.join(process.resourcesPath, 'runtime');
    const serverFile = path.join(runtimeDirectory, 'server.js');
    serverProcessIsTree = false;
    serverProcess = spawn(process.execPath, [serverFile], {
      cwd: runtimeDirectory,
      env: {
        ...serverEnvironment,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
  }
  const child = serverProcess;
  if (developmentRoot) {
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  }
  serverProcess.stderr?.on('data', (chunk) => {
    recentServerError = `${recentServerError}${String(chunk)}`.slice(-8_000);
  });
  child.once('exit', (code) => {
    const wasActiveServer = serverProcess === child;
    if (wasActiveServer) serverProcess = null;
    if (wasActiveServer && !quitting && code !== 0) {
      dialog.showErrorBox('Octave server stopped', recentServerError || `The local server exited with code ${code}.`);
      app.quit();
    }
  });
  child.once('error', (error) => {
    recentServerError = error.message;
  });
  try {
    await waitForHttp(url);
  } catch (error) {
    const detail = recentServerError.trim();
    await stopLocalServer();
    throw new Error([error instanceof Error ? error.message : String(error), detail].filter(Boolean).join('\n\n'));
  }
  return url;
}

function createMainWindow(appUrl) {
  const window = new BrowserWindow({
    title: 'Octave',
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#17201d',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  });
  window.removeMenu();
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedAppUrl(targetUrl, appOrigin)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void window.loadURL(appUrl).catch((error) => {
    dialog.showErrorBox('Octave could not open', error.message);
  });
  return window;
}

function registerDesktopBridge() {
  ipcMain.handle('octave:pick-workspace', async (event) => {
    assertTrustedDesktopSender(event);
    const pickerOptions = {
      title: 'Choose an Octave research workspace',
      buttonLabel: 'Open workspace',
      properties: ['openDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, pickerOptions)
      : await dialog.showOpenDialog(pickerOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('octave:get-provider-settings', async (event) => {
    assertTrustedDesktopSender(event);
    if (!providerSettingsStore) throw new Error('Provider settings are not ready.');
    return providerSettingsStore.getPublicSettings();
  });
  ipcMain.handle('octave:save-provider-settings', async (event, input) => {
    assertTrustedDesktopSender(event);
    if (!providerSettingsStore) throw new Error('Provider settings are not ready.');
    const settings = await providerSettingsStore.save(input);
    setTimeout(() => void relaunchDesktop().catch((error) => {
      quitting = false;
      dialog.showErrorBox('Octave could not restart', error instanceof Error ? error.message : String(error));
    }), 150);
    return settings;
  });
  ipcMain.handle('octave:check-cli-provider', async (event, input) => {
    assertTrustedDesktopSender(event);
    const command = input && typeof input === 'object' ? input.command : '';
    const resolvedPath = await resolveExecutable(command);
    return { installed: Boolean(resolvedPath), path: resolvedPath };
  });
  ipcMain.handle('octave:launch-cli-provider-setup', async (event, input) => {
    assertTrustedDesktopSender(event);
    await launchCliSetup(input);
    return { launched: true };
  });
  ipcMain.handle('octave:install-cli-provider', async (event, input) => {
    assertTrustedDesktopSender(event);
    await launchCliInstall(input);
    return { launched: true };
  });
}

function assertTrustedDesktopSender(event) {
  if (!appOrigin || !isTrustedAppUrl(event.senderFrame?.url ?? '', appOrigin)) {
    throw new Error('This desktop action is available only inside Octave.');
  }
}

async function relaunchDesktop() {
  quitting = true;
  await stopLocalServer();
  app.relaunch();
  app.exit(0);
}

async function stopLocalServer() {
  const child = serverProcess;
  const isTree = serverProcessIsTree;
  serverProcess = null;
  serverProcessIsTree = false;
  if (!child || child.killed || !child.pid) return;

  if (process.platform === 'win32' && isTree) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
    return;
  }

  if (isTree && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Fall through to terminating the direct child.
    }
  }
  child.kill();
}

app.on('before-quit', () => {
  quitting = true;
  void stopLocalServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
