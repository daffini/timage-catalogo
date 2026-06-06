const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Determina il path dei dati: prima cerca nella stessa cartella dell'exe,
// poi fallback alla cartella del progetto
function resolveDataPath() {
  const candidates = [
    // Quando packaged: cartella "data" accanto all'exe
    path.join(process.resourcesPath, 'data'),
    // In sviluppo: cartella "data" nel progetto
    path.join(__dirname, 'data'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

const DATA_PATH = resolveDataPath();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Carica la build Vite (dist/) se esiste, altrimenti i sorgenti (src/)
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  const srcIndex = path.join(__dirname, 'src', 'index.html');
  mainWindow.loadFile(fs.existsSync(distIndex) ? distIndex : srcIndex);
  mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Cattura i console.log del renderer e stampali nel terminale
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!sourceId.includes('devtools://')) {
      const prefix = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
      try { console.log(`[RENDERER ${prefix}] ${message}`); } catch (_) {}
    }
  });

  // Dev tools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ─── IPC Handlers ──────────────────────────────────────────────

// Leggi un file JSON dalla cartella dati
ipcMain.handle('read-json', async (_event, relativePath) => {
  const filePath = path.join(DATA_PATH, relativePath);
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Errore lettura JSON: ${filePath}`, err.message);
    return null;
  }
});

// Leggi un file SVG come stringa
ipcMain.handle('read-svg', async (_event, relativePath) => {
  const filePath = path.join(DATA_PATH, relativePath);
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`Errore lettura SVG: ${filePath}`, err.message);
    return null;
  }
});

// Restituisce il path assoluto di un file dati (per Three.js file:// loading)
ipcMain.handle('resolve-data-path', async (_event, relativePath) => {
  return path.join(DATA_PATH, relativePath);
});

// Restituisci il path base dei dati
ipcMain.handle('get-data-path', async () => {
  return DATA_PATH;
});

// Lista file in una directory
ipcMain.handle('list-files', async (_event, relativePath, extension) => {
  const dirPath = path.join(DATA_PATH, relativePath);
  try {
    const files = await fs.promises.readdir(dirPath);
    if (extension) {
      return files.filter(f => f.toLowerCase().endsWith(extension.toLowerCase()));
    }
    return files;
  } catch (err) {
    console.error(`Errore lista file: ${dirPath}`, err.message);
    return [];
  }
});

// Lista directory (modelli disponibili)
ipcMain.handle('list-models', async () => {
  const modelsPath = path.join(DATA_PATH, 'models');
  try {
    const entries = await fs.promises.readdir(modelsPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    console.error('Errore lista modelli:', err.message);
    return [];
  }
});

// Salva file (per export ordini)
ipcMain.handle('save-file', async (_event, { defaultName, filters, content, encoding }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  await fs.promises.writeFile(result.filePath, content, encoding || 'utf-8');
  return result.filePath;
});

// Salva file binario (per export Excel)
ipcMain.handle('save-binary', async (_event, { defaultName, filters, buffer }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  await fs.promises.writeFile(result.filePath, Buffer.from(buffer));
  return result.filePath;
});

// ─── App lifecycle ─────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
