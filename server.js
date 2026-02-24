'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const next = require('next');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');

const db = require('./src/server/db');
const accountContext = require('./src/server/accountContext');
const accountManager = require('./src/server/accountManager');
const storagePaths = require('./src/server/storagePaths');
const whatsappService = require('./src/server/whatsapp/whatsappService');
const { hashPassword, verifyPassword } = require('./src/server/security/password');
const { requireAuth, requireAdmin } = require('./src/server/middleware/auth');
const { generalLimiter } = require('./src/server/middleware/rateLimiter');
const { createSystemRouter } = require('./src/server/routes/system.routes');
const { createWhatsAppRouter } = require('./src/server/routes/whatsapp.routes');
const { createAuthRouter } = require('./src/server/routes/auth.routes');
const { createUsersRouter } = require('./src/server/routes/users.routes');
const { createTicketsRouter } = require('./src/server/routes/tickets.routes');
const { createContactsRouter } = require('./src/server/routes/contacts.routes');
const { createBlacklistRouter } = require('./src/server/routes/blacklist.routes');
const { createHealthRouter } = require('./src/server/routes/health.routes');
const { createAdminConfigRouter } = require('./src/server/routes/admin-config.routes');
const { createEventsRouter } = require('./src/server/routes/events.routes');
const { startAutoAwaitJob } = require('./src/server/jobs/autoAwait');
const { startWebhookInboxSync } = require('./src/server/firebase/webhookInboxSync');
const { installGracefulShutdown } = require('./src/server/server/gracefulShutdown');
const { attachRealtimeWebSocket } = require('./src/server/server/realtime-ws');
const { createSessionMiddleware } = require('./src/server/session/createSessionMiddleware');
const { createLogger } = require('./src/server/logger');

const logger = createLogger('server');

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();
const DESKTOP_RUNTIME_HEADERS = new Set(['desktop', 'electron', 'proton']);
const FRONTEND_ROUTES = new Set([
  '/',
  '/login',
  '/welcome',
  '/agent',
  '/admin-sellers',
  '/whatsapp-qr',
  '/setup-admin',
]);

function isFrontendRequest(pathname) {
  const pathValue = String(pathname || '');
  if (FRONTEND_ROUTES.has(pathValue)) return true;
  if (pathValue.startsWith('/_next/')) return true;
  if (pathValue.startsWith('/icon-')) return true;
  if (pathValue === '/manifest.json' || pathValue === '/sw.js' || pathValue === '/ui.js' || pathValue === '/ui.css' || pathValue === '/config.js') return true;
  if (pathValue.endsWith('.html') || pathValue.endsWith('.css') || pathValue.endsWith('.js')) return true;
  return false;
}

function isDesktopRuntimeRequest(req) {
  const runtimeHeader = String((req.headers['x-autozap-runtime'] || req.headers['x-whatsapp-system-runtime'] || '')).trim().toLowerCase();
  return DESKTOP_RUNTIME_HEADERS.has(runtimeHeader);
}

function getAdminCount() {
  try {
    return db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count || 0;
  } catch (_) {
    return 0;
  }
}

function summarizeWebhookPayload(payload) {
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

  // Compatibilidade: payload já "desembrulhado".
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

function parseProxyApiBase(rawValue) {
  const normalized = String(rawValue || '').trim().replace(/\/+$/, '');
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function audioExtFromMime(mimetype, originalName) {
  const mime = String(mimetype || '').toLowerCase();
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('wav')) return '.wav';
  const fromName = String(path.extname(originalName || '') || '').toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  return '.bin';
}

function imageExtFromMime(mimetype, originalName) {
  const mime = String(mimetype || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  const fromName = String(path.extname(originalName || '') || '').toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  return '.jpg';
}

async function proxyApiRequest(req, res) {
  const targetBase = parseProxyApiBase(req.headers['x-api-base']);
  if (!targetBase) {
    return res.status(400).json({ error: 'x-api-base inválido para proxy' });
  }

  const originalUrl = String(req.originalUrl || '/__api');
  const upstreamPath = originalUrl.replace(/^\/__api/, '') || '/';
  const upstreamUrl = new URL(upstreamPath, `${targetBase.protocol}//${targetBase.host}`);

  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = String(key || '').toLowerCase();
    if (lower === 'host' || lower === 'x-api-base' || lower === 'origin' || lower === 'referer' || lower === 'content-length') {
      continue;
    }
    headers[key] = value;
  }
  headers.host = upstreamUrl.host;

  const method = String(req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let body = undefined;
  if (hasBody) {
    if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
      body = req.body;
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      body = JSON.stringify(req.body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    } else {
      body = req;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try { controller.abort(); } catch (_) {}
  }, Number(process.env.API_PROXY_TIMEOUT_MS || 30000));
  try {
    if (typeof timeout.unref === 'function') timeout.unref();
  } catch (_) {}

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body,
      duplex: hasBody ? 'half' : undefined,
      signal: controller.signal,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = String(key).toLowerCase();
      if (lower.startsWith('access-control-allow-')) return;
      if (lower === 'content-length') return;
      res.setHeader(key, value);
    });

    if (!upstream.body) {
      return res.end();
    }

    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => {
      try { res.end(); } catch (_) {}
    });
    stream.pipe(res);
    return;
  } catch (err) {
    logger.error('[proxy] erro ao encaminhar /__api:', err);
    return res.status(502).json({ error: 'Falha ao conectar na API configurada' });
  } finally {
    clearTimeout(timeout);
  }
}

async function bootstrap() {
  await nextApp.prepare();

  const app = express();
  const server = http.createServer(app);
  const webhookRuntime = {
    totalVerifyRequests: 0,
    totalWebhookPosts: 0,
    totalWebhookErrors: 0,
    lastVerifyAt: null,
    lastWebhookAt: null,
    lastWebhookSummary: null,
    lastWebhookError: null,
  };

  const trustProxy = Number(process.env.TRUST_PROXY || 0);
  if (trustProxy > 0) {
    app.set('trust proxy', trustProxy);
  }

  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://lookaside.fbsbx.com', 'https://pps.whatsapp.net'],
          connectSrc: ["'self'", '*'],
          mediaSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      hsts: process.env.NODE_ENV === 'production',
    })
  );

  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const nativeAppOrigins = new Set([
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
    'ionic://localhost',
  ]);

  const allowInsecureCookies = process.env.ALLOW_INSECURE_COOKIES === '1';
  const defaultSameSite = process.env.COOKIE_SAMESITE || (corsOrigins ? 'none' : (dev ? 'lax' : 'strict'));
  const cookieSecure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === '1'
    : (defaultSameSite === 'none' ? (allowInsecureCookies ? false : true) : (!dev));

  const sessionManager = createSessionMiddleware({
    accountContext,
    accountManager,
    secret: process.env.SESSION_SECRET || 'autozap-secret-key-change-me',
    cookie: {
      secure: cookieSecure,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: defaultSameSite,
    },
  });

  app.use(sessionManager.middleware);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (nativeAppOrigins.has(origin)) return cb(null, true);
      if (!corsOrigins) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200,
  }));

  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));

  app.use('/__api', (req, res) => {
    proxyApiRequest(req, res);
  });

  const requireDesktopFrontend = process.env.FRONTEND_REQUIRE_DESKTOP !== '0';
  if (requireDesktopFrontend) {
    app.use((req, res, next) => {
      const pathname = String(req.path || '');
      if (!isFrontendRequest(pathname)) return next();
      if (isDesktopRuntimeRequest(req)) return next();
      return res.status(403).json({
        error: 'Frontend disponível apenas no aplicativo desktop (macOS/Windows).',
      });
    });
  }

  const mediaRoot = storagePaths.resolveMediaDir();
  const audioDir = path.join(mediaRoot, 'audios');
  const imageDir = path.join(mediaRoot, 'images');
  const videoDir = path.join(mediaRoot, 'videos');
  const stickerDir = path.join(mediaRoot, 'stickers');
  const docDir = path.join(mediaRoot, 'documents');
  const profileDir = path.join(mediaRoot, 'profiles');
  [audioDir, imageDir, videoDir, stickerDir, docDir, profileDir].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  });

  const uploadAudio = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, audioDir),
      filename: (_req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 8);
        const ext = audioExtFromMime(file && file.mimetype, file && file.originalname);
        cb(null, `audio_${timestamp}_${random}${ext}`);
      },
    }),
    limits: { fileSize: Number(process.env.AUDIO_UPLOAD_MAX_BYTES || (10 * 1024 * 1024)) },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || '').startsWith('audio/')) {
        cb(null, true);
      } else {
        cb(new Error('Apenas arquivos de áudio são permitidos'));
      }
    },
  });

  const uploadProfileImage = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, profileDir),
      filename: (_req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 8);
        const ext = imageExtFromMime(file && file.mimetype, file && file.originalname);
        cb(null, `profile_${timestamp}_${random}${ext}`);
      },
    }),
    limits: { fileSize: Number(process.env.PROFILE_UPLOAD_MAX_BYTES || (5 * 1024 * 1024)) },
    fileFilter: (_req, file, cb) => {
      const mime = String(file && file.mimetype || '').toLowerCase();
      if (mime.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Apenas imagens são permitidas'));
      }
    },
  });

  app.use('/media', express.static(mediaRoot, {
    maxAge: process.env.MEDIA_CACHE_MAXAGE || '30d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }));

  const service = whatsappService;
  const whatsappClient = service.client || service;

  app.get('/media/wa/:mediaId', requireAuth, async (req, res) => {
    try {
      const mediaId = String(req.params.mediaId || '').trim();
      if (!mediaId) {
        return res.status(400).json({ error: 'mediaId é obrigatório' });
      }

      if (!service.downloadMediaById) {
        return res.status(501).json({ error: 'download de mídia indisponível' });
      }

      const media = await service.downloadMediaById(mediaId);
      if (!media || !media.buffer) {
        return res.status(404).json({ error: 'Mídia não encontrada' });
      }

      const mimeType = media.mimeType || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return res.status(200).send(media.buffer);
    } catch (err) {
      logger.error('[media] erro ao buscar mídia do WhatsApp:', err);
      return res.status(404).json({ error: 'Erro ao buscar mídia na API oficial do WhatsApp' });
    }
  });

  app.use(generalLimiter);

  app.get('/whatsapp/webhook', (req, res) => {
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    webhookRuntime.totalVerifyRequests += 1;
    webhookRuntime.lastVerifyAt = new Date().toISOString();

    if (service.verifyWebhook && service.verifyWebhook({ mode, token })) {
      return res.status(200).send(challenge);
    }

    return res.status(403).json({ error: 'Webhook verification failed' });
  });

  app.post('/whatsapp/webhook', async (req, res) => {
    webhookRuntime.totalWebhookPosts += 1;
    webhookRuntime.lastWebhookAt = new Date().toISOString();
    webhookRuntime.lastWebhookSummary = summarizeWebhookPayload(req.body || {});
    webhookRuntime.lastWebhookError = null;

    try {
      if (service.processWebhookPayload) {
        await service.processWebhookPayload(req.body || {});
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      webhookRuntime.totalWebhookErrors += 1;
      webhookRuntime.lastWebhookError = String(err && err.message ? err.message : err);
      logger.error('[webhook] erro ao processar payload', err);
      return res.status(200).json({ received: true });
    }
  });

  app.get('/whatsapp/webhook/status', (req, res) => {
    return res.json({
      ...webhookRuntime,
      now: new Date().toISOString(),
    });
  });

  app.use(createSystemRouter({ whatsappClient }));
  app.use(createWhatsAppRouter({ whatsappClient, db, requireAdmin }));
  app.use(createAuthRouter({ db, hashPassword, verifyPassword, getQrState: service.getQrState }));
  app.use(createUsersRouter({ db, hashPassword, requireAuth, requireAdmin, getAdminCount }));
  app.use(createTicketsRouter({ db, requireAuth, requireAdmin, getSocket: service.getSocket, uploadAudio }));
  app.use(createBlacklistRouter({ db, requireAdmin }));
  app.use(createContactsRouter({
    getSocket: service.getSocket,
    db,
    requireAuth,
    uploadProfileImage,
    mediaRoot,
  }));
  app.use(createEventsRouter({ requireAuth }));
  app.use(createHealthRouter({ getQrState: service.getQrState, accountContext, db, getSessionsPath: () => sessionManager.getCurrentSessionDbPath() }));
  app.use(createAdminConfigRouter({ db, requireAdmin, accountContext, accountManager }));

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const pathname = String(req.path || '');

    if (pathname === '/' || pathname === '/login') {
      if (getAdminCount() === 0) {
        return res.redirect('/welcome');
      }
      return next();
    }

    if (pathname === '/welcome' || pathname === '/setup-admin') {
      if (getAdminCount() > 0) {
        return res.redirect('/login');
      }
      return next();
    }

    return next();
  });

  app.use((req, res) => nextHandler(req, res));

  const wsAllowedOrigins = corsOrigins
    ? Array.from(new Set([...(corsOrigins || []), ...Array.from(nativeAppOrigins)]))
    : null;
  const realtimeWss = attachRealtimeWebSocket({
    server,
    sessionMiddleware: sessionManager.middleware,
    allowedOrigins: wsAllowedOrigins,
    path: process.env.REALTIME_WS_PATH || '/ws',
  });

  installGracefulShutdown({
    getServer: () => server,
    onShutdown: () => {
      try { realtimeWss && realtimeWss.close && realtimeWss.close(); } catch (_) {}
      try { sessionManager.close(); } catch (_) {}
      try { db.close && db.close(); } catch (_) {}
    },
    logger,
  });

  try {
    await service.startBot();
  } catch (err) {
    logger.error('[whatsapp] falha ao inicializar camada WhatsApp Cloud API', err);
  }

  const autoAwaitJob = startAutoAwaitJob({ db });
  const webhookInboxSync = startWebhookInboxSync({
    processWebhookPayload: service.processWebhookPayload,
  });

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      logger.info(`AutoZap rodando em http://${host}:${port}`);
      logger.info(`Webhook oficial disponível em /whatsapp/webhook`);
      if (realtimeWss) logger.info(`Realtime WebSocket ativo em ${process.env.REALTIME_WS_PATH || '/ws'}`);
      logger.info(`Storage root data=${accountManager.paths.DATA_DIR} media=${mediaRoot}`);
      resolve();
    });
  });

  process.on('SIGTERM', () => {
    try { autoAwaitJob.stop(); } catch (_) {}
    try { webhookInboxSync.stop(); } catch (_) {}
  });
  process.on('SIGINT', () => {
    try { autoAwaitJob.stop(); } catch (_) {}
    try { webhookInboxSync.stop(); } catch (_) {}
  });

  return {
    app,
    server,
    stop: () => {
      try { autoAwaitJob.stop(); } catch (_) {}
      try { webhookInboxSync.stop(); } catch (_) {}
      try { server.close(); } catch (_) {}
      try { sessionManager.close(); } catch (_) {}
      try { db.close && db.close(); } catch (_) {}
    },
  };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error('Falha ao inicializar servidor', err);
    process.exit(1);
  });
}

module.exports = {
  bootstrap,
};
