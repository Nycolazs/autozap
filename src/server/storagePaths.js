const os = require('os');
const path = require('path');

const APP_DIR_NAME = String(process.env.AUTOZAP_APP_DIR_NAME || 'AutoZap').trim() || 'AutoZap';

function resolveProjectRootDir() {
  return path.join(__dirname, '..', '..');
}

function resolveBaseAppDataDir() {
  const explicit = String(process.env.AUTOZAP_APPDATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);

  if (process.platform === 'win32') {
    return process.env.APPDATA
      || process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Roaming');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }

  return process.env.XDG_DATA_HOME
    || path.join(os.homedir(), '.local', 'share');
}

function shouldUseAppDataStorage() {
  const mode = String(process.env.AUTOZAP_STORAGE_MODE || '').trim().toLowerCase();
  if (mode === 'project') return false;
  if (mode === 'appdata') return true;

  if (String(process.env.AUTOZAP_USE_APPDATA || '').trim() === '1') return true;
  if (process.versions && process.versions.electron) return true;
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') return true;
  return false;
}

function resolveStorageRootDir() {
  const explicit = String(process.env.AUTOZAP_STORAGE_ROOT || '').trim();
  if (explicit) return path.resolve(explicit);

  if (shouldUseAppDataStorage()) {
    return path.join(resolveBaseAppDataDir(), APP_DIR_NAME);
  }

  return resolveProjectRootDir();
}

function resolveDataDir() {
  const explicit = String(process.env.AUTOZAP_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(resolveStorageRootDir(), 'data');
}

function resolveMediaDir() {
  const explicit = String(process.env.AUTOZAP_MEDIA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(resolveStorageRootDir(), 'media');
}

module.exports = {
  APP_DIR_NAME,
  resolveProjectRootDir,
  resolveBaseAppDataDir,
  shouldUseAppDataStorage,
  resolveStorageRootDir,
  resolveDataDir,
  resolveMediaDir,
};
