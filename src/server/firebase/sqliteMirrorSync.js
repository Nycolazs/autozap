'use strict';

const { getFirestore, isFirebaseConfigured } = require('./firebaseClient');
const { createLogger } = require('../logger');

const logger = createLogger('firebase-mirror');

const ROOT_COLLECTION = (process.env.FIREBASE_DB_ROOT || 'autozap').trim();
const FLUSH_DEBOUNCE_MS = Number(process.env.FIREBASE_SYNC_DEBOUNCE_MS || 3000);

const TABLE_CONFIGS = [
  { table: 'settings', pk: 'key', pkType: 'string' },
  { table: 'business_hours', pk: 'day', pkType: 'number' },
  { table: 'business_exceptions', pk: 'id', pkType: 'number' },
  { table: 'users', pk: 'id', pkType: 'number' },
  { table: 'sellers', pk: 'id', pkType: 'number' },
  { table: 'tickets', pk: 'id', pkType: 'number' },
  { table: 'contact_profiles', pk: 'phone', pkType: 'string' },
  { table: 'messages', pk: 'id', pkType: 'number' },
  { table: 'ticket_reminders', pk: 'id', pkType: 'number' },
  { table: 'quick_messages', pk: 'id', pkType: 'number' },
  { table: 'blacklist', pk: 'id', pkType: 'number' },
  { table: 'out_of_hours_log', pk: 'phone', pkType: 'string' },
];

let contextResolver = null;
let flushTimer = null;
let flushInFlight = false;
let dirtyPending = false;
const bootstrapPromises = new Map();
let warnedDisabled = false;

function isEnabled() {
  const enabled = isFirebaseConfigured();
  if (!enabled && !warnedDisabled) {
    warnedDisabled = true;
    if ((process.env.FIREBASE_PROJECT_ID || '').trim()) {
      logger.warn('[firebase] FIREBASE_PROJECT_ID definido, mas credenciais de service account nao foram configuradas.');
    } else {
      logger.warn('[firebase] Sincronizacao com Firebase desativada (credenciais ausentes).');
    }
  }
  return enabled;
}

function firestore() {
  return getFirestore();
}

function resolveAccountId(raw) {
  const trimmed = String(raw || '').trim();
  return trimmed || 'default';
}

function getAccountDoc(accountId) {
  const db = firestore();
  if (!db) return null;
  return db.collection(ROOT_COLLECTION).doc(resolveAccountId(accountId));
}

function setContextResolver(fn) {
  contextResolver = typeof fn === 'function' ? fn : null;
}

function normalizeForFirestoreRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value === undefined) {
      out[key] = null;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function normalizeFromFirestore(value) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (typeof value === 'boolean') return value ? 1 : 0;

  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  return value;
}

function getTableColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.map((row) => row.name);
}

function getLocalRows(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function hasLocalOperationalData(db) {
  try {
    const users = Number(db.prepare('SELECT COUNT(*) as c FROM users').get().c || 0);
    const sellers = Number(db.prepare('SELECT COUNT(*) as c FROM sellers').get().c || 0);
    const tickets = Number(db.prepare('SELECT COUNT(*) as c FROM tickets').get().c || 0);
    const messages = Number(db.prepare('SELECT COUNT(*) as c FROM messages').get().c || 0);
    return (users + sellers + tickets + messages) > 0;
  } catch (_) {
    return false;
  }
}

async function hasRemoteData(accountId) {
  const accountDoc = getAccountDoc(accountId);
  if (!accountDoc) return false;

  for (const cfg of TABLE_CONFIGS) {
    const snap = await accountDoc.collection(cfg.table).limit(1).get();
    if (!snap.empty) return true;
  }
  return false;
}

async function commitBatches(operations) {
  const db = firestore();
  if (!db || !operations || operations.length === 0) return;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      if (op.type === 'set') {
        batch.set(op.ref, op.data, { merge: false });
      } else if (op.type === 'delete') {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}

async function syncTableToFirebase(db, accountId, cfg) {
  const accountDoc = getAccountDoc(accountId);
  if (!accountDoc) return;

  const colRef = accountDoc.collection(cfg.table);
  const rows = getLocalRows(db, cfg.table);
  const localIds = new Set();
  const operations = [];

  for (const row of rows) {
    const pkValue = row[cfg.pk];
    if (pkValue === undefined || pkValue === null || String(pkValue) === '') continue;

    const docId = String(pkValue);
    localIds.add(docId);
    operations.push({
      type: 'set',
      ref: colRef.doc(docId),
      data: normalizeForFirestoreRow(row),
    });
  }

  const remoteSnap = await colRef.get();
  remoteSnap.forEach((doc) => {
    if (!localIds.has(doc.id)) {
      operations.push({ type: 'delete', ref: doc.ref });
    }
  });

  await commitBatches(operations);
}

async function pushAllToFirebase(db, accountId) {
  const accountDoc = getAccountDoc(accountId);
  if (!accountDoc) return;

  for (const cfg of TABLE_CONFIGS) {
    await syncTableToFirebase(db, accountId, cfg);
  }

  await accountDoc.collection('_meta').doc('state').set({
    accountId: resolveAccountId(accountId),
    syncedAt: new Date().toISOString(),
    rootCollection: ROOT_COLLECTION,
  }, { merge: true });
}

function normalizePrimaryKey(value, pkType, fallbackDocId) {
  if (value !== undefined && value !== null && String(value) !== '') {
    return normalizeFromFirestore(value);
  }
  if (pkType === 'number') {
    const parsed = Number(fallbackDocId);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return String(fallbackDocId || '');
}

async function restoreAllFromFirebase(db, accountId) {
  const accountDoc = getAccountDoc(accountId);
  if (!accountDoc) return;

  const tableSnapshots = new Map();

  for (const cfg of TABLE_CONFIGS) {
    const snap = await accountDoc.collection(cfg.table).get();
    tableSnapshots.set(cfg.table, snap);
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN TRANSACTION;');

    // Limpa todas as tabelas alvo antes de restaurar
    for (let i = TABLE_CONFIGS.length - 1; i >= 0; i -= 1) {
      const cfg = TABLE_CONFIGS[i];
      db.prepare(`DELETE FROM ${cfg.table}`).run();
    }

    // Restaura em ordem
    for (const cfg of TABLE_CONFIGS) {
      const snap = tableSnapshots.get(cfg.table);
      if (!snap || snap.empty) continue;

      const columns = getTableColumns(db, cfg.table);
      if (!columns.length) continue;

      for (const doc of snap.docs) {
        const rawData = doc.data() || {};
        const row = {};

        for (const col of columns) {
          row[col] = normalizeFromFirestore(rawData[col]);
        }

        row[cfg.pk] = normalizePrimaryKey(rawData[cfg.pk], cfg.pkType, doc.id);

        const filteredColumns = columns.filter((col) => row[col] !== undefined);
        if (!filteredColumns.length) continue;

        const placeholders = filteredColumns.map(() => '?').join(',');
        const sql = `INSERT OR REPLACE INTO ${cfg.table} (${filteredColumns.join(',')}) VALUES (${placeholders})`;
        const values = filteredColumns.map((col) => row[col]);
        db.prepare(sql).run(...values);
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

async function bootstrapAccount(db, accountId) {
  if (!isEnabled()) return;
  const accountKey = resolveAccountId(accountId);

  if (bootstrapPromises.has(accountKey)) {
    return bootstrapPromises.get(accountKey);
  }

  const promise = (async () => {
    const remoteExists = await hasRemoteData(accountKey);
    const localExists = hasLocalOperationalData(db);

    if (remoteExists) {
      await restoreAllFromFirebase(db, accountKey);
      logger.info(`[firebase] Conta ${accountKey} restaurada do Firebase`);
    } else {
      await pushAllToFirebase(db, accountKey);
      logger.info(`[firebase] Conta ${accountKey} enviada para Firebase (${localExists ? 'dados locais' : 'seed inicial'})`);
    }
  })()
    .catch((err) => {
      logger.error('[firebase] Falha no bootstrap da conta:', err);
    })
    .finally(() => {
      bootstrapPromises.delete(accountKey);
    });

  bootstrapPromises.set(accountKey, promise);
  return promise;
}

async function flushNow() {
  if (!isEnabled() || !contextResolver) return;
  if (flushInFlight) {
    dirtyPending = true;
    return;
  }

  flushInFlight = true;
  dirtyPending = false;

  try {
    const ctx = contextResolver();
    if (!ctx || !ctx.db) return;

    const accountId = resolveAccountId(ctx.accountId);
    await pushAllToFirebase(ctx.db, accountId);
  } catch (err) {
    logger.error('[firebase] Falha ao sincronizar mutações:', err);
  } finally {
    flushInFlight = false;
    if (dirtyPending) {
      scheduleFlush();
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushNow();
  }, FLUSH_DEBOUNCE_MS);
  try {
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  } catch (_) {}
}

function notifyMutation() {
  if (!isEnabled()) return;
  dirtyPending = true;
  scheduleFlush();
}

module.exports = {
  isEnabled,
  setContextResolver,
  bootstrapAccount,
  notifyMutation,
  flushNow,
};
