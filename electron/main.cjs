const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const next = require('next');
const net = require('net');
const path = require('path');

const HOST = process.env.ELECTRON_HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const START_URL = process.env.ELECTRON_START_URL || `http://${HOST}:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, '..');

let server = null;
let nextApp = null;
let mainWindow = null;
let shuttingDown = false;

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
