import { getAuthToken, resolveApiUrl } from '../api/client';

export function resolveMediaUrl(mediaPath: string | null | undefined): string {
  const raw = String(mediaPath || '').trim();
  if (!raw) return '';
  if (/^(blob:|data:|https?:\/\/)/i.test(raw)) return raw;

  const resolved = resolveApiUrl(raw);
  if (!resolved) return raw;

  const token = getAuthToken();
  if (!token) return resolved;

  if (!resolved.includes('/media/wa/')) return resolved;
  if (resolved.includes('auth=')) return resolved;

  return resolved.includes('?') ? `${resolved}&auth=${encodeURIComponent(token)}` : `${resolved}?auth=${encodeURIComponent(token)}`;
}
