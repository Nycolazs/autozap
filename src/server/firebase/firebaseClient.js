'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let cachedApp = null;

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

function isFirebaseConfigured() {
  return !!parseServiceAccountFromEnv();
}

function getFirebaseApp() {
  if (cachedApp) return cachedApp;

  const serviceAccount = parseServiceAccountFromEnv();
  if (!serviceAccount) {
    return null;
  }

  const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || undefined;

  cachedApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    ...(projectId ? { projectId } : {}),
  });

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
