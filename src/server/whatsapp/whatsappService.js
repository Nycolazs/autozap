'use strict';

// Camada de adaptação para centralizar o acesso ao provedor oficial
// WhatsApp Cloud API em um único ponto.

const cloudApiClient = require('./cloudApiClient');

const startBot = typeof cloudApiClient === 'function' ? cloudApiClient : cloudApiClient?.startBot;

module.exports = {
  // API normalizada
  startBot,
  getSocket: cloudApiClient.getSocket,
  getQrState: cloudApiClient.getQrState,
  forceNewQr: cloudApiClient.forceNewQr,
  processWebhookPayload: cloudApiClient.processWebhookPayload,
  verifyWebhook: cloudApiClient.verifyWebhook,
  isConfigured: cloudApiClient.isConfigured,
  getConfig: cloudApiClient.getConfig,
  getActiveSender: cloudApiClient.getActiveSender,
  downloadMediaById: cloudApiClient.downloadMediaById,
  client: cloudApiClient,
};
