import { getAuthToken, resolveApiUrl } from '../api/client';

function normalizePhoneDigits(value: unknown): string {
  return String(value || '').split('@')[0].replace(/\D/g, '');
}

function isProtectedMediaPath(pathname: string): boolean {
  const normalized = String(pathname || '');
  if (normalized.includes('/media/wa/')) return true;
  if (normalized.includes('/media/profiles/')) return true;
  if (/\/profile-picture\/[^/]+\/image$/i.test(normalized)) return true;
  return false;
}

function withAuthParam(url: string, token: string): string {
  if (!token) return url;
  if (url.includes('auth=')) return url;
  return url.includes('?') ? `${url}&auth=${encodeURIComponent(token)}` : `${url}?auth=${encodeURIComponent(token)}`;
}

export function resolveMediaUrl(mediaPath: string | null | undefined): string {
  const raw = String(mediaPath || '').trim();
  if (!raw) return '';
  if (/^(blob:|data:)/i.test(raw)) return raw;

  const token = getAuthToken();
  if (/^https?:\/\//i.test(raw)) {
    if (!token) return raw;
    try {
      const parsed = new URL(raw);
      if (!isProtectedMediaPath(parsed.pathname || '')) return raw;
      return withAuthParam(raw, token);
    } catch (_) {
      return raw;
    }
  }

  const resolved = resolveApiUrl(raw);
  if (!resolved) return raw;

  if (!token) return resolved;
  try {
    const parsed = new URL(resolved);
    if (!isProtectedMediaPath(parsed.pathname || '')) return resolved;
  } catch (_) {
    if (!isProtectedMediaPath(resolved)) return resolved;
  }
  return withAuthParam(resolved, token);
}

export function resolveProfilePictureUrl(phone: string | null | undefined, directUrl?: string | null): string {
  const rawDirect = String(directUrl || '').trim();
  const normalizedPhone = normalizePhoneDigits(phone);
  if (/^(blob:|data:)/i.test(rawDirect)) return rawDirect;
  if (/^https?:\/\//i.test(rawDirect) && normalizedPhone) {
    return resolveMediaUrl(`/profile-picture/${encodeURIComponent(normalizedPhone)}/image`);
  }
  if (/^\/profile-picture\/[^/]+\/image(?:\?.*)?$/i.test(rawDirect)) {
    return resolveMediaUrl(rawDirect);
  }
  if (/^\/media\/profiles\//i.test(rawDirect)) {
    if (normalizedPhone) {
      return resolveMediaUrl(`/profile-picture/${encodeURIComponent(normalizedPhone)}/image`);
    }
    return resolveMediaUrl(rawDirect);
  }
  return rawDirect ? resolveMediaUrl(rawDirect) : '';
}
