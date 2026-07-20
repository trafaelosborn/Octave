const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} = require('electron');
const {
  findOpenPort,
  isSafeExternalUrl,
  isTrustedAppUrl,
  waitForHttp,
} = require('./runtime-utils.cjs');

const singleInstance = app.requestSingleInstanceLock();
let mainWindow = null;
let serverProcess = null;
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
  registerDesktopBridge();
  const appUrl = await startLocalApplication();
  appOrigin = new URL(appUrl).origin;
  mainWindow = createMainWindow(appUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(appUrl);
  });
}

async function startLocalApplication() {
  const developmentUrl = process.env.OCTAVE_DESKTOP_URL?.trim();
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      throw new Error('OCTAVE_DESKTOP_URL must use local HTTP.');
    }
    await waitForHttp(parsed.toString());
    return parsed.toString();
  }

  const runtimeDirectory = path.join(process.resourcesPath, 'runtime');
  const serverFile = path.join(runtimeDirectory, 'server.js');
  const port = await findOpenPort();
  const url = `http://127.0.0.1:${port}`;
  const configDirectory = path.join(app.getPath('userData'), 'state');
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      OCTAVE_CONFIG_DIR: configDirectory,
      OCTAVE_DESKTOP: '1',
      PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stderr?.on('data', (chunk) => {
    recentServerError = `${recentServerError}${String(chunk)}`.slice(-8_000);
  });
  serverProcess.once('exit', (code) => {
    serverProcess = null;
    if (!quitting && code !== 0) {
      dialog.showErrorBox('Octave server stopped', recentServerError || `The local server exited with code ${code}.`);
      app.quit();
    }
  });
  serverProcess.once('error', (error) => {
    recentServerError = error.message;
  });
  try {
    await waitForHttp(url);
  } catch (error) {
    const detail = recentServerError.trim();
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
    if (!appOrigin || !isTrustedAppUrl(event.senderFrame?.url ?? '', appOrigin)) {
      throw new Error('Workspace selection is available only inside Octave.');
    }
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
}

app.on('before-quit', () => {
  quitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
