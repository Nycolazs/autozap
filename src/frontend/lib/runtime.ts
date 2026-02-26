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

const AUTH_TOKEN_KEY = 'AUTH_TOKEN_SESSION';
const LEGACY_AUTH_TOKEN_KEY = 'AUTH_TOKEN';
const API_BASE_KEY = 'API_BASE';
const API_PROXY_BASE_PARAM = '__api_base';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function normalizeBase(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function normalizePhoneDigits(value: unknown): string {
  return String(value || '').split('@')[0].replace(/\D/g, '');
}

function isProtectedAssetPath(pathname: string): boolean {
  const normalized = String(pathname || '');
  if (normalized.startsWith('/media/')) return true;
  if (normalized.startsWith('/__api/media/')) return true;
  return /^\/profile-picture\/[^/]+\/image$/i.test(normalized);
}

function isProtectedProxyAssetPath(pathname: string): boolean {
  const normalized = String(pathname || '');
  return /^\/__api\/profile-picture\/[^/]+\/image$/i.test(normalized);
}

function shouldProxyApiBase(base: string): boolean {
  if (!isBrowser()) return false;
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) return false;

  const protocol = String(window.location.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;

  try {
    const currentOrigin = String(window.location.origin || '').toLowerCase();
    const baseOrigin = String(new URL(normalizedBase).origin || '').toLowerCase();
    return !!currentOrigin && !!baseOrigin && currentOrigin !== baseOrigin;
  } catch (_) {
    return false;
  }
}

function buildProxyUrl(pathOrUrl: string, base: string): string {
  if (!isBrowser()) return pathOrUrl;

  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) return pathOrUrl;

  let targetPath = '';
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      const absolute = new URL(pathOrUrl);
      const baseUrl = new URL(normalizedBase);
      if (String(absolute.origin).toLowerCase() !== String(baseUrl.origin).toLowerCase()) {
        return pathOrUrl;
      }
      targetPath = `${absolute.pathname || '/'}${absolute.search || ''}`;
    } catch (_) {
      return pathOrUrl;
    }
  } else {
    const direct = String(pathOrUrl || '').trim();
    if (!direct) return direct;
    if (direct.startsWith('/__api/')) return direct;
    targetPath = direct.startsWith('/') ? direct : `/${direct}`;
  }

  try {
    const proxied = new URL(`/__api${targetPath}`, window.location.origin);
    proxied.searchParams.set(API_PROXY_BASE_PARAM, normalizedBase);
    return `${proxied.pathname}${proxied.search}`;
  } catch (_) {
    return pathOrUrl;
  }
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

  const envBase = normalizeBase(process.env.NEXT_PUBLIC_API_BASE || '');
  const forceEnvBase = String(process.env.NEXT_PUBLIC_API_BASE_FORCE || '').trim() === '1';
  if (forceEnvBase && envBase) return envBase;

  const runtimeBase = normalizeBase(window.API_BASE || window.__API_BASE__);
  if (runtimeBase) return runtimeBase;

  let persistedBase = '';
  try {
    persistedBase = normalizeBase(localStorage.getItem(API_BASE_KEY));
  } catch (_) {}
  if (persistedBase) return persistedBase;
  if (envBase) return envBase;

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
  if (pathOrUrl.startsWith('/__api/')) return pathOrUrl;

  const base = getApiBase();
  const useProxy = shouldProxyApiBase(base);

  if (/^https?:\/\//i.test(pathOrUrl)) {
    return useProxy ? buildProxyUrl(pathOrUrl, base) : pathOrUrl;
  }

  if (!base) return pathOrUrl;

  if (useProxy) {
    return buildProxyUrl(pathOrUrl, base);
  }

  if (pathOrUrl.startsWith('/')) return `${base}${pathOrUrl}`;
  return `${base}/${pathOrUrl}`;
}

export function getAuthToken(): string {
  if (!isBrowser()) return '';

  try {
    return String(sessionStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

export function setAuthToken(token: string): void {
  if (!isBrowser()) return;

  try {
    const normalized = String(token || '').trim();
    if (normalized) {
      sessionStorage.setItem(AUTH_TOKEN_KEY, normalized);
      try { localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY); } catch (_) {}
      return;
    }
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    try { localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY); } catch (_) {}
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
    const pathname = String(parsed.pathname || '');
    if (!isProtectedAssetPath(pathname) && !isProtectedProxyAssetPath(pathname)) return resolved;
    if (!parsed.searchParams.has('auth')) parsed.searchParams.set('auth', token);
    return parsed.toString();
  } catch (_) {
    return resolved;
  }
}

export function resolveProfilePictureUrl(phone: string | null | undefined, directUrl?: string | null): string {
  const rawDirect = String(directUrl || '').trim();
  const normalizedPhone = normalizePhoneDigits(phone);
  if (/^(blob:|data:)/i.test(rawDirect)) return rawDirect;
  if (/^https?:\/\//i.test(rawDirect)) {
    if (normalizedPhone) {
      return resolveMediaUrl(`/profile-picture/${encodeURIComponent(normalizedPhone)}/image`);
    }
    return resolveMediaUrl(rawDirect);
  }
  if (/^\/profile-picture\/[^/]+\/image(?:\?.*)?$/i.test(rawDirect)) {
    return resolveMediaUrl(rawDirect);
  }
  if (/^\/media\/profiles\//i.test(rawDirect)) {
    if (normalizedPhone) {
      return resolveMediaUrl(`/profile-picture/${encodeURIComponent(normalizedPhone)}/image`);
    }
    const directLocal = resolveMediaUrl(rawDirect);
    if (directLocal) return directLocal;
  }
  return rawDirect ? resolveMediaUrl(rawDirect) : '';
}

export async function resolveMediaObjectUrl(
  mediaPath: string | null | undefined,
  opts?: { forceAuthFetch?: boolean }
): Promise<string> {
  const resolved = resolveMediaUrl(mediaPath);
  if (!resolved) return '';
  if (!isBrowser()) return resolved;
  if (/^(blob:|data:)/i.test(resolved)) return resolved;

  const forceAuthFetch = !!opts?.forceAuthFetch;
  const token = getAuthToken();
  if (!token && !forceAuthFetch) return resolved;

  let parsed: URL;
  try {
    parsed = new URL(resolved, window.location.origin);
  } catch (_) {
    return resolved;
  }

  const pathname = String(parsed.pathname || '');
  if (!isProtectedAssetPath(pathname) && !isProtectedProxyAssetPath(pathname)) {
    return resolved;
  }

  try {
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(parsed.toString(), {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) return resolved;

    const blob = await response.blob();
    if (!blob || blob.size === 0) return resolved;
    return URL.createObjectURL(blob);
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

export function formatDate(value: unknown): string {
  const date = parseDate(value);
  if (!date) return '--/--/----';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  } catch (_) {
    return '--/--/----';
  }
}
