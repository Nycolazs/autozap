const express = require('express');
const fs = require('fs');
const path = require('path');

// Cache simples de foto de perfil (reduz chamadas ao WhatsApp em listas grandes)
const profilePicCache = new Map(); // phone -> { url, expiresAt }
const profilePicInFlight = new Map(); // phone -> Promise<{url}>
let activeProfilePicFetches = 0;
const MAX_PROFILE_PIC_FETCHES = Number(process.env.MAX_PROFILE_PIC_FETCHES || 3);
const PROFILE_PIC_TTL_MS = Number(process.env.PROFILE_PIC_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const PROFILE_PIC_NULL_TTL_MS = 5 * 60 * 1000; // 5m

function normalizePhone(phone) {
  const clean = String(phone || '').split('@')[0].replace(/\D/g, '');
  return clean || null;
}

async function withProfilePicConcurrencyLimit(fn) {
  while (activeProfilePicFetches >= MAX_PROFILE_PIC_FETCHES) {
    await new Promise((r) => setTimeout(r, 50));
  }
  activeProfilePicFetches++;
  try {
    return await fn();
  } finally {
    activeProfilePicFetches--;
  }
}

function createContactsRouter({
  getSocket,
  db,
  requireAuth,
  uploadProfileImage,
  mediaRoot,
}) {
  const router = express.Router();
  const authGuard = typeof requireAuth === 'function' ? requireAuth : (_req, _res, next) => next();
  const uploadMiddleware = uploadProfileImage && typeof uploadProfileImage.single === 'function'
    ? uploadProfileImage.single('avatar')
    : null;
  const profilesRoot = path.resolve(path.join(String(mediaRoot || path.join(process.cwd(), 'media')), 'profiles'));

  function cacheProfilePicture(phone, url, ttlMs) {
    if (!phone) return;
    profilePicCache.set(phone, {
      url: url || null,
      expiresAt: Date.now() + Number(ttlMs || PROFILE_PIC_TTL_MS),
    });
  }

  function findPersistedProfilePicture(phone) {
    if (!db) return null;
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    try {
      const row = db
        .prepare('SELECT avatar_url, avatar_source FROM contact_profiles WHERE phone = ? LIMIT 1')
        .get(normalized);
      if (!row || !row.avatar_url) return null;
      return {
        url: String(row.avatar_url),
        source: row.avatar_source ? String(row.avatar_source) : null,
      };
    } catch (_) {
      return null;
    }
  }

  function savePersistedProfilePicture(phone, url, source) {
    if (!db) return;
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    try {
      db.prepare(`
        INSERT INTO contact_profiles (phone, avatar_url, avatar_source, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(phone) DO UPDATE SET
          avatar_url = excluded.avatar_url,
          avatar_source = excluded.avatar_source,
          updated_at = CURRENT_TIMESTAMP
      `).run(normalized, url || null, source || null);
    } catch (_) {}
  }

  function removeLocalProfileImage(url) {
    const value = String(url || '').trim();
    if (!value.startsWith('/media/profiles/')) return;
    const relPath = value.replace('/media/', '');
    const absolutePath = path.resolve(path.join(String(mediaRoot || path.join(process.cwd(), 'media')), relPath));
    if (!absolutePath.startsWith(profilesRoot)) return;
    fs.unlink(absolutePath, () => {});
  }

  function findNameInDb(phone) {
    if (!db) return null;
    try {
      const cleanPhone = normalizePhone(phone);
      if (!cleanPhone) return null;
      const row = db
        .prepare('SELECT contact_name FROM tickets WHERE phone = ? AND contact_name IS NOT NULL ORDER BY id DESC LIMIT 1')
        .get(cleanPhone);
      if (!row || !row.contact_name) return null;
      const normalized = String(row.contact_name).trim();
      return normalized || null;
    } catch (_) {
      return null;
    }
  }

  // Endpoint para obter foto de perfil
  router.get('/profile-picture/:phone', async (req, res) => {
    const key = normalizePhone(req.params && req.params.phone);
    const forceRefresh = String((req.query && req.query.refresh) || '').trim() === '1';
    if (!key) {
      return res.json({ url: null, fromCache: false });
    }

    const now = Date.now();
    let createdJob = false;

    try {
      const persisted = findPersistedProfilePicture(key);
      const persistedSource = persisted && persisted.source ? String(persisted.source).toLowerCase() : '';
      const persistedIsWhatsapp = persistedSource === 'whatsapp';

      // Para fonte oficial já persistida, responde rápido e evita chamada remota extra.
      // Para fonte manual/legada, tenta buscar automaticamente no WhatsApp antes de responder.
      if (!forceRefresh && persisted && persisted.url && persistedIsWhatsapp) {
        cacheProfilePicture(key, persisted.url, PROFILE_PIC_TTL_MS);
        return res.json({ url: persisted.url, fromCache: false, fromDb: true, source: persisted.source || 'db' });
      }

      const cached = !forceRefresh ? profilePicCache.get(key) : null;
      if (cached && cached.expiresAt && cached.expiresAt > now) {
        return res.json({ url: cached.url || null, fromCache: true });
      }

      const existing = profilePicInFlight.get(key);
      if (existing) {
        const result = await existing;
        return res.json({ url: result.url || null, fromCache: false });
      }

      const sock = getSocket();
      if (!sock || typeof sock.profilePictureUrl !== 'function') {
        if (persisted && persisted.url) {
          cacheProfilePicture(key, persisted.url, PROFILE_PIC_TTL_MS);
          return res.json({ url: persisted.url, fromCache: false, fromDb: true, source: persisted.source || 'db' });
        }
        cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
        return res.json({ url: null, fromCache: false });
      }

      const job = (async () => {
        const jid = `${key}@s.whatsapp.net`;
        try {
          const url = await withProfilePicConcurrencyLimit(() => sock.profilePictureUrl(jid, 'image'));
          if (url) {
            cacheProfilePicture(key, url, PROFILE_PIC_TTL_MS);
            savePersistedProfilePicture(key, url, 'whatsapp');
            return { url, success: true };
          }
          if (persisted && persisted.url) {
            cacheProfilePicture(key, persisted.url, PROFILE_PIC_TTL_MS);
            return { url: persisted.url, success: true };
          }
          cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
          return { url: null, success: false };
        } catch (_e) {
          if (persisted && persisted.url) {
            cacheProfilePicture(key, persisted.url, PROFILE_PIC_TTL_MS);
            return { url: persisted.url, success: true };
          }
          cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
          return { url: null, success: false };
        }
      })();

      profilePicInFlight.set(key, job);
      createdJob = true;
      const result = await job;
      return res.json({ url: result.url || null, fromCache: false });
    } finally {
      if (createdJob) {
        profilePicInFlight.delete(key);
      }
    }
  });

  router.post('/profile-picture/:phone/upload', authGuard, (req, res, next) => {
    if (!uploadMiddleware) {
      return res.status(501).json({ error: 'Upload de foto de perfil indisponível' });
    }
    return uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: String(err && err.message ? err.message : err) });
      }
      return next();
    });
  }, (req, res) => {
    const key = normalizePhone(req.params && req.params.phone);
    if (!key) {
      if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(400).json({ error: 'Telefone inválido' });
    }

    if (!req.file || !req.file.filename) {
      return res.status(400).json({ error: 'Envie uma imagem no campo avatar' });
    }

    const previous = findPersistedProfilePicture(key);
    const nextUrl = `/media/profiles/${req.file.filename}`;
    savePersistedProfilePicture(key, nextUrl, 'manual');
    cacheProfilePicture(key, nextUrl, PROFILE_PIC_TTL_MS);

    if (previous && previous.url && previous.url !== nextUrl) {
      removeLocalProfileImage(previous.url);
    }

    return res.json({
      ok: true,
      url: nextUrl,
      source: 'manual',
    });
  });

  // Endpoint para obter nome do contato
  router.get('/contact-name/:phone', async (req, res) => {
    const { phone } = req.params;

    const sock = getSocket();
    if (!sock) {
      return res.json({ name: findNameInDb(phone) });
    }

    try {
      const cleanPhone = normalizePhone(phone);
      if (!cleanPhone) return res.json({ name: findNameInDb(phone) });
      const jid = `${cleanPhone}@s.whatsapp.net`;

      const contact = await sock.onWhatsApp(jid);
      if (contact && contact[0]) {
        // Mantém chamada por compatibilidade com o comportamento anterior
        await sock.getBusinessProfile(jid).catch(() => null);

        if (sock.store && sock.store.contacts && sock.store.contacts[jid]) {
          const name = sock.store.contacts[jid].name || sock.store.contacts[jid].notify;
          if (name) {
            return res.json({ name });
          }
        }

        if (contact[0].notify) {
          return res.json({ name: contact[0].notify });
        }
      }

      return res.json({ name: findNameInDb(phone) });
    } catch (_error) {
      return res.json({ name: findNameInDb(phone) });
    }
  });

  return router;
}

module.exports = {
  createContactsRouter,
};
