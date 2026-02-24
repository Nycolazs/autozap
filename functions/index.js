'use strict';

const crypto = require('crypto');

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();

const REGION = (process.env.AUTOZAP_FUNCTION_REGION || 'us-central1').trim();
const ROOT_COLLECTION = (process.env.AUTOZAP_DB_ROOT || process.env.FIREBASE_DB_ROOT || 'autozap').trim();
const ACCOUNT_ID = (process.env.AUTOZAP_ACCOUNT_ID || 'default').trim() || 'default';
const QUEUE_COLLECTION = (process.env.AUTOZAP_WEBHOOK_QUEUE_COLLECTION || process.env.FIREBASE_WEBHOOK_QUEUE_COLLECTION || '_whatsapp_webhooks').trim();

setGlobalOptions({
  region: REGION,
  maxInstances: Number(process.env.FUNCTION_MAX_INSTANCES || 20),
});

function summarizePayload(payload) {
  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];

  let changes = 0;
  let messages = 0;
  let statuses = 0;

  for (const entry of entries) {
    const entryChanges = Array.isArray(entry && entry.changes) ? entry.changes : [];
    changes += entryChanges.length;
    for (const change of entryChanges) {
      const value = change && change.value ? change.value : null;
      if (!value) continue;
      if (Array.isArray(value.messages)) messages += value.messages.length;
      if (Array.isArray(value.statuses)) statuses += value.statuses.length;
    }
  }

  if (messages === 0 && payload && Array.isArray(payload.messages)) {
    messages = payload.messages.length;
  }
  if (statuses === 0 && payload && Array.isArray(payload.statuses)) {
    statuses = payload.statuses.length;
  }

  return {
    object: payload && payload.object ? String(payload.object) : null,
    entries: entries.length,
    changes,
    messages,
    statuses,
  };
}

function readVerifyToken() {
  return String(process.env.WA_CLOUD_VERIFY_TOKEN || '').trim();
}

function readAppSecret() {
  return String(process.env.WA_CLOUD_APP_SECRET || '').trim();
}

function isValidSignature(req, appSecret) {
  const signature = String(req.get('x-hub-signature-256') || '').trim();
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

async function enqueueWebhookPayload(payload, req) {
  const queueRef = firestore
    .collection(ROOT_COLLECTION)
    .doc(ACCOUNT_ID)
    .collection(QUEUE_COLLECTION)
    .doc();

  const nowIso = new Date().toISOString();

  await queueRef.set({
    status: 'pending',
    attempts: 0,
    source: 'meta_whatsapp_cloud_api',
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: nowIso,
    payload: payload || {},
    payloadSummary: summarizePayload(payload || {}),
    requestMeta: {
      userAgent: String(req.get('user-agent') || '').slice(0, 300),
      signaturePresent: !!String(req.get('x-hub-signature-256') || '').trim(),
    },
  }, { merge: false });

  return queueRef.id;
}

exports.whatsappWebhook = onRequest(async (req, res) => {
  try {
    if (req.method === 'GET') {
      const mode = String(req.query['hub.mode'] || '');
      const token = String(req.query['hub.verify_token'] || '');
      const challenge = String(req.query['hub.challenge'] || '');
      const verifyToken = readVerifyToken();

      if (!verifyToken) {
        logger.error('WA_CLOUD_VERIFY_TOKEN nao configurado na Function.');
        return res.status(500).json({ error: 'WA_CLOUD_VERIFY_TOKEN ausente na Function' });
      }

      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('webhook_verify_ok', { mode });
        return res.status(200).send(challenge);
      }

      logger.warn('webhook_verify_failed', { mode });
      return res.status(403).json({ error: 'Webhook verification failed' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const appSecret = readAppSecret();
    if (appSecret && !isValidSignature(req, appSecret)) {
      logger.warn('Webhook rejeitado por assinatura invalida.');
      return res.status(403).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const summary = summarizePayload(payload);
    logger.info('webhook_received', summary);
    const queueDocId = await enqueueWebhookPayload(payload, req);
    logger.info('webhook_queued', { queueDocId, summary });

    return res.status(200).json({
      received: true,
      queued: true,
      queueDocId,
    });
  } catch (err) {
    logger.error('Falha na Function whatsappWebhook', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
