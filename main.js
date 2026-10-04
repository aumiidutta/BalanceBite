'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const llm = require('./llm');

if (!app.requestSingleInstanceLock()) app.quit();

const profileFile = () => path.join(app.getPath('userData'), 'profile.dat');
const modelFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'models', 'model.gguf')
    : path.join(__dirname, 'models', 'model.gguf');

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- profile: stored on this PC only, encrypted with the Windows account ---------- */
function sanitizeProfile(p) {
  const out = {
    name: clean(p && p.name, 40),
    health: clean(p && p.health, 120),
    restrictions: clean(p && p.restrictions, 200),
    allergies: clean(p && p.allergies, 200),
    photo: null,
  };
  if (!out.name || !out.health) throw new Error('Name and health issue are required.');
  if (
    p && typeof p.photo === 'string' &&
    p.photo.length < 400000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.photo)
  ) out.photo = p.photo;
  return out;
}

function writeProfile(profile) {
  const json = JSON.stringify(profile);
  let buf;
  if (safeStorage.isEncryptionAvailable()) {
    buf = Buffer.concat([Buffer.from('E'), safeStorage.encryptString(json)]);
  } else {
    buf = Buffer.concat([Buffer.from('P'), Buffer.from(json, 'utf8')]);
  }
  fs.mkdirSync(path.dirname(profileFile()), { recursive: true });
  fs.writeFileSync(profileFile(), buf, { mode: 0o600 });
}

function readProfile() {
  try {
    const raw = fs.readFileSync(profileFile());
    const flag = raw.subarray(0, 1).toString();
    const body = raw.subarray(1);
    const json = flag === 'E' ? safeStorage.decryptString(body) : body.toString('utf8');
    return sanitizeProfile(JSON.parse(json));
  } catch {
    return null;
  }
}

/* ---------- window ---------- */
function createWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 900,
    minWidth: 320,
    minHeight: 520,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  // Offline guarantee: refuse every network request the page could make.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_d, cb) => cb({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  createWindow();
});
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});
app.on('window-all-closed', () => {
  llm.dispose().finally(() => app.quit());
});

/* ---------- IPC ---------- */
ipcMain.handle('profile:get', () => readProfile());

ipcMain.handle('profile:save', (_e, p) => {
  try {
    const profile = sanitizeProfile(p);
    writeProfile(profile);
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('ai:generate', async (e, mode, input) => {
  const profile = readProfile(); // always the saved profile = the model's "memory"
  if (!profile) return { ok: false, message: 'Please set up your profile first.' };
  if (mode !== 'meal' && mode !== 'check') return { ok: false, message: 'Unknown mode.' };
  const safeInput = {
    stock: clean(input && input.stock, 600),
    nutrients: clean(input && input.nutrients, 300),
    ingredients: clean(input && input.ingredients, 600),
  };
  try {
    const data = await llm.generate({
      modelFile: modelFile(),
      profile,
      mode,
      input: safeInput,
      onStatus: (s) => e.sender.isDestroyed() || e.sender.send('ai:status', s),
    });
    return { ok: true, data };
  } catch (err) {
    console.error(err);
    return { ok: false, message: llm.friendlyError(err) };
  }
});

ipcMain.handle('doc:save', async (e, html, title) => {
  if (typeof html !== 'string' || html.length > 500000) return { ok: false };
  const win = BrowserWindow.fromWebContents(e.sender);
  const name = clean(title, 60).replace(/[^\w\- ]+/g, '') || 'Meal plan';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${name}.doc`,
    filters: [{ name: 'Word document', extensions: ['doc'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, '\ufeff' + html, 'utf8');
  return { ok: true };
});

ipcMain.handle('clipboard:write', (_e, text) => {
  if (typeof text !== 'string') return false;
  clipboard.writeText(text.slice(0, 100000));
  return true;
});
