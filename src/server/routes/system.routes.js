const express = require('express');

function createSystemRouter({ whatsappClient }) {
  const router = express.Router();

  router.get('/connection-status', (_req, res) => {
    const state = typeof whatsappClient.getQrState === 'function' ? whatsappClient.getQrState() : null;
    const activeSender = typeof whatsappClient.getActiveSender === 'function' ? whatsappClient.getActiveSender() : null;
    const connectionState = state && state.connectionState ? String(state.connectionState) : 'unknown';
    const connected = !!(state && state.connected);

    let message = connected ? 'WhatsApp conectado' : 'WhatsApp desconectado';
    if (connectionState === 'token_expired') {
      message = 'WA_CLOUD_ACCESS_TOKEN expirado';
    } else if (connectionState === 'missing_config') {
      message = 'Configuração da WhatsApp Cloud API ausente';
    } else if (connectionState === 'missing_verify_token') {
      message = 'WA_CLOUD_VERIFY_TOKEN ausente';
    } else if (connected && activeSender && activeSender.isTestNumber === true) {
      message = 'WhatsApp conectado com número de teste';
    }

    res.json({
      connected,
      connectionState,
      message,
      activeSender,
    });
  });

  return router;
}

module.exports = {
  createSystemRouter,
};
