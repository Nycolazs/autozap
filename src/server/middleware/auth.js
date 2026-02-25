const { extractBearerToken, verifyAuthToken } = require('../security/authToken');

const tokenSecret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET || 'whatsapp-system-secret-key-fixed-2024';

function extractQueryAuthToken(req) {
  try {
    const raw = req && req.query ? req.query.auth : '';
    const token = String(raw || '').trim();
    return token || null;
  } catch (_) {
    return null;
  }
}

function resolveAuthIdentity(req) {
  if (req.session && req.session.userId) {
    return {
      userId: req.session.userId,
      userType: req.session.userType,
      userName: req.session.userName,
      source: 'session',
    };
  }

  let token = extractBearerToken(req);
  if (!token) {
    token = extractQueryAuthToken(req);
    if (token) {
      try {
        req.headers.authorization = `Bearer ${token}`;
      } catch (_) {}
    }
  }
  if (!token) return null;

  const payload = verifyAuthToken(token, { secret: tokenSecret });
  if (!payload) return null;

  return {
    userId: payload.userId,
    userType: payload.userType,
    userName: payload.userName,
    source: 'token',
  };
}

function requireAuth(req, res, next) {
  const identity = resolveAuthIdentity(req);
  if (!identity) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  req.userId = identity.userId;
  req.userType = identity.userType;
  req.userName = identity.userName;
  return next();
}

function requireAdmin(req, res, next) {
  const identity = resolveAuthIdentity(req);
  if (!identity) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  if (identity.userType !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas admin.' });
  }

  req.userId = identity.userId;
  req.userType = identity.userType;
  req.userName = identity.userName;
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  resolveAuthIdentity,
};
