declare global {
  interface Window {
    API_BASE?: string;
    __API_BASE__?: string;
    __MOBILE_API_BASE__?: string;
    __AUTOZAP_DEFAULT_MOBILE_API_BASE__?: string;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

const AUTH_TOKEN_KEY = 'AUTH_TOKEN';
const API_BASE_KEY = 'API_BASE';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function normalizeBase(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

export function isCapacitorNativeRuntime(): boolean {
  if (!isBrowser() || !window.Capacitor) return false;

  try {
    if (typeof window.Capacitor.isNativePlatform === 'function') {
      return window.Capacitor.isNativePlatform();
    }
    const platform = window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
    return platform !== 'web';
  } catch (_) {
    return false;
  }
}

export function isMobileBrowser(): boolean {
  if (!isBrowser()) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function getApiBase(): string {
  if (!isBrowser()) return '';

  const runtimeBase = normalizeBase(window.API_BASE || window.__API_BASE__);
  if (runtimeBase) return runtimeBase;

  let persistedBase = '';
  try {
    persistedBase = normalizeBase(localStorage.getItem(API_BASE_KEY));
  } catch (_) {}
  if (persistedBase) return persistedBase;

  const protocol = String(window.location.protocol || '').toLowerCase();
  const isFileProtocol = protocol === 'file:';
  if (isFileProtocol || isCapacitorNativeRuntime()) {
    const nativeBase = normalizeBase(
      window.__MOBILE_API_BASE__ || window.__AUTOZAP_DEFAULT_MOBILE_API_BASE__ || 'http://127.0.0.1:3000'
    );
    return nativeBase || 'http://127.0.0.1:3000';
  }

  return '';
}

export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const base = getApiBase();
  if (!base) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${base}${pathOrUrl}`;
  return `${base}/${pathOrUrl}`;
}

export function getAuthToken(): string {
  if (!isBrowser()) return '';

  try {
    return String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

export function setAuthToken(token: string): void {
  if (!isBrowser()) return;

  try {
    const normalized = String(token || '').trim();
    if (normalized) {
      localStorage.setItem(AUTH_TOKEN_KEY, normalized);
      return;
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (_) {}
}

export function clearAuthToken(): void {
  setAuthToken('');
}

export function resolveMediaUrl(mediaPath: string | null | undefined): string {
  const raw = String(mediaPath || '').trim();
  if (!raw) return '';
  if (/^(blob:|data:|https?:\/\/)/i.test(raw)) return raw;

  const resolved = resolveApiUrl(raw);
  if (!resolved) return raw;

  const token = getAuthToken();
  if (!token) return resolved;

  try {
    const parsed = new URL(resolved, isBrowser() ? window.location.origin : 'http://localhost');
    if (!String(parsed.pathname || '').startsWith('/media/wa/')) return resolved;
    if (!parsed.searchParams.has('auth')) parsed.searchParams.set('auth', token);
    return parsed.toString();
  } catch (_) {
    return resolved;
  }
}

export function parseDate(value: unknown): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const ms = raw.length <= 10 ? numeric * 1000 : numeric;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasZone = /([+-]\d{2}:\d{2}|Z)$/i.test(normalized);
  const d = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTime(value: unknown): string {
  const date = parseDate(value);
  if (!date) return '--:--';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  } catch (_) {
    return '--:--';
  }
}
