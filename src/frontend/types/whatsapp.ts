export interface WhatsAppQrState {
  connected: boolean;
  stableConnected?: boolean;
  connectionState: string;
  provider?: string;
  setupRequired?: boolean;
  message?: string;
  qrDataUrl?: string | null;
}
