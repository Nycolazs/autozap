import { requestJson } from '@/src/frontend/lib/http';
import type { WhatsAppQrState } from '@/src/frontend/types/whatsapp';

export function getWhatsAppQrStatus(): Promise<WhatsAppQrState> {
  return requestJson<WhatsAppQrState>('/whatsapp/qr', { method: 'GET' });
}

export function refreshWhatsAppQr(): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>('/whatsapp/qr/refresh', { method: 'POST' });
}
