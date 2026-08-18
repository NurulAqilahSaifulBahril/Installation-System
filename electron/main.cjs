const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const http = require('http');
const next = require('next');
const net = require('net');
const path = require('path');

const HOST = process.env.ELECTRON_HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const START_URL = process.env.ELECTRON_START_URL || `http://${HOST}:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, '..');

// Load connection settings from the bundled .env.local before Next starts.
// Next reads env files itself, but doing it explicitly means a packaged build
// cannot silently fall back to demo data because of a working-directory quirk.
function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env.local');
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim().replace(/^﻿/, '');
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Connection settings the user types into the app. Kept in userData rather than
// beside the executable, because an update replaces the program directory and
// would otherwise wipe them. Applied after loadEnvFile so a value entered by the
// user always beats a stale one baked into the build.
const CONNECTION_KEYS = [
  'PG_PROXY_URL',
  'PG_PROXY_DATABASE',
  'PG_PROXY_TOKEN',
  'PG_SOURCE_PROXY_URL',
  'PG_SOURCE_PROXY_DATABASE',
  'PG_SOURCE_PROXY_TOKEN',
];

function connectionConfigPath() {
  return path.join(app.getPath('userData'), 'connection.json');
}

function loadUserConfig() {
  try {
    const configPath = connectionConfigPath();
    if (!fs.existsSync(configPath)) {
      return;
    }

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const key of CONNECTION_KEYS) {
      const value = saved[key];
      if (typeof value === 'string' && value.trim()) {
        process.env[key] = value.trim();
      }
    }
  } catch (error) {
    console.error('Could not read saved connection settings:', error);
  }
}

// A build with credentials baked into its bundled .env.local (built locally
// for hand-distribution to staff) keeps them only until the first auto-update
// replaces the program directory. Copying them into userData on first boot
// makes the zero-setup install permanent: updates wipe the bundle, not
// userData. Never overwrites a connection.json someone already saved by hand.
function seedUserConfigFromEnv() {
  try {
    const configPath = connectionConfigPath();
    if (fs.existsSync(configPath)) {
      return;
    }

    const values = {};
    for (const key of CONNECTION_KEYS) {
      const value = process.env[key];
      if (typeof value === 'string' && value.trim()) {
        values[key] = value.trim();
      }
    }

    // Only the operational triple is required; the source keys mirror it when
    // absent (lib/source-api.ts falls back). Half a triple is not a connection.
    if (!values.PG_PROXY_URL || !values.PG_PROXY_DATABASE || !values.PG_PROXY_TOKEN) {
      return;
    }

    fs.writeFileSync(configPath, JSON.stringify(values, null, 2), 'utf8');
  } catch (error) {
    console.error('Could not seed connection settings from the build:', error);
  }
}

loadEnvFile();
loadUserConfig();
seedUserConfigFromEnv();

let server = null;
let nextApp = null;
let mainWindow = null;
let shuttingDown = false;
let installRequested = false;
let updateDownloaded = false;

// Auto-update: checks the app-update.yml embedded at build time (points at
// the Installation-System GitHub releases feed). Downloads only happen when
// the renderer explicitly asks for one via the "Install Update" button, and
// installing quits+relaunches the app, so both are opt-in from the user.
autoUpdater.autoDownload = false;

function broadcastUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => {
  broadcastUpdate('update:status', { state: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  broadcastUpdate('update:status', { state: 'available', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  broadcastUpdate('update:status', { state: 'not-available' });
});

autoUpdater.on('download-progress', (progress) => {
  broadcastUpdate('update:status', { state: 'downloading', percent: progress.percent });
});

autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  broadcastUpdate('update:status', { state: 'downloaded', version: info.version });
  if (installRequested) {
    // (isSilent, isForceRunAfter): skip the NSIS wizard on update and relaunch
    // straight away. The installer is "assisted" so a first-time install still
    // offers a folder choice; an update belongs where the app already lives.
    autoUpdater.quitAndInstall(true, true);
  }
});

autoUpdater.on('error', (error) => {
  broadcastUpdate('update:status', {
    state: 'error',
    message: error instanceof Error ? error.message : 'Update check failed.',
  });
});

function checkForUpdates() {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.checkForUpdates().catch((error) => {
    broadcastUpdate('update:status', {
      state: 'error',
      message: error instanceof Error ? error.message : 'Update check failed.',
    });
  });
}

ipcMain.handle('update:check', () => {
  checkForUpdates();
});

ipcMain.handle('update:install', () => {
  installRequested = true;
  if (updateDownloaded) {
    autoUpdater.quitAndInstall(true, true);
    return;
  }
  autoUpdater.downloadUpdate().catch((error) => {
    broadcastUpdate('update:status', {
      state: 'error',
      message: error instanceof Error ? error.message : 'Update download failed.',
    });
  });
});

// The token is never handed back to the renderer — only whether one is stored.
// The window is local, but there is no reason for a secret to make the trip.
ipcMain.handle('settings:get', () => ({
  url: process.env.PG_PROXY_URL || '',
  database: process.env.PG_PROXY_DATABASE || '',
  hasToken: Boolean(process.env.PG_PROXY_TOKEN),
  sourceUrl: process.env.PG_SOURCE_PROXY_URL || '',
  sourceDatabase: process.env.PG_SOURCE_PROXY_DATABASE || '',
  hasSourceToken: Boolean(process.env.PG_SOURCE_PROXY_TOKEN),
}));

ipcMain.handle('settings:save', (_event, settings) => {
  const url = String(settings?.url ?? '').trim();
  const database = String(settings?.database ?? '').trim();
  const typedToken = String(settings?.token ?? '').trim();
  // A blank token field means "leave the stored one alone", so someone fixing a
  // typo in the URL does not have to paste the token again.
  const token = typedToken || process.env.PG_PROXY_TOKEN || '';

  if (!url || !database || !token) {
    return { ok: false, message: 'Address, database and access token are all required.' };
  }

  try {
    new URL(url);
  } catch {
    return { ok: false, message: 'Address must be a full URL, starting with https://' };
  }

  // The read-only source connection. Left blank it mirrors the operational
  // one, which is the single-database arrangement every earlier build used.
  const sourceUrl = String(settings?.sourceUrl ?? '').trim() || url;
  const sourceDatabase =
    String(settings?.sourceDatabase ?? '').trim() || database;
  const typedSourceToken = String(settings?.sourceToken ?? '').trim();
  const sourceToken =
    typedSourceToken || process.env.PG_SOURCE_PROXY_TOKEN || token;

  try {
    new URL(sourceUrl);
  } catch {
    return {
      ok: false,
      message: 'Source address must be a full URL, starting with https://',
    };
  }

  const values = {
    PG_PROXY_URL: url,
    PG_PROXY_DATABASE: database,
    PG_PROXY_TOKEN: token,
    PG_SOURCE_PROXY_URL: sourceUrl,
    PG_SOURCE_PROXY_DATABASE: sourceDatabase,
    PG_SOURCE_PROXY_TOKEN: sourceToken,
  };

  try {
    fs.writeFileSync(connectionConfigPath(), JSON.stringify(values, null, 2), 'utf8');
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not save the settings.',
    };
  }

  // The Next server runs inside this process, so the API routes read these on
  // their next request. No restart needed.
  Object.assign(process.env, values);
  return { ok: true };
});

function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function waitForServer(host, port, timeoutMs = 120000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await isPortOpen(host, port, 500)) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${host}:${port}`));
        return;
      }

      setTimeout(tick, 500);
    };

    tick().catch(reject);
  });
}

async function startServer() {
  if (server || process.env.ELECTRON_SKIP_SERVER === '1') {
    return;
  }

  const dev = !app.isPackaged;
  nextApp = next({ dev, dir: ROOT_DIR, hostname: HOST, port: PORT });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  server = http.createServer((req, res) => {
    handle(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function ensureServer() {
  if (!(await isPortOpen(HOST, PORT, 300))) {
    await startServer();
  }

  await waitForServer(HOST, PORT);
}

async function createWindow() {
  await ensureServer();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#f4efe8',
    title: 'Installation Operations Dashboard',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(START_URL);
  checkForUpdates();
}

async function boot() {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      'Dashboard failed to start',
      error instanceof Error ? error.message : 'Unknown startup error.'
    );
    throw error;
  }
}

app.whenReady().then(boot).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot().catch((error) => {
      console.error(error);
      app.exit(1);
    });
  }
});

app.on('before-quit', async () => {
  shuttingDown = true;
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (nextApp && typeof nextApp.close === 'function') {
    await nextApp.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
