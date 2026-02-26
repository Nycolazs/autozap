'use strict';

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, BrowserWindow, shell, session, dialog } = require('electron');

const packageJson = require(path.join(__dirname, '..', 'package.json'));

const DEFAULT_LOCAL_PORT = Number(process.env.PORT || 3000);
const DEFAULT_LOCAL_SERVER_URL = `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`;
const RUNTIME_CONFIG_PATH = path.join(__dirname, 'runtime-config.json');
const UPDATE_CHECK_DELAY_MS = Math.max(1000, Number(process.env.AUTOZAP_UPDATE_CHECK_DELAY_MS || 10000));

let mainWindow = null;
let serverHandle = null;
let serverBootPromise = null;
let runtimeConfig = null;
let updateCheckStarted = false;
let updateDownloadInProgress = false;
let appIsQuitting = false;
let windowRecoveryTimer = null;

function normalizeVersion(raw) {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
}

function parseVersionParts(raw) {
  const normalized = normalizeVersion(raw);
  if (!normalized) return [];
  return normalized.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersions(a, b) {
  const aParts = parseVersionParts(a);
  const bParts = parseVersionParts(b);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const left = Number.isFinite(aParts[i]) ? aParts[i] : 0;
    const right = Number.isFinite(bParts[i]) ? bParts[i] : 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

function sanitizeFileName(fileName) {
  const normalized = String(fileName || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim();
  return normalized || `AutoZap-update-${Date.now()}`;
}

function normalizeGithubRepo(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    return raw.replace(/\.git$/i, '');
  }

  const sshMatch = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  try {
    const parsed = new URL(raw);
    if (!/github\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = String(parts[1] || '').replace(/\.git$/i, '');
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch (_) {
    return null;
  }
}

function resolveUpdateRepo() {
  const envRepo = normalizeGithubRepo(process.env.AUTOZAP_UPDATE_REPO);
  if (envRepo) return envRepo;

  const repository = packageJson && packageJson.repository ? packageJson.repository : null;
  if (!repository) return null;

  if (typeof repository === 'string') {
    return normalizeGithubRepo(repository);
  }

  if (repository && typeof repository === 'object') {
    return normalizeGithubRepo(repository.url || repository.path || '');
  }

  return null;
}

function isAutoUpdateEnabled() {
  const envFlag = parseBoolean(process.env.AUTOZAP_AUTO_UPDATE_ENABLED);
  return envFlag == null ? true : envFlag;
}

async function fetchLatestRelease(repo) {
  const allowPreRelease = parseBoolean(process.env.AUTOZAP_UPDATE_ALLOW_PRERELEASE) === true;
  const url = allowPreRelease
    ? `https://api.github.com/repos/${repo}/releases?per_page=15`
    : `https://api.github.com/repos/${repo}/releases/latest`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `AutoZap/${app.getVersion() || packageJson.version || '0.0.0'}`,
    },
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub API retornou ${response.status}`);
  }

  const payload = await response.json();
  if (!allowPreRelease) {
    return payload;
  }

  const releases = Array.isArray(payload) ? payload : [];
  const candidate = releases.find((release) => {
    if (!release || release.draft) return false;
    return true;
  });

  if (!candidate) {
    throw new Error('Nenhuma release disponível para atualização automática');
  }
  return candidate;
}

function scoreReleaseAsset(asset) {
  if (!asset || typeof asset !== 'object') return -1;

  const name = String(asset.name || '').toLowerCase();
  const extByPlatform = process.platform === 'win32'
    ? ['.exe', '.msi', '.zip']
    : (process.platform === 'darwin' ? ['.dmg', '.pkg', '.zip'] : ['.appimage', '.deb', '.rpm', '.tar.gz', '.zip']);

  const extIndex = extByPlatform.findIndex((ext) => name.endsWith(ext));
  if (extIndex < 0) return -1;
  if (name.endsWith('.blockmap')) return -1;
  if (name.includes('sha256') || name.includes('checksum') || name.includes('.sig')) return -1;

  const archTokens = process.arch === 'arm64'
    ? ['arm64', 'aarch64']
    : (process.arch === 'x64' ? ['x64', 'amd64'] : [process.arch]);

  let score = 100 - (extIndex * 10);

  if (process.platform === 'win32' && name.includes('setup')) {
    score += 25;
  }
  if (process.platform === 'darwin' && name.endsWith('.dmg')) {
    score += 15;
  }
  if (name.includes(process.platform)) {
    score += 8;
  }

  if (archTokens.some((token) => name.includes(token))) {
    score += 20;
  } else if (name.includes('arm64') || name.includes('aarch64') || name.includes('x64') || name.includes('amd64')) {
    score -= 10;
  }

  return score;
}

function selectBestReleaseAsset(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  let winner = null;
  let bestScore = -1;

  for (const asset of assets) {
    const score = scoreReleaseAsset(asset);
    if (score > bestScore) {
      bestScore = score;
      winner = asset;
    }
  }

  return winner;
}

async function downloadAssetToDisk(asset) {
  if (!asset || !asset.browser_download_url) {
    throw new Error('Asset de atualização inválido');
  }

  if (updateDownloadInProgress) return null;
  updateDownloadInProgress = true;

  const downloadsDir = path.join(app.getPath('downloads'), 'AutoZap-updates');
  fs.mkdirSync(downloadsDir, { recursive: true });

  const targetPath = path.join(downloadsDir, sanitizeFileName(asset.name));
  const tempPath = `${targetPath}.download`;

  try {
    const response = await fetch(String(asset.browser_download_url), {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': `AutoZap/${app.getVersion() || packageJson.version || '0.0.0'} (${os.platform()} ${os.arch()})`,
      },
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!response.ok || !response.body) {
      throw new Error(`Falha ao baixar atualização (HTTP ${response.status})`);
    }

    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(tempPath)
    );

    fs.renameSync(tempPath, targetPath);
    return targetPath;
  } finally {
    updateDownloadInProgress = false;
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

async function checkForUpdatesAndDownload() {
  if (updateCheckStarted) return;
  updateCheckStarted = true;

  if (!isAutoUpdateEnabled()) return;

  const repo = resolveUpdateRepo();
  if (!repo) {
    console.warn('[electron] verificação de atualização ignorada: AUTOZAP_UPDATE_REPO/repository ausente.');
    return;
  }

  try {
    const release = await fetchLatestRelease(repo);
    const latestVersion = normalizeVersion(release && release.tag_name ? release.tag_name : '');
    const currentVersion = normalizeVersion(app.getVersion() || packageJson.version || '0.0.0');
    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
      return;
    }

    const bestAsset = selectBestReleaseAsset(release);
    const releasePage = String((release && release.html_url) || `https://github.com/${repo}/releases/latest`);

    const silent = parseBoolean(process.env.AUTOZAP_UPDATE_SILENT) === true;
    const autoLaunchInstaller = parseBoolean(process.env.AUTOZAP_AUTO_LAUNCH_INSTALLER);
    const shouldAutoLaunchInstaller = autoLaunchInstaller == null ? true : autoLaunchInstaller;

    if (!silent) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Atualização disponível',
        message: `Nova versão do AutoZap disponível (v${latestVersion})`,
        detail: `Versão atual: v${currentVersion}\nO download da atualização será iniciado automaticamente.`,
        buttons: ['OK'],
        defaultId: 0,
      });
    }

    if (!bestAsset) {
      if (silent) {
        shell.openExternal(releasePage);
        return;
      }
      await dialog.showMessageBox(mainWindow || null, {
        type: 'warning',
        title: 'Atualização encontrada',
        message: 'Nenhum instalador compatível foi encontrado para download automático.',
        detail: 'A página de releases será aberta para download manual.',
        buttons: ['Abrir releases', 'Fechar'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) shell.openExternal(releasePage);
      });
      return;
    }

    const downloadedPath = await downloadAssetToDisk(bestAsset);
    if (!downloadedPath) return;

    if (shouldAutoLaunchInstaller) {
      const openErr = await shell.openPath(downloadedPath);
      if (!openErr) {
        if (!silent) {
          await dialog.showMessageBox(mainWindow || null, {
            type: 'info',
            title: 'Atualização baixada',
            message: `Atualização v${latestVersion} baixada com sucesso.`,
            detail: 'O instalador foi aberto automaticamente.',
            buttons: ['OK'],
            defaultId: 0,
          });
        }
        return;
      }

      if (silent) {
        shell.showItemInFolder(downloadedPath);
        return;
      }

      await dialog.showMessageBox(mainWindow || null, {
        type: 'warning',
        title: 'Não foi possível abrir o instalador',
        message: 'A atualização foi baixada, mas não foi possível abrir automaticamente.',
        detail: openErr,
        buttons: ['Abrir pasta', 'Abrir releases', 'Fechar'],
        defaultId: 0,
        cancelId: 2,
      }).then(({ response }) => {
        if (response === 0) shell.showItemInFolder(downloadedPath);
        if (response === 1) shell.openExternal(releasePage);
      });
      return;
    }

    if (silent) {
      shell.showItemInFolder(downloadedPath);
      return;
    }

    const result = await dialog.showMessageBox(mainWindow || null, {
      type: 'info',
      title: 'Atualização baixada',
      message: `Atualização v${latestVersion} baixada com sucesso.`,
      detail: downloadedPath,
      buttons: ['Instalar agora', 'Abrir pasta', 'Depois'],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 0) {
      const openErr = await shell.openPath(downloadedPath);
      if (openErr) {
        await dialog.showMessageBox(mainWindow || null, {
          type: 'warning',
          title: 'Não foi possível abrir o instalador',
          message: 'O instalador foi baixado, mas não foi possível abrir automaticamente.',
          detail: openErr,
          buttons: ['Abrir pasta', 'Abrir releases', 'Fechar'],
          defaultId: 0,
          cancelId: 2,
        }).then(({ response }) => {
          if (response === 0) shell.showItemInFolder(downloadedPath);
          if (response === 1) shell.openExternal(releasePage);
        });
      }
    } else if (result.response === 1) {
      shell.showItemInFolder(downloadedPath);
    }
  } catch (err) {
    console.warn('[electron] falha ao verificar atualização:', err && err.message ? err.message : err);
  }
}

function parseBoolean(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function readRuntimeConfigFile() {
  try {
    if (!fs.existsSync(RUNTIME_CONFIG_PATH)) return {};
    const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveRuntimeConfig() {
  const fileConfig = readRuntimeConfigFile();

  const envUrl = String(process.env.AUTOZAP_SERVER_URL || '').trim();
  const fileUrl = String(fileConfig.serverUrl || '').trim();
  const selectedUrl = (envUrl || fileUrl || DEFAULT_LOCAL_SERVER_URL).replace(/\/+$/, '');

  const envManaged = parseBoolean(process.env.AUTOZAP_SERVER_MANAGED_EXTERNALLY);
  const fileManaged = parseBoolean(fileConfig.managedExternally);
  const inferredManaged = selectedUrl !== DEFAULT_LOCAL_SERVER_URL;
  const managedExternally = envManaged != null
    ? envManaged
    : (fileManaged != null ? fileManaged : inferredManaged);

  return {
    serverUrl: selectedUrl,
    managedExternally,
    source: envUrl ? 'env' : (fileUrl ? 'runtime-config' : 'local-default'),
  };
}

function configureDesktopStorageEnv() {
  const userDataDir = app.getPath('userData');
  if (!process.env.AUTOZAP_STORAGE_MODE) {
    process.env.AUTOZAP_STORAGE_MODE = 'appdata';
  }
  if (!process.env.AUTOZAP_DATA_DIR) {
    process.env.AUTOZAP_DATA_DIR = path.join(userDataDir, 'data');
  }
  if (!process.env.AUTOZAP_MEDIA_DIR) {
    process.env.AUTOZAP_MEDIA_DIR = path.join(userDataDir, 'media');
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUrlPort(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.port) {
      const direct = Number(parsed.port);
      return Number.isFinite(direct) && direct > 0 ? direct : null;
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch (_) {
    return null;
  }
}

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(null));
    tester.once('listening', () => {
      const address = tester.address();
      const selectedPort = address && typeof address === 'object' ? address.port : null;
      tester.close(() => {
        resolve(Number.isFinite(selectedPort) && selectedPort > 0 ? selectedPort : null);
      });
    });
    tester.listen(0, host);
  });
}

async function ensureLocalRuntimePort() {
  const preferredPort = resolveUrlPort(runtimeConfig && runtimeConfig.serverUrl)
    || Number(process.env.PORT || DEFAULT_LOCAL_PORT)
    || DEFAULT_LOCAL_PORT;

  const preferredFree = await isPortAvailable(preferredPort);
  const selectedPort = preferredFree ? preferredPort : await findFreePort('127.0.0.1');
  const finalPort = Number.isFinite(selectedPort) && selectedPort > 0 ? selectedPort : preferredPort;

  process.env.PORT = String(finalPort);
  runtimeConfig.serverUrl = `http://127.0.0.1:${finalPort}`;

  if (finalPort !== preferredPort) {
    console.warn(`[electron] Porta ${preferredPort} ocupada. Usando ${finalPort} para o backend local.`);
  }
}

function probeServer(url) {
  return new Promise((resolve) => {
    let target = null;
    try {
      target = new URL(`${String(url || '').replace(/\/+$/, '')}/healthz`);
    } catch (_) {
      resolve(false);
      return;
    }

    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(target, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      try { req.destroy(); } catch (_) {}
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const ok = await probeServer(url);
    if (ok) return true;
    await wait(500);
  }
  return false;
}

async function ensureServerStarted() {
  if (!runtimeConfig) {
    runtimeConfig = resolveRuntimeConfig();
  }

  if (runtimeConfig.managedExternally) return;
  if (serverBootPromise) return serverBootPromise;

  serverBootPromise = (async () => {
    process.env.FRONTEND_REQUIRE_DESKTOP = '1';

    const serverModule = require(path.join(__dirname, '..', 'server.js'));
    if (!serverModule || typeof serverModule.bootstrap !== 'function') {
      throw new Error('Falha ao carregar bootstrap do servidor');
    }

    serverHandle = await serverModule.bootstrap();
  })();

  return serverBootPromise;
}

function installDesktopRuntimeHeader() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['x-autozap-runtime'] = 'desktop';
    callback({ requestHeaders: details.requestHeaders });
  });
}

function scheduleMainWindowRecovery(reason) {
  if (appIsQuitting) return;
  if (windowRecoveryTimer) return;

  console.warn(`[electron] agendando recuperação da janela (${reason})`);
  windowRecoveryTimer = setTimeout(() => {
    windowRecoveryTimer = null;
    if (appIsQuitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) return;

    createMainWindow().catch((err) => {
      console.error('[electron] falha ao recriar janela principal:', err);
      scheduleMainWindowRecovery('retry_after_failure');
    });
  }, 1200);
}

function buildStartupErrorPage(targetUrl, error) {
  const safeUrl = String(targetUrl || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeError = String(error && error.message ? error.message : error || 'Falha desconhecida')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AutoZap - Falha de conexão</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #08101b;
      color: #d6e7ff;
      font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      padding: 18px;
    }
    .card {
      width: min(560px, 100%);
      border: 1px solid #2f4f73;
      border-radius: 14px;
      background: #122339;
      box-shadow: 0 14px 32px rgba(0,0,0,0.35);
      padding: 18px;
    }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 10px; color: #a9c2e0; line-height: 1.5; }
    .meta { font-size: 12px; color: #8ea9c9; word-break: break-word; }
    .actions { display: flex; gap: 10px; margin-top: 14px; }
    button {
      border: 1px solid #416892;
      border-radius: 10px;
      background: #1d3c5f;
      color: #d8ebff;
      height: 38px;
      padding: 0 14px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary {
      border-color: #5f9ded;
      background: linear-gradient(180deg, #3f8ef4 0%, #2b6dcb 100%);
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Não foi possível abrir o AutoZap</h1>
    <p>O aplicativo não conseguiu carregar o servidor configurado.</p>
    <p class="meta"><strong>URL:</strong> ${safeUrl}</p>
    <p class="meta"><strong>Erro:</strong> ${safeError}</p>
    <div class="actions">
      <button class="primary" onclick="location.href='${safeUrl}'">Tentar novamente</button>
      <button onclick="location.reload()">Recarregar tela</button>
    </div>
  </div>
</body>
</html>`;
}

async function loadInitialUrlWithRetry(win, initialUrl) {
  const maxAttempts = Math.max(1, Number(process.env.AUTOZAP_INITIAL_LOAD_RETRIES || 25));
  const retryDelayMs = Math.max(250, Number(process.env.AUTOZAP_INITIAL_LOAD_RETRY_DELAY_MS || 900));

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!win || win.isDestroyed()) {
      throw new Error('Janela principal indisponível durante carregamento inicial');
    }

    try {
      await win.loadURL(initialUrl);
      return;
    } catch (err) {
      lastError = err;
      const reason = err && err.message ? err.message : String(err || 'erro desconhecido');
      console.warn(`[electron] tentativa ${attempt}/${maxAttempts} falhou ao carregar ${initialUrl}: ${reason}`);
      if (attempt < maxAttempts) {
        await wait(retryDelayMs);
      }
    }
  }

  throw (lastError || new Error(`Falha ao carregar URL inicial: ${initialUrl}`));
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.focus();
    } catch (_) {}
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b1220',
    title: 'AutoZap',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  const safeShowMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
    } catch (_) {}
  };

  mainWindow.once('ready-to-show', safeShowMainWindow);
  mainWindow.webContents.on('did-finish-load', safeShowMainWindow);
  const delayedShowTimer = setTimeout(safeShowMainWindow, 1800);
  if (delayedShowTimer && typeof delayedShowTimer.unref === 'function') {
    delayedShowTimer.unref();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('unresponsive', () => {
    console.warn('[electron] janela principal não está respondendo');
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason ? details.reason : 'unknown';
    const exitCode = details && Number.isFinite(details.exitCode) ? details.exitCode : null;
    console.error(`[electron] renderer finalizado (${reason})${exitCode != null ? ` code=${exitCode}` : ''}`);

    if (!mainWindow || mainWindow.isDestroyed()) {
      scheduleMainWindowRecovery(`render_process_gone_${reason}`);
      return;
    }

    try {
      mainWindow.destroy();
    } catch (_) {}
    mainWindow = null;
    scheduleMainWindowRecovery(`render_process_gone_${reason}`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[electron] falha ao carregar URL (${errorCode}) ${errorDescription} -> ${validatedURL}`);
  });

  if (!runtimeConfig) {
    runtimeConfig = resolveRuntimeConfig();
  }

  const shouldClearCacheOnBoot = process.env.NODE_ENV !== 'production' || !!runtimeConfig.managedExternally;
  if (shouldClearCacheOnBoot) {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
      console.log('[electron] cache limpo na inicialização para carregar frontend atualizado.');
    } catch (err) {
      console.warn('[electron] falha ao limpar cache:', err && err.message ? err.message : err);
    }
  }

  const initialUrl = `${runtimeConfig.serverUrl}/login`;
  try {
    await loadInitialUrlWithRetry(mainWindow, initialUrl);
  } catch (err) {
    console.error('[electron] erro ao carregar tela inicial:', err && err.message ? err.message : err);
    const fallbackHtml = buildStartupErrorPage(initialUrl, err);
    const fallbackUrl = `data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`;
    await mainWindow.loadURL(fallbackUrl);
  }
}

async function startDesktop() {
  runtimeConfig = resolveRuntimeConfig();
  if (!runtimeConfig.managedExternally) {
    await ensureLocalRuntimePort();
  }
  console.log(`[electron] Runtime server: ${runtimeConfig.serverUrl} (${runtimeConfig.source}, managedExternally=${runtimeConfig.managedExternally})`);
  configureDesktopStorageEnv();
  installDesktopRuntimeHeader();
  await ensureServerStarted();

  const ok = await waitForServer(runtimeConfig.serverUrl, 60000);
  if (!ok) {
    throw new Error(`Servidor não respondeu em ${runtimeConfig.serverUrl}`);
  }

  await createMainWindow();

  const timer = setTimeout(() => {
    checkForUpdatesAndDownload().catch((err) => {
      console.warn('[electron] erro no check de atualização:', err && err.message ? err.message : err);
    });
  }, UPDATE_CHECK_DELAY_MS);

  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

process.on('uncaughtException', (err) => {
  console.error('[electron] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[electron] unhandledRejection:', reason);
});

app.whenReady()
  .then(startDesktop)
  .catch(async (err) => {
    console.error('[electron] falha ao iniciar app desktop:', err);
    runtimeConfig = runtimeConfig || resolveRuntimeConfig();
    try {
      await createMainWindow();
    } catch (fallbackErr) {
      console.error('[electron] falha ao abrir janela de fallback:', fallbackErr);
      dialog.showErrorBox(
        'Falha ao iniciar AutoZap',
        String(err && err.message ? err.message : err || 'Erro desconhecido')
      );
    }
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;
  if (windowRecoveryTimer) {
    clearTimeout(windowRecoveryTimer);
    windowRecoveryTimer = null;
  }
  if (serverHandle && typeof serverHandle.stop === 'function') {
    try {
      serverHandle.stop();
    } catch (_) {}
  }
});
