'use strict';

const os = require('os');

const accountContext = require('../accountContext');
const { getFirestore, isFirebaseConfigured } = require('./firebaseClient');
const { createLogger } = require('../logger');

const logger = createLogger('firebase-webhook-sync');

const ROOT_COLLECTION = (process.env.FIREBASE_DB_ROOT || 'autozap').trim();
const QUEUE_COLLECTION = (process.env.FIREBASE_WEBHOOK_QUEUE_COLLECTION || '_whatsapp_webhooks').trim();
const POLL_MS = Math.max(300, Number(process.env.FIREBASE_WEBHOOK_POLL_MS || 1000));
const POLL_BATCH = Math.max(1, Math.min(50, Number(process.env.FIREBASE_WEBHOOK_POLL_BATCH || 20)));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.FIREBASE_WEBHOOK_MAX_ATTEMPTS || 5));
const SNAPSHOT_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.FIREBASE_WEBHOOK_SNAPSHOT_ENABLED || '1').trim().toLowerCase());

function isEnabledByEnv() {
  const flag = String(process.env.FIREBASE_WEBHOOK_QUEUE_ENABLED || '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(flag);
}

function resolveAccountId() {
  const active = accountContext && typeof accountContext.getActiveAccount === 'function'
    ? String(accountContext.getActiveAccount() || '').trim()
    : '';
  const envValue = String(process.env.AUTOZAP_ACCOUNT_ID || '').trim();
  return active || envValue || 'default';
}

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

async function claimPendingDocument(firestore, docRef, processorId) {
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return { ok: false };

    const data = snap.data() || {};
    if (String(data.status || 'pending') !== 'pending') {
      return { ok: false };
    }

    const attempts = Number(data.attempts || 0) + 1;
    const nowIso = new Date().toISOString();

    tx.set(docRef, {
      status: 'processing',
      attempts,
      processingBy: processorId,
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    }, { merge: true });

    return { ok: true, attempts, data };
  });
}

function createNoopController() {
  return {
    enabled: false,
    stop() {},
  };
}

function startWebhookInboxSync({ processWebhookPayload }) {
  if (!isEnabledByEnv()) {
    logger.info('[queue] Sincronizacao de webhooks do Firebase desativada por FIREBASE_WEBHOOK_QUEUE_ENABLED.');
    return createNoopController();
  }

  if (!isFirebaseConfigured()) {
    logger.info('[queue] Firebase nao configurado; consumidor de webhook remoto desativado.');
    return createNoopController();
  }

  if (typeof processWebhookPayload !== 'function') {
    logger.warn('[queue] processWebhookPayload ausente; consumidor de webhook remoto desativado.');
    return createNoopController();
  }

  const firestore = getFirestore();
  if (!firestore) {
    logger.warn('[queue] Firestore indisponivel; consumidor de webhook remoto desativado.');
    return createNoopController();
  }

  const processorId = `${os.hostname()}:${process.pid}`;

  let stopped = false;
  let timer = null;
  let inFlight = false;
  let immediateTickScheduled = false;
  let unsubscribe = null;

  function scheduleImmediateTick() {
    if (stopped || immediateTickScheduled) return;
    immediateTickScheduled = true;
    setImmediate(() => {
      immediateTickScheduled = false;
      tick().catch((err) => {
        logger.error('[queue] Tick imediato com falha:', err);
      });
    });
  }

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const accountId = resolveAccountId();
      const queueRef = firestore
        .collection(ROOT_COLLECTION)
        .doc(accountId)
        .collection(QUEUE_COLLECTION);

      const snap = await queueRef
        .where('status', '==', 'pending')
        .limit(POLL_BATCH)
        .get();

      if (snap.empty) return;
      let processedCount = 0;

      for (const doc of snap.docs) {
        if (stopped) break;

        const claim = await claimPendingDocument(firestore, doc.ref, processorId);
        if (!claim || !claim.ok) continue;

        const payload = claim.data && claim.data.payload ? claim.data.payload : null;
        if (!payload || typeof payload !== 'object') {
          await doc.ref.set({
            status: 'error',
            updatedAt: new Date().toISOString(),
            lastError: 'Payload ausente ou invalido na fila de webhook',
          }, { merge: true });
          continue;
        }

        try {
          await processWebhookPayload(payload);
          await doc.ref.set({
            status: 'processed',
            updatedAt: new Date().toISOString(),
            processedAt: new Date().toISOString(),
            processedBy: processorId,
            lastError: null,
            payloadSummary: summarizePayload(payload),
          }, { merge: true });
          processedCount += 1;
        } catch (err) {
          const errMessage = String((err && err.message) || err || 'erro desconhecido').slice(0, 1000);
          const shouldRetry = Number(claim.attempts || 0) < MAX_ATTEMPTS;

          await doc.ref.set({
            status: shouldRetry ? 'pending' : 'error',
            updatedAt: new Date().toISOString(),
            lastError: errMessage,
            lastFailedAt: new Date().toISOString(),
          }, { merge: true });

          logger.error(`[queue] Falha ao processar webhook remoto (doc=${doc.id}, tentativa=${claim.attempts}): ${errMessage}`);
        }
      }

      // Drena backlog sem esperar o próximo poll.
      if (!stopped && (snap.size >= POLL_BATCH || processedCount >= POLL_BATCH)) {
        scheduleImmediateTick();
      }
    } catch (err) {
      logger.error('[queue] Falha no polling da fila de webhooks do Firebase:', err);
    } finally {
      inFlight = false;
    }
  }

  if (SNAPSHOT_ENABLED) {
    try {
      const listenerAccountId = resolveAccountId();
      const listenerQueueRef = firestore
        .collection(ROOT_COLLECTION)
        .doc(listenerAccountId)
        .collection(QUEUE_COLLECTION);

      unsubscribe = listenerQueueRef
        .where('status', '==', 'pending')
        .limit(POLL_BATCH)
        .onSnapshot((snap) => {
          if (stopped || !snap || snap.empty) return;
          scheduleImmediateTick();
        }, (err) => {
          logger.error('[queue] Falha no listener em tempo real da fila de webhooks:', err);
        });

      logger.info('[queue] Listener em tempo real da fila de webhooks ativado.');
    } catch (err) {
      logger.error('[queue] Nao foi possivel ativar listener em tempo real da fila de webhooks:', err);
      unsubscribe = null;
    }
  }

  timer = setInterval(() => {
    tick().catch((err) => {
      logger.error('[queue] Tick com falha inesperada:', err);
    });
  }, POLL_MS);

  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  tick().catch((err) => {
    logger.error('[queue] Tick inicial com falha:', err);
  });

  logger.info(`[queue] Consumidor de webhook remoto ativo (poll=${POLL_MS}ms, batch=${POLL_BATCH}, maxAttempts=${MAX_ATTEMPTS}).`);

  return {
    enabled: true,
    stop() {
      stopped = true;
      if (unsubscribe) {
        try { unsubscribe(); } catch (_) {}
        unsubscribe = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info('[queue] Consumidor de webhook remoto parado.');
    },
  };
}

module.exports = {
  startWebhookInboxSync,
};
