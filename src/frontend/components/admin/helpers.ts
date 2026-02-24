import { ApiRequestError } from '@/src/frontend/lib/http';

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

export function parseCompositeId(value: string): { type: 'admin' | 'seller' | 'unknown'; id: number | null } {
  const raw = String(value || '').trim();
  if (!raw) return { type: 'unknown', id: null };

  if (raw.startsWith('admin_')) {
    const id = Number(raw.slice(6));
    return { type: 'admin', id: Number.isFinite(id) ? id : null };
  }

  if (raw.startsWith('seller_')) {
    const id = Number(raw.slice(7));
    return { type: 'seller', id: Number.isFinite(id) ? id : null };
  }

  const asNumber = Number(raw);
  return { type: 'unknown', id: Number.isFinite(asNumber) ? asNumber : null };
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function normalizePhone(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function formatPhoneBr(value: string): string {
  const digits = normalizePhone(value);
  if (!digits) return '';
  if (digits.length >= 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.length >= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  return digits;
}

export function toIsoDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
