'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let cachedApp = null;

function parseBoolean(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseServiceAccountFromEnv() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson && String(inlineJson).trim()) {
    try {
      const parsed = JSON.parse(inlineJson);
      return parsed;
    } catch (_) {
      // ignora e tenta outras fontes
    }
  }

  const jsonPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (jsonPath && String(jsonPath).trim()) {
    try {
      const absolute = path.isAbsolute(jsonPath)
        ? jsonPath
        : path.join(process.cwd(), jsonPath);
      if (fs.existsSync(absolute)) {
        return JSON.parse(fs.readFileSync(absolute, 'utf8'));
      }
    } catch (_) {
      // ignora e tenta outras fontes
    }
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: String(privateKeyRaw).replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function shouldTryApplicationDefaultCredentials() {
  const force = parseBoolean(process.env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS);
  if (force != null) return force;

  return Boolean(
    String(process.env.K_SERVICE || '').trim() ||
    String(process.env.GOOGLE_CLOUD_PROJECT || '').trim() ||
    String(process.env.GCLOUD_PROJECT || '').trim() ||
    String(process.env.FIREBASE_PROJECT_ID || '').trim()
  );
}

function isFirebaseConfigured() {
  return !!parseServiceAccountFromEnv() || shouldTryApplicationDefaultCredentials();
}

function getFirebaseApp() {
  if (cachedApp) return cachedApp;

  const serviceAccount = parseServiceAccountFromEnv();
  const projectId = (serviceAccount && serviceAccount.project_id)
    || process.env.FIREBASE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || undefined;

  try {
    if (serviceAccount) {
      cachedApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        ...(projectId ? { projectId } : {}),
      });
      return cachedApp;
    }

    if (!shouldTryApplicationDefaultCredentials()) {
      return null;
    }

    cachedApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
  } catch (_) {
    return null;
  }

  return cachedApp;
}

function getFirestore() {
  const app = getFirebaseApp();
  if (!app) return null;
  return admin.firestore(app);
}

module.exports = {
  isFirebaseConfigured,
  getFirebaseApp,
  getFirestore,
};
