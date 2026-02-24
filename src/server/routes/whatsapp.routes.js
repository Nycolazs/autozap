const express = require('express');

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function createWhatsAppRouter({ whatsappClient, db, requireAdmin }) {
  const router = express.Router();

  router.get('/whatsapp/qr', async (_req, res) => {
    try {
      const state = whatsappClient.getQrState ? whatsappClient.getQrState() : {};
      const activeSender = whatsappClient.getActiveSender ? whatsappClient.getActiveSender() : null;
      const connectionState = state && state.connectionState ? state.connectionState : 'unknown';
      const setupRequired = connectionState === 'missing_config'
        || connectionState === 'missing_verify_token'
        || connectionState === 'token_expired';

      const messageByState = {
        missing_config: 'Configure WA_CLOUD_ACCESS_TOKEN e WA_CLOUD_PHONE_NUMBER_ID no ambiente.',
        missing_verify_token: 'Configure WA_CLOUD_VERIFY_TOKEN no ambiente.',
        token_expired: 'WA_CLOUD_ACCESS_TOKEN expirado. Gere um novo token no Meta e atualize o sistema.',
      };

      return res.json({
        connected: !!(state && state.connected),
        stableConnected: !!(state && state.stableConnected),
        connectionState,
        reconnectAttempts: state && state.reconnectAttempts ? state.reconnectAttempts : 0,
        reconnectScheduledAt: state && state.reconnectScheduledAt ? state.reconnectScheduledAt : null,
        qrAt: null,
        lastConnectedAt: state && state.lastConnectedAt ? state.lastConnectedAt : null,
        lastDisconnectedAt: state && state.lastDisconnectedAt ? state.lastDisconnectedAt : null,
        lastDisconnectCode: state && state.lastDisconnectCode ? state.lastDisconnectCode : null,
        lastDisconnectReason: state && state.lastDisconnectReason ? state.lastDisconnectReason : null,
        qrDataUrl: null,
        provider: 'whatsapp_cloud_api',
        activeSender,
        setupRequired,
        message: setupRequired
          ? (messageByState[connectionState] || 'Configuração pendente da WhatsApp Cloud API.')
          : 'Integração via WhatsApp Cloud API ativa.',
      });
    } catch (_error) {
      return res.status(500).json({
        connected: false,
        stableConnected: false,
        connectionState: 'error',
        reconnectAttempts: 0,
        reconnectScheduledAt: null,
        qrAt: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastDisconnectCode: 'error',
        lastDisconnectReason: 'backend_error',
        qrDataUrl: null,
        provider: 'whatsapp_cloud_api',
        activeSender: null,
        setupRequired: true,
        message: 'Erro ao consultar estado da integração WhatsApp Cloud API.',
      });
    }
  });

  router.post('/whatsapp/qr/refresh', async (_req, res) => {
    try {
      const result = await whatsappClient.forceNewQr();
      if (!result || !result.ok) {
        return res.status(400).json({
          error: 'Integração não configurada. Defina as variáveis da WhatsApp Cloud API.',
        });
      }
      return res.json({ success: true, provider: 'whatsapp_cloud_api' });
    } catch (_error) {
      return res.status(500).json({ error: 'Erro ao validar integração WhatsApp Cloud API' });
    }
  });

  router.post('/whatsapp/logout', requireAdmin, async (req, res) => {
    try {
      const deleteDb = parseBoolean(req.body && req.body.deleteDb);

      if (deleteDb) {
        const result = db.clearAllData ? db.clearAllData() : { ok: false, error: 'clearAllData indisponível' };
        if (!result || result.ok !== true) {
          return res.status(500).json({
            error: 'Erro ao limpar banco de dados',
            details: result && result.error ? result.error : 'unknown',
          });
        }
      }

      return res.json({
        success: true,
        message: 'Operação concluída. Para desconectar da API oficial, remova/revoque o token no Meta App.',
      });
    } catch (_error) {
      return res.status(500).json({ error: 'Erro ao processar desconexão' });
    }
  });

  return router;
}

module.exports = {
  createWhatsAppRouter,
};
