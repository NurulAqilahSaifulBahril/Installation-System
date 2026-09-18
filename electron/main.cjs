const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const http = require('http');
const next = require('next');
const net = require('net');
const path = require('path');

const HOST = process.env.ELECTRON_HOST || '127.0.0.1';
const PREFERRED_PORT = Number(process.env.PORT || 3000);
const EXPLICIT_START_URL = process.env.ELECTRON_START_URL || null;
const ROOT_DIR = path.resolve(__dirname, '..');

// Must match middleware.ts's APP_ID_HEADER/APP_ID. Duplicated rather than
// imported: this file runs as plain CommonJS outside the Next build, and the
// two only need to agree on two string literals.
const APP_ID_HEADER = 'x-eternalgy-app';
const APP_ID = 'installation-ops';

// Load connection settings from the bundled .env.local before Next starts.
// Next reads env files itself, but doing it explicitly means a packaged build
// cannot silently fall back to demo data because of a working-directory quirk.
// Returns what this build shipped with, so reconcileUserConfig can compare the
// bundle against what is stored without guessing from process.env, which may
// carry values from the environment rather than from the build.
function loadEnvFile() {
  const bundled = {};
  const envPath = path.join(ROOT_DIR, '.env.local');
  if (!fs.existsSync(envPath)) {
    return bundled;
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

    bundled[key] = value;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  return bundled;
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

// Written alongside the connection values. CONFIG_SOURCE_KEY records who set
// them - 'bundle' when seeded from the build, 'manual' when someone typed them
// into the Connection settings dialog. CONFIG_VERSION_KEY is the app version
// that last seeded the file, which is how a build carrying a rotated token
// recognises that the stored copy predates it.
const CONFIG_SOURCE_KEY = 'configSource';
const CONFIG_VERSION_KEY = 'bundleVersion';

function connectionConfigPath() {
  return path.join(app.getPath('userData'), 'connection.json');
}

// This file holds a full-access database token in the user's profile, where
// any program running as them — and anyone who copies the folder — could read
// it. safeStorage encrypts it with the OS keystore (DPAPI on Windows), so a
// copied file is inert elsewhere: the key lives in "Local State" beside it in
// userData and is itself tied to this Windows account on this machine, which
// means the token now takes the account to read, not just the file. The same
// property is why a connection.json restored from a backup taken on another
// machine will not decrypt — treat it as unset and enter the details again.
//
// Every call is guarded: encryption is unavailable on some Linux desktops,
// and an app that cannot remember its connection is worse than one that
// stores it the way every earlier build did.
//
// Must not run before app.whenReady() — safeStorage is not usable until then,
// which is why the startup sequence at the bottom loads the config there
// rather than at module scope.
function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readUserConfig() {
  try {
    const configPath = connectionConfigPath();
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (stored && stored.encrypted === true && typeof stored.data === 'string') {
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(stored.data, 'base64')),
      );
    }
    // Written by a build that predates encryption, or on a machine without it.
    return stored;
  } catch (error) {
    console.error('Could not read saved connection settings:', error);
    return null;
  }
}

function writeUserConfig(values, source) {
  const payload = {
    ...values,
    [CONFIG_SOURCE_KEY]: source,
    [CONFIG_VERSION_KEY]: app.getVersion(),
  };
  const configPath = connectionConfigPath();

  if (encryptionAvailable()) {
    const data = safeStorage
      .encryptString(JSON.stringify(payload))
      .toString('base64');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ encrypted: true, data }, null, 2),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
}

// An install that already has settings keeps them in plain text until
// something happens to rewrite the file — and on a working machine nothing
// does, so the upgrade would never reach the installs that most need it.
// Rewriting in place at startup covers them without anyone opening a dialog.
function encryptStoredConfig() {
  try {
    if (!encryptionAvailable()) {
      return;
    }
    const configPath = connectionConfigPath();
    if (!fs.existsSync(configPath)) {
      return;
    }
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!stored || stored.encrypted === true) {
      return;
    }
    const data = safeStorage
      .encryptString(JSON.stringify(stored))
      .toString('base64');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ encrypted: true, data }, null, 2),
      'utf8',
    );
  } catch (error) {
    // Leaving it readable is not worth failing to start over.
    console.error('Could not encrypt the stored connection settings:', error);
  }
}

// Only CONNECTION_KEYS are applied, so the metadata stored beside them never
// reaches the environment.
function loadUserConfig() {
  const saved = readUserConfig();
  if (!saved) {
    return;
  }

  for (const key of CONNECTION_KEYS) {
    const value = saved[key];
    if (typeof value === 'string' && value.trim()) {
      process.env[key] = value.trim();
    }
  }
}

// A build with credentials baked into its bundled .env.local (built locally
// for hand-distribution to staff) keeps them only until the first auto-update
// replaces the program directory. Copying them into userData makes the
// zero-setup install permanent: updates wipe the bundle, not userData.
//
// The copy is also refreshed whenever a different build ships credentials,
// which is what lets a rotated token reach machines that already have the app.
// Seeding once on first boot was not enough: rotating the token at the proxy
// left every existing install authenticating with the dead one, because the
// update carrying the replacement skipped an existing connection.json.
function reconcileUserConfig(bundled) {
  try {
    const values = {};
    for (const key of CONNECTION_KEYS) {
      const value = bundled[key];
      if (typeof value === 'string' && value.trim()) {
        values[key] = value.trim();
      }
    }

    // Only the operational triple is required; the source keys mirror it when
    // absent (lib/source-api.ts falls back). Half a triple is not a connection.
    // Returning here is also what makes a key-free build safe: it ships no
    // credentials, so it can never blank out a connection that already works.
    if (!values.PG_PROXY_URL || !values.PG_PROXY_DATABASE || !values.PG_PROXY_TOKEN) {
      return;
    }

    const saved = readUserConfig();

    if (!saved) {
      writeUserConfig(values, 'bundle');
      return;
    }

    // Settings typed into the Connection dialog outrank the build, so an
    // install deliberately pointed at another database keeps pointing there.
    if (saved[CONFIG_SOURCE_KEY] === 'manual') {
      return;
    }

    // Already reconciled against this build. Comparing the version rather than
    // the values themselves keeps every launch from rewriting the file.
    if (saved[CONFIG_VERSION_KEY] === app.getVersion()) {
      return;
    }

    // Installs seeded before this metadata existed have neither key. Treating
    // those as seeded rather than hand-saved is deliberate - they are exactly
    // the machines a rotation has to reach, and the guard above means only a
    // build carrying credentials of its own ever gets this far.
    writeUserConfig(values, 'bundle');
  } catch (error) {
    console.error('Could not reconcile connection settings with the build:', error);
  }
}

// The bundled file is plain text inside the installation directory and needs
// no keystore, so it is read now: the auto-updater below wants
// UPDATE_GITHUB_TOKEN at module scope. Everything that touches userData waits
// for app.whenReady() further down, because safeStorage does.
const bundledEnv = loadEnvFile();

let server = null;
let nextApp = null;
let mainWindow = null;
let shuttingDown = false;
let installRequested = false;
let updateDownloaded = false;
// The port this run actually ended up on - equals PREFERRED_PORT unless that
// one was already held by something else, see ensureServer().
let activePort = PREFERRED_PORT;

// Auto-update: checks the app-update.yml embedded at build time (points at
// the Installation-System GitHub releases feed). Downloads only happen when
// the renderer explicitly asks for one via the "Install Update" button, and
// installing quits+relaunches the app, so both are opt-in from the user.
autoUpdater.autoDownload = false;

// The repository is private, so release assets are not readable without
// credentials. Without a token every check returns 404 and electron-updater
// reports "no update available" - the button simply never appears and nothing
// looks wrong, which is the worst possible failure for something staff rely on
// to receive fixes. UPDATE_GITHUB_TOKEN is read-only and scoped to this one
// repository; it ships in the same bundled .env.local as the database values.
if (process.env.UPDATE_GITHUB_TOKEN) {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'NurulAqilahSaifulBahril',
    repo: 'Installation-System',
    private: true,
    token: process.env.UPDATE_GITHUB_TOKEN,
  });
} else if (app.isPackaged) {
  // Say so in the log rather than failing silently, so "staff stopped getting
  // updates" is diagnosable from the one place someone will look.
  console.warn(
    'No UPDATE_GITHUB_TOKEN in this build - update checks against a private ' +
      'repository will return 404 and no update will ever be offered.',
  );
}

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
    writeUserConfig(values, 'manual');
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

// Confirms whatever is listening on host:port is actually this app, via the
// header middleware.ts stamps on every response. Without this, a port that
// merely answers HTTP is treated as "our server already running" - which is
// how this shell ended up loading Agent CRM's window when that app happened
// to be sitting on the same default port 3000.
async function isOurServer(host, port) {
  try {
    const response = await fetch(`http://${host}:${port}/api/auth/me`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.headers.get(APP_ID_HEADER) === APP_ID;
  } catch {
    return false;
  }
}

// Preferred port is already taken by something that isn't us - find a free
// one nearby rather than fail to start. Probing by actually binding (not by
// asking isPortOpen for "false") is what makes this safe against the same
// race a second launch could hit.
function findFreePort(host, startPort, maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, attemptsLeft) => {
      if (attemptsLeft <= 0) {
        reject(new Error(`No free port found starting at ${startPort}`));
        return;
      }
      const tester = net.createServer();
      tester.once('error', () => {
        tester.close(() => tryPort(port + 1, attemptsLeft - 1));
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, host);
    };
    tryPort(startPort, maxAttempts);
  });
}

async function startServer(port) {
  if (server || process.env.ELECTRON_SKIP_SERVER === '1') {
    return;
  }

  const dev = !app.isPackaged;
  nextApp = next({ dev, dir: ROOT_DIR, hostname: HOST, port });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  server = http.createServer((req, res) => {
    handle(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function ensureServer() {
  if (await isPortOpen(HOST, PREFERRED_PORT, 300)) {
    if (await isOurServer(HOST, PREFERRED_PORT)) {
      // A previous launch (or the background watchdog) is already serving -
      // reuse it rather than starting a second instance.
      activePort = PREFERRED_PORT;
      await waitForServer(HOST, activePort);
      return;
    }

    console.warn(
      `Port ${PREFERRED_PORT} is in use by a different app - starting on a fallback port instead.`,
    );
    activePort = await findFreePort(HOST, PREFERRED_PORT + 1);
  } else {
    activePort = PREFERRED_PORT;
  }

  await startServer(activePort);
  await waitForServer(HOST, activePort);
}

async function createWindow() {
  let startUrl = EXPLICIT_START_URL;
  if (!startUrl) {
    await ensureServer();
    startUrl = `http://${HOST}:${activePort}`;
  }

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

  await mainWindow.loadURL(startUrl);
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

// Order matters. Encrypting whatever is already on disk comes first, so an
// upgrade covers installs that reconcileUserConfig would leave untouched (a
// hand-saved connection, or one already matching this build). Then the stored
// values land in process.env before boot() starts the Next server that reads
// them.
app
  .whenReady()
  .then(() => {
    encryptStoredConfig();
    reconcileUserConfig(bundledEnv);
    loadUserConfig();
    return boot();
  })
  .catch((error) => {
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
