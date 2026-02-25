#!/usr/bin/env node
'use strict';

require('dotenv').config();

const accountContext = require('../src/server/accountContext');
const { getFirestore, isFirebaseConfigured } = require('../src/server/firebase/firebaseClient');
const whatsappClient = require('../src/server/whatsapp/cloudApiClient');

const ROOT_COLLECTION = (process.env.FIREBASE_DB_ROOT || 'autozap').trim();
const QUEUE_COLLECTION = (process.env.FIREBASE_WEBHOOK_QUEUE_COLLECTION || '_whatsapp_webhooks').trim();
const DEFAULT_ACCOUNT_ID = (process.env.AUTOZAP_ACCOUNT_ID || 'default').trim() || 'default';
const DEFAULT_BATCH = 200;

function parseArgs(argv) {
  const args = {
    account: DEFAULT_ACCOUNT_ID,
    from: '',
    to: '',
    batch: DEFAULT_BATCH,
    maxDocs: 2000,
    statuses: ['processed', 'pending', 'error'],
    dryRun: false,
    markReplayed: false,
  };

  for (const token of argv) {
    const raw = String(token || '').trim();
    if (!raw) continue;

    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (raw === '--mark-replayed') {
      args.markReplayed = true;
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      args.help = true;
      continue;
    }

    const idx = raw.indexOf('=');
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();

    if (key === '--account' && value) {
      args.account = value;
      continue;
    }
    if (key === '--from') {
      args.from = value;
      continue;
    }
    if (key === '--to') {
      args.to = value;
      continue;
    }
    if (key === '--batch') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        args.batch = Math.max(1, Math.min(500, Math.trunc(n)));
      }
      continue;
    }
    if (key === '--max-docs') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        args.maxDocs = Math.max(1, Math.min(20000, Math.trunc(n)));
      }
      continue;
    }
    if (key === '--statuses') {
      const parsed = value
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
      if (parsed.length) {
        args.statuses = Array.from(new Set(parsed));
      }
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log('Reprocessa backlog de webhooks do Firebase para recuperar mensagens pendentes no banco local.');
  console.log('');
  console.log('Uso:');
  console.log('  node scripts/replay-webhook-backlog.js [opcoes]');
  console.log('');
  console.log('Opcoes:');
  console.log('  --account=<id>         Conta AutoZap (padrao: env AUTOZAP_ACCOUNT_ID ou "default")');
  console.log('  --from=<ISO>           Inicio do range (ex: 2026-02-24T00:00:00Z)');
  console.log('  --to=<ISO>             Fim do range (ex: 2026-02-26T00:00:00Z)');
  console.log('  --batch=<n>            Tamanho de pagina no Firestore (1..500, padrao 200)');
  console.log('  --max-docs=<n>         Limite total de docs lidos (1..20000, padrao 2000)');
  console.log('  --statuses=a,b,c       Status na fila (padrao: processed,pending,error)');
  console.log('  --dry-run              Apenas simula (nao grava no banco local)');
  console.log('  --mark-replayed        Marca documento com replayedAt/replayedBy');
  console.log('  --help                 Exibe ajuda');
}

function parseIsoDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

function summarizePayload(payload) {
  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  let messages = 0;
  let statuses = 0;
  for (const entry of entries) {
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change && change.value ? change.value : null;
      if (!value) continue;
      if (Array.isArray(value.messages)) messages += value.messages.length;
      if (Array.isArray(value.statuses)) statuses += value.statuses.length;
    }
  }
  if (messages === 0 && Array.isArray(payload && payload.messages)) {
    messages = payload.messages.length;
  }
  if (statuses === 0 && Array.isArray(payload && payload.statuses)) {
    statuses = payload.statuses.length;
  }
  return { messages, statuses };
}

async function fetchDocsForStatus({
  queueRef,
  status,
  fromDate,
  toDate,
  batch,
  maxDocs,
}) {
  const collected = [];
  let cursor = null;

  const fromMs = fromDate ? fromDate.getTime() : null;
  const toMs = toDate ? toDate.getTime() : null;

  while (collected.length < maxDocs) {
    let query = queueRef.where('status', '==', status).limit(batch);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (!snap || snap.empty) break;

    for (const doc of snap.docs) {
      const receivedAt = doc.get('receivedAt');
      const receivedMs = receivedAt && typeof receivedAt.toMillis === 'function'
        ? receivedAt.toMillis()
        : null;

      if (fromMs != null && (receivedMs == null || receivedMs < fromMs)) {
        continue;
      }
      if (toMs != null && (receivedMs == null || receivedMs > toMs)) {
        continue;
      }

      collected.push(doc);
      if (collected.length >= maxDocs) break;
    }

    cursor = snap.docs[snap.docs.length - 1] || null;
    if (!cursor || snap.size < batch) break;
  }

  return collected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const fromDate = parseIsoDate(args.from);
  if (args.from && !fromDate) {
    throw new Error(`--from inválido: ${args.from}`);
  }
  const toDate = parseIsoDate(args.to);
  if (args.to && !toDate) {
    throw new Error(`--to inválido: ${args.to}`);
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new Error('--from não pode ser maior que --to');
  }

  if (!isFirebaseConfigured()) {
    throw new Error('Firebase não configurado (credenciais ausentes).');
  }

  const firestore = getFirestore();
  if (!firestore) {
    throw new Error('Firestore indisponível.');
  }

  if (!args.account) {
    throw new Error('Conta inválida.');
  }
  accountContext.setActiveAccount(args.account);

  const queueRef = firestore
    .collection(ROOT_COLLECTION)
    .doc(args.account)
    .collection(QUEUE_COLLECTION);

  const statuses = Array.from(new Set(args.statuses))
    .map((item) => item.toLowerCase())
    .filter((item) => ['processed', 'pending', 'processing', 'error'].includes(item));

  if (!statuses.length) {
    throw new Error('Nenhum status válido em --statuses.');
  }

  console.log('[replay] iniciando');
  console.log(`[replay] account=${args.account}`);
  console.log(`[replay] statuses=${statuses.join(',')}`);
  console.log(`[replay] from=${fromDate ? fromDate.toISOString() : '(inicio)'}`);
  console.log(`[replay] to=${toDate ? toDate.toISOString() : '(agora)'}`);
  console.log(`[replay] batch=${args.batch} maxDocs=${args.maxDocs} dryRun=${args.dryRun ? '1' : '0'} markReplayed=${args.markReplayed ? '1' : '0'}`);

  const statusBudget = Math.max(1, Math.floor(args.maxDocs / statuses.length));
  const docsById = new Map();
  for (const status of statuses) {
    const found = await fetchDocsForStatus({
      queueRef,
      status,
      fromDate,
      toDate,
      batch: args.batch,
      maxDocs: statusBudget,
    });
    for (const doc of found) {
      docsById.set(doc.id, doc);
    }
  }

  const docs = Array.from(docsById.values()).sort((a, b) => {
    const left = a.get('receivedAt');
    const right = b.get('receivedAt');
    const l = left && typeof left.toMillis === 'function' ? left.toMillis() : 0;
    const r = right && typeof right.toMillis === 'function' ? right.toMillis() : 0;
    return l - r;
  });

  let processedDocs = 0;
  let skippedDocs = 0;
  let errorDocs = 0;
  let totalMessages = 0;
  let totalStatuses = 0;

  const replayedBy = `${require('os').hostname()}:${process.pid}`;

  for (const doc of docs) {
    const payload = doc.get('payload');
    if (!payload || typeof payload !== 'object') {
      skippedDocs += 1;
      continue;
    }

    const summary = summarizePayload(payload);
    totalMessages += summary.messages;
    totalStatuses += summary.statuses;

    if (!args.dryRun) {
      try {
        await whatsappClient.processWebhookPayload(payload);
        if (args.markReplayed) {
          await doc.ref.set({
            replayedAt: new Date().toISOString(),
            replayedBy,
          }, { merge: true });
        }
      } catch (err) {
        errorDocs += 1;
        const msg = String((err && err.message) || err || 'erro desconhecido');
        console.error(`[replay] falha doc=${doc.id}: ${msg}`);
        continue;
      }
    }

    processedDocs += 1;
  }

  console.log('[replay] concluído');
  console.log(`[replay] docs_lidos=${docs.length}`);
  console.log(`[replay] docs_processados=${processedDocs}`);
  console.log(`[replay] docs_ignorados=${skippedDocs}`);
  console.log(`[replay] docs_com_erro=${errorDocs}`);
  console.log(`[replay] mensagens_no_payload=${totalMessages}`);
  console.log(`[replay] statuses_no_payload=${totalStatuses}`);
}

main().catch((err) => {
  const message = String((err && err.message) || err || 'erro desconhecido');
  console.error(`[replay] erro fatal: ${message}`);
  process.exitCode = 1;
});
