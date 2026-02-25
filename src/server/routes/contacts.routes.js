const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Cache simples de foto de perfil (reduz chamadas ao WhatsApp em listas grandes)
const profilePicCache = new Map(); // phone -> { url, expiresAt }
const profilePicInFlight = new Map(); // phone -> Promise<{url}>
let activeProfilePicFetches = 0;
const MAX_PROFILE_PIC_FETCHES = Number(process.env.MAX_PROFILE_PIC_FETCHES || 3);
const PROFILE_PIC_TTL_MS = Number(process.env.PROFILE_PIC_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const PROFILE_PIC_NULL_TTL_MS = Number(process.env.PROFILE_PIC_NULL_TTL_MS || 15 * 60 * 1000); // 15m
const PROFILE_PIC_REMOTE_FETCH_TIMEOUT_MS = Number(process.env.PROFILE_PIC_REMOTE_FETCH_TIMEOUT_MS || 9000);

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

  function getLocalProfileAbsolutePath(url) {
    const value = String(url || '').trim();
    if (!value.startsWith('/media/profiles/')) return null;
    const relPath = value.replace('/media/', '');
    const absolutePath = path.resolve(path.join(String(mediaRoot || path.join(process.cwd(), 'media')), relPath));
    if (!absolutePath.startsWith(profilesRoot)) return null;
    return absolutePath;
  }

  function localProfileFileExists(url) {
    const absolutePath = getLocalProfileAbsolutePath(url);
    if (!absolutePath) return false;
    try {
      return fs.existsSync(absolutePath);
    } catch (_) {
      return false;
    }
  }

  function sendLocalProfileFile(res, url) {
    const absolutePath = getLocalProfileAbsolutePath(url);
    if (!absolutePath) return false;
    try {
      if (!fs.existsSync(absolutePath)) return false;
      return res.sendFile(absolutePath);
    } catch (_) {
      return false;
    }
  }

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
      const avatarUrl = String(row.avatar_url);
      if (avatarUrl.startsWith('/media/profiles/') && !localProfileFileExists(avatarUrl)) {
        try {
          db.prepare('DELETE FROM contact_profiles WHERE phone = ?').run(normalized);
        } catch (_) {}
        return null;
      }
      return {
        url: avatarUrl,
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

  function readWhatsAppAccessToken() {
    const envToken = String(process.env.WA_CLOUD_ACCESS_TOKEN || '').trim();
    if (envToken) return envToken;
    if (!db) return '';
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ? LIMIT 1').get('wa_cloud_access_token');
      return row && row.value ? String(row.value).trim() : '';
    } catch (_) {
      return '';
    }
  }

  function extFromContentType(contentType, fallbackUrl) {
    const mime = String(contentType || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    try {
      const parsed = new URL(String(fallbackUrl || ''));
      const ext = path.extname(parsed.pathname || '').toLowerCase();
      if (ext && ext.length <= 6) return ext;
    } catch (_) {}
    return '.jpg';
  }

  async function cacheRemoteProfilePictureLocally(phone, remoteUrl) {
    const normalized = normalizePhone(phone);
    const url = String(remoteUrl || '').trim();
    if (!normalized || !/^https?:\/\//i.test(url)) return null;

    const request = async (headers = {}) => axios.get(url, {
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: PROFILE_PIC_REMOTE_FETCH_TIMEOUT_MS,
      headers,
      maxRedirects: 3,
      validateStatus: () => true,
    });

    let response = await request();
    const waToken = readWhatsAppAccessToken();
    if ((response.status === 401 || response.status === 403) && waToken) {
      response = await request({
        Authorization: `Bearer ${waToken}`,
      });
    }

    if (response.status < 200 || response.status >= 300) return null;
    if (!response.data) return null;

    const ext = extFromContentType(response.headers && response.headers['content-type'], url);
    const fileName = `wa_${normalized}${ext}`;
    const absolutePath = path.join(profilesRoot, fileName);
    fs.writeFileSync(absolutePath, Buffer.from(response.data));
    const localUrl = `/media/profiles/${fileName}`;

    savePersistedProfilePicture(normalized, localUrl, 'whatsapp');
    cacheProfilePicture(normalized, localUrl, PROFILE_PIC_TTL_MS);
    return localUrl;
  }

  function removeLocalProfileImage(url) {
    const absolutePath = getLocalProfileAbsolutePath(url);
    if (!absolutePath) return;
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

  async function fetchProfilePictureFromProvider(phone, persisted) {
    const key = normalizePhone(phone);
    if (!key) {
      return { url: null, success: false };
    }

    const existing = profilePicInFlight.get(key);
    if (existing) {
      return existing;
    }

    const normalizeProfileUrl = async (candidateUrl) => {
      const value = String(candidateUrl || '').trim();
      if (!value) return null;
      if (value.startsWith('/media/profiles/')) {
        return localProfileFileExists(value) ? value : null;
      }
      if (/^https?:\/\//i.test(value)) {
        const localUrl = await cacheRemoteProfilePictureLocally(key, value);
        if (localUrl) return localUrl;
        // Fallback: mantém URL remota quando não for possível cachear localmente.
        return value;
      }
      return null;
    };

    const sock = getSocket();
    if (!sock || typeof sock.profilePictureUrl !== 'function') {
      if (persisted && persisted.url) {
        const normalizedPersistedUrl = await normalizeProfileUrl(persisted.url);
        if (normalizedPersistedUrl) {
          cacheProfilePicture(key, normalizedPersistedUrl, PROFILE_PIC_TTL_MS);
          return { url: normalizedPersistedUrl, success: true, source: persisted.source || 'db' };
        }
      }
      cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
      return { url: null, success: false };
    }

    const job = (async () => {
      const jid = `${key}@s.whatsapp.net`;
      try {
        const url = await withProfilePicConcurrencyLimit(() => sock.profilePictureUrl(jid, 'image'));
        if (url) {
          const normalizedUrl = await normalizeProfileUrl(url);
          if (normalizedUrl) {
            cacheProfilePicture(key, normalizedUrl, PROFILE_PIC_TTL_MS);
            savePersistedProfilePicture(key, normalizedUrl, 'whatsapp');
            return { url: normalizedUrl, success: true, source: 'whatsapp' };
          }
        }

        if (persisted && persisted.url) {
          const normalizedPersistedUrl = await normalizeProfileUrl(persisted.url);
          if (normalizedPersistedUrl) {
            cacheProfilePicture(key, normalizedPersistedUrl, PROFILE_PIC_TTL_MS);
            return { url: normalizedPersistedUrl, success: true, source: persisted.source || 'db' };
          }
        }

        cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
        return { url: null, success: false };
      } catch (_) {
        if (persisted && persisted.url) {
          const normalizedPersistedUrl = await normalizeProfileUrl(persisted.url);
          if (normalizedPersistedUrl) {
            cacheProfilePicture(key, normalizedPersistedUrl, PROFILE_PIC_TTL_MS);
            return { url: normalizedPersistedUrl, success: true, source: persisted.source || 'db' };
          }
        }
        cacheProfilePicture(key, null, PROFILE_PIC_NULL_TTL_MS);
        return { url: null, success: false };
      } finally {
        profilePicInFlight.delete(key);
      }
    })();

    profilePicInFlight.set(key, job);
    return job;
  }

  // Endpoint para obter foto de perfil
  router.get('/profile-picture/:phone', async (req, res) => {
    const key = normalizePhone(req.params && req.params.phone);
    const forceRefresh = String((req.query && req.query.refresh) || '').trim() === '1';
    if (!key) {
      return res.json({ url: null, fromCache: false });
    }

    const now = Date.now();
    const persisted = findPersistedProfilePicture(key);
    const FAST_LOOKUP_WAIT_MS = Number(process.env.PROFILE_PIC_FAST_LOOKUP_WAIT_MS || 700);

    // Para arquivo local já cacheado, responde instantaneamente.
    if (!forceRefresh && persisted && persisted.url && String(persisted.url).startsWith('/media/profiles/')) {
      cacheProfilePicture(key, persisted.url, PROFILE_PIC_TTL_MS);
      return res.json({ url: persisted.url, fromCache: false, fromDb: true, source: persisted.source || 'db' });
    }

    const cached = !forceRefresh ? profilePicCache.get(key) : null;
    if (cached && cached.expiresAt && cached.expiresAt > now) {
      return res.json({ url: cached.url || null, fromCache: true });
    }

    const existing = profilePicInFlight.get(key);
    if (existing) {
      if (!forceRefresh) {
        const fastResult = await Promise.race([
          existing,
          new Promise((resolve) => setTimeout(() => resolve(null), FAST_LOOKUP_WAIT_MS)),
        ]);
        if (fastResult && fastResult.url) {
          return res.json({ url: fastResult.url, fromCache: false, source: fastResult.source || null });
        }
        return res.json({ url: null, fromCache: false, pending: true });
      }
      const result = await existing;
      return res.json({ url: result.url || null, fromCache: false, source: result.source || null });
    }

    if (!forceRefresh) {
      // Evita bloquear a UI: dispara lookup em background.
      const job = fetchProfilePictureFromProvider(key, persisted);
      const fastResult = await Promise.race([
        job,
        new Promise((resolve) => setTimeout(() => resolve(null), FAST_LOOKUP_WAIT_MS)),
      ]);
      if (fastResult && fastResult.url) {
        return res.json({ url: fastResult.url, fromCache: false, source: fastResult.source || null });
      }
      return res.json({ url: null, fromCache: false, pending: true });
    }

    const result = await fetchProfilePictureFromProvider(key, persisted);
    return res.json({ url: result.url || null, fromCache: false, source: result.source || null });
  });

  // Endpoint para servir foto de perfil como imagem (com fallback remoto)
  router.get('/profile-picture/:phone/image', authGuard, async (req, res) => {
    const key = normalizePhone(req.params && req.params.phone);
    const forceRefresh = String((req.query && req.query.refresh) || '').trim() === '1';
    if (!key) {
      return res.status(404).json({ error: 'Contato inválido' });
    }

    try {
      let persisted = findPersistedProfilePicture(key);
      let candidateUrl = persisted && persisted.url ? String(persisted.url).trim() : '';

      if (!candidateUrl || forceRefresh) {
        const fetched = await fetchProfilePictureFromProvider(key, persisted);
        candidateUrl = String((fetched && fetched.url) || '').trim();
      }

      if (!candidateUrl) {
        return res.status(404).json({ error: 'Foto de perfil não encontrada' });
      }

      if (candidateUrl.startsWith('/media/profiles/')) {
        const sent = sendLocalProfileFile(res, candidateUrl);
        if (sent) return sent;
      }

      if (/^https?:\/\//i.test(candidateUrl)) {
        const localUrl = await cacheRemoteProfilePictureLocally(key, candidateUrl);
        if (localUrl) {
          const sent = sendLocalProfileFile(res, localUrl);
          if (sent) return sent;
        }

        const request = async (headers = {}) => axios.get(candidateUrl, {
          method: 'GET',
          responseType: 'arraybuffer',
          timeout: PROFILE_PIC_REMOTE_FETCH_TIMEOUT_MS,
          headers,
          maxRedirects: 3,
          validateStatus: () => true,
        });

        let response = await request();
        const waToken = readWhatsAppAccessToken();
        if ((response.status === 401 || response.status === 403) && waToken) {
          response = await request({ Authorization: `Bearer ${waToken}` });
        }

        if (response.status >= 200 && response.status < 300 && response.data) {
          res.setHeader('Cache-Control', 'private, max-age=300');
          const contentType = String((response.headers && response.headers['content-type']) || '').trim();
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          return res.status(200).send(Buffer.from(response.data));
        }
      }

      return res.status(404).json({ error: 'Foto de perfil indisponível' });
    } catch (_) {
      return res.status(500).json({ error: 'Erro ao carregar foto de perfil' });
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
