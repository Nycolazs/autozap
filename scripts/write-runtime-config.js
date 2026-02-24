'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'electron', 'runtime-config.json');

function parseModeArg() {
  const modeArg = process.argv.find((arg) => String(arg || '').startsWith('--mode='));
  if (modeArg) return String(modeArg.split('=')[1] || '').trim().toLowerCase();
  const envMode = String(process.env.AUTOZAP_RUNTIME_MODE || '').trim().toLowerCase();
  if (envMode) return envMode;
  return 'auto';
}

function parseBoolean(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeHttpUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function resolveConfigFromMode(mode) {
  const targetUrl = normalizeHttpUrl(process.env.AUTOZAP_TARGET_SERVER_URL || process.env.AUTOZAP_SERVER_URL || '');
  const targetManaged = parseBoolean(process.env.AUTOZAP_TARGET_MANAGED_EXTERNALLY);

  if (mode === 'local') {
    return { serverUrl: '', managedExternally: false };
  }

  if (mode === 'cloud') {
    if (!targetUrl) {
      throw new Error('AUTOZAP_TARGET_SERVER_URL é obrigatório no modo cloud.');
    }
    return {
      serverUrl: targetUrl,
      managedExternally: targetManaged != null ? targetManaged : true,
    };
  }

  if (targetUrl) {
    return {
      serverUrl: targetUrl,
      managedExternally: targetManaged != null ? targetManaged : true,
    };
  }

  return { serverUrl: '', managedExternally: false };
}

function main() {
  const mode = parseModeArg();
  if (!['auto', 'local', 'cloud'].includes(mode)) {
    throw new Error(`Modo inválido: ${mode}. Use auto, local ou cloud.`);
  }

  const config = resolveConfigFromMode(mode);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`[runtime-config] ${CONFIG_PATH}`);
  console.log(`[runtime-config] mode=${mode} serverUrl=${config.serverUrl || '(local)'} managedExternally=${config.managedExternally}`);
}

main();
