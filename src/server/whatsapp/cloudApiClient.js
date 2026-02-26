'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const db = require('../db');
const events = require('../server/events');
const { createLogger } = require('../logger');

const logger = createLogger('whatsapp-cloud');

const OUT_OF_HOURS_COOLDOWN_MINUTES = Number(process.env.OUT_OF_HOURS_COOLDOWN_MINUTES || 120);
const BUSINESS_TIMEZONE = String(process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';

let started = false;
let lastConnectedAt = null;
let lastDisconnectedAt = null;
let lastDisconnectCode = null;
let lastDisconnectReason = null;
let runtimePhoneNumberId = '';
let activeSender = null;
let profilePictureLookupBlockedUntil = 0;
let lastProfilePictureLookupUnsupportedAt = null;
let lastProfilePictureLookupUnsupportedReason = null;

const PROFILE_PICTURE_UNSUPPORTED_BACKOFF_MS = Math.max(
  60 * 1000,
  Number(process.env.WA_CLOUD_PROFILE_PIC_UNSUPPORTED_BACKOFF_MS || (30 * 60 * 1000))
);
const PROFILE_PICTURE_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.WA_CLOUD_PROFILE_PIC_TIMEOUT_MS || 12000)
);

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 8 || digits.length > 25) return null;
  return digits;
}

function normalizePhoneForJid(raw) {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

function buildCloudMediaUrl(mediaId, type) {
  const id = encodeURIComponent(String(mediaId || '').trim());
  const mediaType = String(type || '').trim();
  if (!id) return null;
  if (!mediaType) return `/media/wa/${id}`;
  return `/media/wa/${id}?type=${encodeURIComponent(mediaType)}`;
}

function safeReadSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row && row.value ? String(row.value).trim() : '';
  } catch (_) {
    return '';
  }
}

function getConfig() {
  const accessToken = (process.env.WA_CLOUD_ACCESS_TOKEN || safeReadSetting('wa_cloud_access_token')).trim();
  const configuredPhoneNumberId = (process.env.WA_CLOUD_PHONE_NUMBER_ID || safeReadSetting('wa_cloud_phone_number_id')).trim();
  const phoneNumberId = (runtimePhoneNumberId || configuredPhoneNumberId).trim();
  const verifyToken = (process.env.WA_CLOUD_VERIFY_TOKEN || safeReadSetting('wa_cloud_verify_token')).trim();
  const appSecret = (process.env.WA_CLOUD_APP_SECRET || safeReadSetting('wa_cloud_app_secret')).trim();
  const apiVersion = (process.env.WA_CLOUD_API_VERSION || 'v23.0').trim();
  const baseUrl = (process.env.WA_CLOUD_BASE_URL || 'https://graph.facebook.com').trim().replace(/\/+$/, '');

  return {
    accessToken,
    phoneNumberId,
    configuredPhoneNumberId,
    verifyToken,
    appSecret,
    apiVersion,
    baseUrl,
  };
}

function isConfigured(config = getConfig()) {
  return Boolean(config.accessToken && config.phoneNumberId);
}

function getConnectionState(config = getConfig()) {
  if (!config.accessToken || !config.phoneNumberId) return 'missing_config';
  if (!config.verifyToken) return 'missing_verify_token';
  if (lastDisconnectReason && /session has expired|error validating access token|invalid oauth/i.test(String(lastDisconnectReason).toLowerCase())) {
    return 'token_expired';
  }
  return 'open';
}

function markConnected() {
  if (!lastConnectedAt) {
    lastConnectedAt = Date.now();
  }
  lastDisconnectCode = null;
  lastDisconnectReason = null;
}

function markDisconnected(code, reason) {
  lastDisconnectedAt = Date.now();
  lastDisconnectCode = code || null;
  lastDisconnectReason = reason || null;
}

function isTestSenderMetadata(metadata) {
  const verifiedName = String((metadata && metadata.verified_name) || '').toLowerCase();
  const displayPhone = String((metadata && metadata.display_phone_number) || '').replace(/\D/g, '');
  return verifiedName.includes('test number') || displayPhone === '15551554038';
}

function setActiveSender(metadata, source = 'configured') {
  if (!metadata || !metadata.id) return;
  activeSender = {
    id: String(metadata.id),
    displayPhoneNumber: metadata.display_phone_number ? String(metadata.display_phone_number) : null,
    verifiedName: metadata.verified_name ? String(metadata.verified_name) : null,
    status: metadata.status ? String(metadata.status) : null,
    qualityRating: metadata.quality_rating ? String(metadata.quality_rating) : null,
    codeVerificationStatus: metadata.code_verification_status ? String(metadata.code_verification_status) : null,
    nameStatus: metadata.name_status ? String(metadata.name_status) : null,
    isTestNumber: isTestSenderMetadata(metadata),
    source: source || 'configured',
  };
}

function extractWabaIdFromHealthStatus(payload) {
  const entities = payload
    && payload.health_status
    && Array.isArray(payload.health_status.entities)
    ? payload.health_status.entities
    : [];

  const wabaEntity = entities.find((entity) => entity && String(entity.entity_type || '').toUpperCase() === 'WABA' && entity.id);
  return wabaEntity && wabaEntity.id ? String(wabaEntity.id).trim() : '';
}

async function ensureWabaSubscribedApps(phoneNumberId) {
  const currentPhoneId = String(phoneNumberId || '').trim();
  if (!currentPhoneId) return null;

  const health = await callGraph(`${currentPhoneId}?fields=health_status`, {
    method: 'GET',
    trackConnection: false,
  });
  const wabaId = extractWabaIdFromHealthStatus(health);
  if (!wabaId) {
    logger.warn('[STARTUP] Nao foi possivel identificar WABA para subscribed_apps.');
    return null;
  }

  const subscribeResult = await callGraph(`${wabaId}/subscribed_apps`, {
    method: 'POST',
    data: {},
    trackConnection: false,
  });

  if (subscribeResult && subscribeResult.success === true) {
    logger.info(`[STARTUP] WABA ${wabaId} inscrita em subscribed_apps com sucesso.`);
  } else {
    logger.warn(`[STARTUP] Resposta inesperada ao inscrever WABA ${wabaId} em subscribed_apps: ${JSON.stringify(subscribeResult || {})}`);
  }

  return wabaId;
}

function pickPreferredPhoneNumber(phoneNumbers, currentPhoneNumberId) {
  const currentId = String(currentPhoneNumberId || '').trim();
  const list = Array.isArray(phoneNumbers) ? phoneNumbers : [];
  if (!list.length) return null;

  const nonTest = list.filter((item) => item && item.id && String(item.id) !== currentId && !isTestSenderMetadata(item));
  if (!nonTest.length) return null;

  const connected = nonTest.find((item) => String(item.status || '').toUpperCase() === 'CONNECTED');
  return connected || nonTest[0] || null;
}

async function resolvePreferredPhoneNumber(currentPhoneNumberId) {
  const currentId = String(currentPhoneNumberId || '').trim();
  if (!currentId) return null;

  const health = await callGraph(`${currentId}?fields=health_status`, {
    method: 'GET',
    trackConnection: false,
  });
  const wabaId = extractWabaIdFromHealthStatus(health);
  if (!wabaId) return null;

  const response = await callGraph(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status`, {
    method: 'GET',
    trackConnection: false,
  });
  const phoneNumbers = Array.isArray(response && response.data) ? response.data : [];
  const preferred = pickPreferredPhoneNumber(phoneNumbers, currentId);

  if (!preferred || !preferred.id) return null;

  return {
    wabaId,
    phoneNumber: preferred,
  };
}

function getActiveSender() {
  const config = getConfig();
  return {
    configuredPhoneNumberId: config.configuredPhoneNumberId || null,
    effectivePhoneNumberId: config.phoneNumberId || null,
    displayPhoneNumber: activeSender && activeSender.displayPhoneNumber ? activeSender.displayPhoneNumber : null,
    verifiedName: activeSender && activeSender.verifiedName ? activeSender.verifiedName : null,
    status: activeSender && activeSender.status ? activeSender.status : null,
    qualityRating: activeSender && activeSender.qualityRating ? activeSender.qualityRating : null,
    codeVerificationStatus: activeSender && activeSender.codeVerificationStatus ? activeSender.codeVerificationStatus : null,
    nameStatus: activeSender && activeSender.nameStatus ? activeSender.nameStatus : null,
    source: activeSender && activeSender.source ? activeSender.source : 'configured',
    isTestNumber: activeSender ? !!activeSender.isTestNumber : null,
  };
}

async function callGraph(pathname, {
  method = 'GET',
  data = null,
  params = null,
  headers = null,
  responseType = 'json',
  timeout = Number(process.env.WA_CLOUD_TIMEOUT_MS || 20000),
  trackConnection = true,
} = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const cleanPath = String(pathname || '').replace(/^\/+/, '');
  const url = `${config.baseUrl}/${config.apiVersion}/${cleanPath}`;

  const reqHeaders = {
    Authorization: `Bearer ${config.accessToken}`,
    ...(headers || {}),
  };

  const response = await axios({
    method,
    url,
    data,
    params,
    headers: reqHeaders,
    responseType,
    timeout,
    validateStatus: () => true,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });

  if (response.status >= 200 && response.status < 300) {
    if (trackConnection) {
      markConnected();
    }
    return response.data;
  }

  const errMsg = response && response.data && response.data.error && response.data.error.message
    ? response.data.error.message
    : `HTTP ${response.status}`;

  if (trackConnection) {
    markDisconnected(response.status, errMsg);
  }
  const error = new Error(`WhatsApp Cloud API: ${errMsg}`);
  error.httpStatus = response.status;
  error.graphError = response && response.data && response.data.error ? response.data.error : null;
  throw error;
}

function extractSentMessageId(payload) {
  try {
    if (payload && Array.isArray(payload.messages) && payload.messages[0] && payload.messages[0].id) {
      return String(payload.messages[0].id);
    }
  } catch (_) {}
  return null;
}

function isAbsoluteHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return /^https?:\/\//i.test(raw);
}

function extractContactProfilePictureUrl(payload) {
  const contacts = Array.isArray(payload && payload.contacts) ? payload.contacts : [];
  const candidates = [];

  const pushCandidate = (value) => {
    if (!value) return;
    const raw = String(value).trim();
    if (!raw) return;
    candidates.push(raw);
  };

  for (const contact of contacts) {
    if (!contact || typeof contact !== 'object') continue;
    pushCandidate(contact.profile_picture_url);
    pushCandidate(contact.profile_pic_url);
    pushCandidate(contact.photo_url);

    const profile = contact.profile;
    if (profile && typeof profile === 'object') {
      pushCandidate(profile.profile_picture_url);
      pushCandidate(profile.profile_pic_url);
      pushCandidate(profile.picture_url);
      pushCandidate(profile.photo_url);
    }

    if (Array.isArray(contact.photos)) {
      for (const photo of contact.photos) {
        if (!photo || typeof photo !== 'object') continue;
        pushCandidate(photo.url);
        pushCandidate(photo.profile_picture_url);
        pushCandidate(photo.picture_url);
      }
    }
  }

  for (const candidate of candidates) {
    if (isAbsoluteHttpUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

function saveContactProfilePicture(phone, url, source = 'whatsapp') {
  const normalizedPhone = normalizePhone(phone);
  const avatarUrl = String(url || '').trim();
  if (!normalizedPhone) return;
  if (!isAbsoluteHttpUrl(avatarUrl)) return;

  try {
    db.prepare(`
      INSERT INTO contact_profiles (phone, avatar_url, avatar_source, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(phone) DO UPDATE SET
        avatar_url = excluded.avatar_url,
        avatar_source = excluded.avatar_source,
        updated_at = CURRENT_TIMESTAMP
    `).run(normalizedPhone, avatarUrl, String(source || 'whatsapp'));
  } catch (_) {}
}

function isUnsupportedProfilePictureLookupError(err) {
  const graphErr = err && err.graphError ? err.graphError : null;
  const code = Number(graphErr && graphErr.code ? graphErr.code : 0);
  const subcode = Number(graphErr && graphErr.error_subcode ? graphErr.error_subcode : 0);
  const status = Number(err && err.httpStatus ? err.httpStatus : 0);
  const message = String((graphErr && graphErr.message) || (err && err.message) || '').toLowerCase();

  if (code === 100 || subcode === 33) return true;
  if (status === 404) return true;
  if (message.includes('unsupported post request')) return true;
  if (message.includes('does not support this operation')) return true;
  if (message.includes('unsupported get request')) return true;
  return false;
}

function getProfilePictureLookupState() {
  const blockedUntil = profilePictureLookupBlockedUntil > Date.now()
    ? profilePictureLookupBlockedUntil
    : 0;

  return {
    supported: blockedUntil === 0,
    blockedUntil: blockedUntil || null,
    reason: blockedUntil ? 'unsupported_operation' : null,
    lastUnsupportedAt: lastProfilePictureLookupUnsupportedAt,
    lastErrorMessage: lastProfilePictureLookupUnsupportedReason,
  };
}

async function fetchContactProfilePictureUrl(phoneOrJid) {
  const phone = normalizePhone(String(phoneOrJid || '').split('@')[0]);
  if (!phone) return null;

  if (profilePictureLookupBlockedUntil > Date.now()) {
    return null;
  }

  const config = getConfig();
  if (!isConfigured(config)) return null;

  try {
    const payload = await callGraph(`${config.phoneNumberId}/contacts`, {
      method: 'POST',
      data: {
        messaging_product: 'whatsapp',
        contacts: [{ input: phone }],
      },
      timeout: PROFILE_PICTURE_TIMEOUT_MS,
      trackConnection: false,
    });

    const url = extractContactProfilePictureUrl(payload);
    return url || null;
  } catch (err) {
    if (isUnsupportedProfilePictureLookupError(err)) {
      const graphErr = err && err.graphError ? err.graphError : null;
      lastProfilePictureLookupUnsupportedAt = Date.now();
      lastProfilePictureLookupUnsupportedReason = String(
        (graphErr && graphErr.message)
        || (err && err.message)
        || 'Consulta automática de foto não suportada'
      );
      profilePictureLookupBlockedUntil = Date.now() + PROFILE_PICTURE_UNSUPPORTED_BACKOFF_MS;
      logger.warn('[PROFILE] Consulta automática de foto não suportada nesta configuração da Cloud API.');
      return null;
    }
    return null;
  }
}

async function uploadMedia(filePath, mimeType) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: mimeType || 'application/octet-stream',
  });

  const payload = await callGraph(`${config.phoneNumberId}/media`, {
    method: 'POST',
    data: form,
    headers: form.getHeaders(),
  });

  if (!payload || !payload.id) {
    throw new Error('Falha ao enviar mídia para o WhatsApp');
  }

  return String(payload.id);
}

async function sendTextMessage(phoneNumber, text, { contextMessageId = null } = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const to = normalizePhone(phoneNumber);
  if (!to) throw new Error('Telefone inválido');

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body: String(text || ''),
      preview_url: false,
    },
  };

  if (contextMessageId) {
    payload.context = { message_id: String(contextMessageId) };
  }

  return callGraph(`${config.phoneNumberId}/messages`, {
    method: 'POST',
    data: payload,
  });
}

async function sendAudioMessage(phoneNumber, filePath, {
  contextMessageId = null,
  mimeType = 'audio/ogg',
} = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const to = normalizePhone(phoneNumber);
  if (!to) throw new Error('Telefone inválido');

  const mediaId = await uploadMedia(filePath, mimeType);

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: {
      id: mediaId,
    },
  };

  if (contextMessageId) {
    payload.context = { message_id: String(contextMessageId) };
  }

  return callGraph(`${config.phoneNumberId}/messages`, {
    method: 'POST',
    data: payload,
  });
}

async function sendImageMessage(phoneNumber, filePath, {
  caption = null,
  contextMessageId = null,
  mimeType = 'image/jpeg',
} = {}) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const to = normalizePhone(phoneNumber);
  if (!to) throw new Error('Telefone inválido');

  const mediaId = await uploadMedia(filePath, mimeType);

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      id: mediaId,
      ...(caption ? { caption: String(caption) } : {}),
    },
  };

  if (contextMessageId) {
    payload.context = { message_id: String(contextMessageId) };
  }

  return callGraph(`${config.phoneNumberId}/messages`, {
    method: 'POST',
    data: payload,
  });
}

function shouldRetryWithoutContext(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  return (
    msg.includes('context') ||
    msg.includes('message_id') ||
    msg.includes('quoted') ||
    msg.includes('reply')
  );
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const raw = String(timeStr).trim();
  if (!raw) return null;

  const match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour * 60) + minute;
  }

  const match12 = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([AaPp][Mm])$/);
  if (match12) {
    const sourceHour = Number(match12[1]);
    const minute = Number(match12[2]);
    const period = String(match12[3] || '').toUpperCase();
    if (!Number.isFinite(sourceHour) || sourceHour < 1 || sourceHour > 12 || !Number.isFinite(minute)) return null;
    let hour = sourceHour % 12;
    if (period === 'PM') hour += 12;
    return (hour * 60) + minute;
  }

  return null;
}

function mapWeekdayToIndex(weekdayValue) {
  const key = String(weekdayValue || '').trim().toLowerCase().slice(0, 3);
  if (key === 'sun') return 0;
  if (key === 'mon') return 1;
  if (key === 'tue') return 2;
  if (key === 'wed') return 3;
  if (key === 'thu') return 4;
  if (key === 'fri') return 5;
  if (key === 'sat') return 6;
  return null;
}

function parseTimezoneOffsetMinutes(rawTimezone) {
  const raw = String(rawTimezone || '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (upper === 'UTC' || upper === 'GMT' || upper === 'Z') return 0;

  const normalized = upper
    .replace(/^UTC/, '')
    .replace(/^GMT/, '')
    .trim();

  const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 14 || minutes < 0 || minutes > 59) return null;

  return sign * ((hours * 60) + minutes);
}

function fixedTimezoneOffsetMinutes(timezone) {
  const normalized = String(timezone || '').trim().toLowerCase();
  if (!normalized) return null;

  // Fallback para ambientes Node sem suporte completo de ICU/timezone.
  if (
    normalized === 'america/sao_paulo'
    || normalized === 'america/fortaleza'
    || normalized === 'america/recife'
    || normalized === 'america/bahia'
  ) {
    return -180;
  }

  return parseTimezoneOffsetMinutes(timezone);
}

function buildDateContextFromOffset(date, offsetMinutes, timezoneLabel) {
  if (!Number.isFinite(offsetMinutes)) return null;
  const targetDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const shifted = new Date(targetDate.getTime() + (offsetMinutes * 60000));
  if (Number.isNaN(shifted.getTime())) return null;

  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return {
    dayOfWeek: shifted.getUTCDay(),
    dateStr: `${year}-${month}-${day}`,
    nowMinutes: (shifted.getUTCHours() * 60) + shifted.getUTCMinutes(),
    timezone: timezoneLabel || `offset:${offsetMinutes}`,
  };
}

function getBusinessDateContext(date) {
  const targetDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIMEZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(targetDate);

    const lookup = {};
    for (const part of parts) {
      if (!part || part.type === 'literal') continue;
      lookup[part.type] = part.value;
    }

    const year = String(lookup.year || '').trim();
    const month = String(lookup.month || '').trim();
    const dayOfMonth = String(lookup.day || '').trim();
    const hour = Number(lookup.hour);
    const minute = Number(lookup.minute);
    const weekday = mapWeekdayToIndex(lookup.weekday);

    if (!year || !month || !dayOfMonth || weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      throw new Error('invalid-timezone-parts');
    }

    return {
      dayOfWeek: weekday,
      dateStr: `${year}-${month}-${dayOfMonth}`,
      nowMinutes: (hour * 60) + minute,
      timezone: BUSINESS_TIMEZONE,
    };
  } catch (_) {
    const fixedOffset = fixedTimezoneOffsetMinutes(BUSINESS_TIMEZONE);
    if (fixedOffset != null) {
      const fixedContext = buildDateContextFromOffset(targetDate, fixedOffset, `${BUSINESS_TIMEZONE} (fixed)`);
      if (fixedContext) return fixedContext;
    }

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    return {
      dayOfWeek: targetDate.getDay(),
      dateStr: `${year}-${month}-${day}`,
      nowMinutes: (targetDate.getHours() * 60) + targetDate.getMinutes(),
      timezone: 'local',
    };
  }
}

function getLocalDateContext(date) {
  const targetDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  return {
    dayOfWeek: targetDate.getDay(),
    dateStr: `${year}-${month}-${day}`,
    nowMinutes: (targetDate.getHours() * 60) + targetDate.getMinutes(),
    timezone: 'local',
  };
}

function getUtcDateContext(date) {
  const targetDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = targetDate.getUTCFullYear();
  const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getUTCDate()).padStart(2, '0');
  return {
    dayOfWeek: targetDate.getUTCDay(),
    dateStr: `${year}-${month}-${day}`,
    nowMinutes: (targetDate.getUTCHours() * 60) + targetDate.getUTCMinutes(),
    timezone: 'utc',
  };
}

function isWithinHours(nowMinutes, openTime, closeTime) {
  if (!Number.isFinite(nowMinutes)) return null;
  const openMinutes = parseTimeToMinutes(openTime);
  const closeMinutes = parseTimeToMinutes(closeTime);
  if (openMinutes === null || closeMinutes === null) return null;
  if (openMinutes === closeMinutes) return false;

  if (closeMinutes > openMinutes) {
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }

  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
}

function getOutOfHoursMessage() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('out_of_hours_message');
    return row && row.value ? row.value : '🕒 Nosso horário de atendimento já encerrou. Retornaremos no próximo horário de funcionamento.';
  } catch (_) {
    return '🕒 Nosso horário de atendimento já encerrou. Retornaremos no próximo horário de funcionamento.';
  }
}

function isOutOfHoursEnabled() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('out_of_hours_enabled');
    return row ? row.value !== '0' : true;
  } catch (_) {
    return true;
  }
}

function getWelcomeMessage() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('welcome_message');
    return row && row.value ? row.value : '👋 Olá! Seja bem-vindo(a)! Um de nossos atendentes já vai responder você. Por favor, aguarde um momento.';
  } catch (_) {
    return '👋 Olá! Seja bem-vindo(a)! Um de nossos atendentes já vai responder você. Por favor, aguarde um momento.';
  }
}

function isWelcomeMessageEnabled() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('welcome_message_enabled');
    return row ? row.value !== '0' : true;
  } catch (_) {
    return true;
  }
}

function shouldSendWelcomeMessage(ticketId) {
  try {
    const row = db
      .prepare('SELECT id FROM messages WHERE ticket_id = ? AND sender IN (?, ?) LIMIT 1')
      .get(ticketId, 'agent', 'system');
    return !row;
  } catch (_) {
    return false;
  }
}

function normalizePhoneForBlacklist(phoneNumber) {
  if (!phoneNumber) return '';
  return String(phoneNumber).split('@')[0].replace(/\D/g, '');
}

function isPhoneInBlacklist(phoneNumber) {
  try {
    const normalized = normalizePhoneForBlacklist(phoneNumber);
    if (!normalized) return false;
    const row = db.prepare('SELECT 1 FROM blacklist WHERE phone = ? LIMIT 1').get(normalized);
    return !!row;
  } catch (_) {
    return false;
  }
}

function shouldSendOutOfHours(phoneNumber, now) {
  try {
    const row = db.prepare('SELECT last_sent_at FROM out_of_hours_log WHERE phone = ?').get(phoneNumber);
    if (row && row.last_sent_at) {
      const lastSent = Number(row.last_sent_at);
      if (!Number.isNaN(lastSent)) {
        const diffMinutes = (now.getTime() - lastSent) / 60000;
        if (diffMinutes < OUT_OF_HOURS_COOLDOWN_MINUTES) return false;
      }
    }

    db.prepare(`
      INSERT INTO out_of_hours_log (phone, last_sent_at)
      VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET last_sent_at = excluded.last_sent_at
    `).run(phoneNumber, now.getTime());

    return true;
  } catch (_) {
    return false;
  }
}

function evaluateBusinessStatusForContext(context) {
  try {
    const exception = db.prepare('SELECT closed, open_time, close_time FROM business_exceptions WHERE date = ?').get(context.dateStr);
    if (exception) {
      if (exception.closed) return { isOpen: false, reason: 'exception' };
      if (exception.open_time && exception.close_time) {
        const withinException = isWithinHours(context.nowMinutes, exception.open_time, exception.close_time);
        if (withinException === null) {
          return { isOpen: true, reason: 'invalid_exception_hours', context };
        }
        return { isOpen: withinException, reason: 'exception', context };
      }
      return { isOpen: false, reason: 'exception', context };
    }

    const hours = db.prepare('SELECT open_time, close_time, enabled FROM business_hours WHERE day = ?').get(context.dayOfWeek);
    const enabled = !!(hours && (hours.enabled === 1 || hours.enabled === true || String(hours.enabled || '') === '1'));
    if (!hours || !enabled) return { isOpen: false, reason: 'closed', context };

    const isOpen = isWithinHours(context.nowMinutes, hours.open_time, hours.close_time);
    if (isOpen === null) {
      return { isOpen: true, reason: 'invalid_hours', context };
    }
    return { isOpen, reason: isOpen ? 'open' : 'closed', context };
  } catch (_) {
    return { isOpen: true, reason: 'error' };
  }
}

function getBusinessStatus(date) {
  const targetDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const primaryContext = getBusinessDateContext(targetDate);
  const primaryStatus = evaluateBusinessStatusForContext(primaryContext);
  if (primaryStatus.isOpen) return primaryStatus;

  // Fallback defensivo para evitar falso "fora do horário" em casos de timezone
  // divergente entre servidor e configuração.
  const fixedOffset = fixedTimezoneOffsetMinutes(BUSINESS_TIMEZONE);
  const fixedContext = fixedOffset == null
    ? null
    : buildDateContextFromOffset(targetDate, fixedOffset, `${BUSINESS_TIMEZONE} (fixed)`);
  const fallbackContexts = [fixedContext, getLocalDateContext(targetDate), getUtcDateContext(targetDate)];
  for (const context of fallbackContexts) {
    if (!context || !context.dateStr) continue;
    const fallbackStatus = evaluateBusinessStatusForContext(context);
    if (fallbackStatus.isOpen) {
      return {
        ...fallbackStatus,
        reason: `${String(fallbackStatus.reason || 'open')}_fallback`,
        primaryStatus,
      };
    }
  }

  return primaryStatus;
}

function ensureActiveTicketForPhone(phoneNumber, contactName) {
  let ticket = null;
  let isNewTicket = false;
  let previousTicketStatus = null;

  try {
    db.exec('BEGIN IMMEDIATE');

    ticket = db.prepare(
      "SELECT * FROM tickets WHERE phone = ? AND status NOT IN ('resolvido','encerrado') ORDER BY id DESC LIMIT 1"
    ).get(phoneNumber);

    if (!ticket) {
      const result = db.prepare('INSERT INTO tickets (phone, status, contact_name) VALUES (?, ?, ?)')
        .run(phoneNumber, 'pendente', contactName || null);
      ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
      isNewTicket = true;

      try {
        const prev = db.prepare(
          "SELECT id, status FROM tickets WHERE phone = ? AND id < ? ORDER BY id DESC LIMIT 1"
        ).get(phoneNumber, ticket.id);
        previousTicketStatus = prev && prev.status ? String(prev.status) : null;
      } catch (_) {
        previousTicketStatus = null;
      }
    } else if (contactName && ticket.contact_name !== contactName) {
      db.prepare('UPDATE tickets SET contact_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(contactName, ticket.id);
      ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id);
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    ticket = db.prepare(
      "SELECT * FROM tickets WHERE phone = ? AND status NOT IN ('resolvido','encerrado') ORDER BY id DESC LIMIT 1"
    ).get(phoneNumber);

    if (!ticket) throw err;
  }

  return { ticket, isNewTicket, previousTicketStatus };
}

async function downloadMediaFromWhatsApp(mediaId) {
  const config = getConfig();
  if (!isConfigured(config)) {
    throw new Error('WhatsApp Cloud API não configurada');
  }

  const mediaInfo = await callGraph(mediaId, { method: 'GET' });
  if (!mediaInfo || !mediaInfo.url) {
    throw new Error('URL de mídia indisponível');
  }

  const mediaResponse = await axios.get(mediaInfo.url, {
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: Number(process.env.WA_CLOUD_MEDIA_TIMEOUT_MS || 30000),
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
    validateStatus: () => true,
  });

  if (mediaResponse.status < 200 || mediaResponse.status >= 300) {
    throw new Error(`Falha ao baixar mídia (${mediaResponse.status})`);
  }

  const mimeType = String(mediaInfo.mime_type || mediaResponse.headers['content-type'] || '')
    .split(';')[0]
    .trim() || 'application/octet-stream';

  return {
    buffer: Buffer.from(mediaResponse.data),
    mimeType,
    url: mediaInfo.url,
  };
}

async function processInboundMessage(msg, value) {
  if (!msg || typeof msg !== 'object') return;
  if (!msg.from) return;

  const phoneNumber = normalizePhone(msg.from);
  if (!phoneNumber) {
    logger.warn(`[INBOUND] Mensagem ignorada sem telefone válido: ${msg.from}`);
    return;
  }

  const contactName =
    (Array.isArray(value && value.contacts) && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name)
      ? String(value.contacts[0].profile.name)
      : null;
  const contactAvatarUrl = extractContactProfilePictureUrl({
    contacts: Array.isArray(value && value.contacts) ? value.contacts : [],
  });
  if (contactAvatarUrl) {
    saveContactProfilePicture(phoneNumber, contactAvatarUrl, 'whatsapp');
  }

  const now = new Date();
  const businessStatus = getBusinessStatus(now);
  const isBlacklistedForAutoMessages = isPhoneInBlacklist(phoneNumber);

  let messageContent = '';
  let messageType = 'text';
  let mediaUrl = null;

  try {
    switch (msg.type) {
      case 'text': {
        messageContent = msg.text && msg.text.body ? String(msg.text.body) : '';
        messageType = 'text';
        break;
      }
      case 'image': {
        messageType = 'image';
        messageContent = (msg.image && msg.image.caption) ? String(msg.image.caption) : '[Imagem]';
        if (msg.image && msg.image.id) {
          mediaUrl = buildCloudMediaUrl(msg.image.id, 'image');
        }
        break;
      }
      case 'video': {
        messageType = 'video';
        messageContent = (msg.video && msg.video.caption) ? String(msg.video.caption) : '[Vídeo]';
        if (msg.video && msg.video.id) {
          mediaUrl = buildCloudMediaUrl(msg.video.id, 'video');
        }
        break;
      }
      case 'audio': {
        messageType = 'audio';
        messageContent = '🎤 Áudio';
        if (msg.audio && msg.audio.id) {
          mediaUrl = buildCloudMediaUrl(msg.audio.id, 'audio');
        }
        break;
      }
      case 'sticker': {
        messageType = 'sticker';
        messageContent = '[Figurinha]';
        if (msg.sticker && msg.sticker.id) {
          mediaUrl = buildCloudMediaUrl(msg.sticker.id, 'sticker');
        }
        break;
      }
      case 'document': {
        messageType = 'document';
        const filename = msg.document && msg.document.filename ? String(msg.document.filename) : 'arquivo';
        messageContent = `[Documento: ${filename}]`;
        if (msg.document && msg.document.id) {
          mediaUrl = buildCloudMediaUrl(msg.document.id, 'document');
        }
        break;
      }
      default: {
        messageType = msg.type || 'other';
        messageContent = '[Mídia não suportada]';
      }
    }
  } catch (mediaErr) {
    logger.warn(`[INBOUND] Falha ao processar mídia (${phoneNumber}): ${mediaErr.message || mediaErr}`);
    if (messageType === 'image') messageContent = '[Imagem - erro ao carregar]';
    if (messageType === 'video') messageContent = '[Vídeo - erro ao carregar]';
    if (messageType === 'audio') messageContent = '[Áudio - erro ao carregar]';
    if (messageType === 'sticker') messageContent = '[Figurinha - erro ao carregar]';
    mediaUrl = null;
  }

  const { ticket, isNewTicket, previousTicketStatus } = ensureActiveTicketForPhone(phoneNumber, contactName);

  if (!ticket) return;

  if (isNewTicket) {
    try {
      events.emit('ticket', { ticketId: ticket.id, phone: ticket.phone, status: ticket.status });
    } catch (_) {}
  }

  if (!isBlacklistedForAutoMessages) {
    const shouldSendWelcome = (
      businessStatus.isOpen
      && isWelcomeMessageEnabled()
      && shouldSendWelcomeMessage(ticket.id)
    );

    if (shouldSendWelcome) {
      const welcomeMessage = getWelcomeMessage();
      if (welcomeMessage) {
        sendTextMessage(phoneNumber, welcomeMessage)
          .then(() => {
            try {
              db.prepare(`
                INSERT INTO messages (ticket_id, sender, content, message_type, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              `).run(ticket.id, 'system', welcomeMessage, 'text');
            } catch (_) {}
          })
          .catch((err) => {
            logger.warn(`[WELCOME] Falha ao enviar boas-vindas (${phoneNumber}): ${err.message || err}`);
          });
      }
    } else if (!businessStatus.isOpen && isOutOfHoursEnabled()) {
      try {
        if (shouldSendOutOfHours(phoneNumber, now)) {
          const outOfHoursMessage = getOutOfHoursMessage();
          if (outOfHoursMessage) {
            sendTextMessage(phoneNumber, outOfHoursMessage).catch((err) => {
              logger.warn(`[AUTO_REPLY] Falha ao enviar mensagem fora do horário (${phoneNumber}): ${err.message || err}`);
            });
          }
        }
      } catch (err) {
        logger.warn('[AUTO_REPLY] Erro ao avaliar mensagem fora do horário:', err.message || err);
      }
    }
  }

  if (isNewTicket && (previousTicketStatus === 'resolvido' || previousTicketStatus === 'encerrado')) {
    try {
      const statusLabel = previousTicketStatus === 'resolvido' ? 'resolvido' : 'encerrado';
      db.prepare(`
        INSERT INTO messages (ticket_id, sender, content, message_type, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(ticket.id, 'system', `Ticket anterior foi ${statusLabel}. Um novo ticket foi iniciado.`, 'system');
    } catch (_) {}
  }

  const replyContextId = msg && msg.context && msg.context.id ? String(msg.context.id) : null;
  let replyToId = null;

  if (replyContextId) {
    try {
      const row = db
        .prepare('SELECT id FROM messages WHERE whatsapp_message_id = ? ORDER BY id DESC LIMIT 1')
        .get(replyContextId);
      if (row && row.id) replyToId = row.id;
    } catch (_) {}
  }

  const normalizedJid = normalizePhoneForJid(phoneNumber);
  const messageId = msg && msg.id ? String(msg.id) : null;

  // Evita mensagens duplicadas em caso de retries do webhook (Meta/Firebase).
  if (messageId) {
    const existing = db.prepare('SELECT id FROM messages WHERE whatsapp_message_id = ? ORDER BY id DESC LIMIT 1').get(messageId);
    if (existing && existing.id) {
      try {
        db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticket.id);
      } catch (_) {}
      return;
    }
  }

  const whatsappKey = {
    id: messageId,
    remoteJid: normalizedJid,
    fromMe: false,
  };

  const inserted = db.prepare(`
    INSERT INTO messages (ticket_id, sender, content, message_type, media_url, reply_to_id, whatsapp_key, whatsapp_message, whatsapp_message_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    ticket.id,
    'client',
    messageContent,
    messageType,
    mediaUrl,
    replyToId,
    JSON.stringify(whatsappKey),
    JSON.stringify(msg || {}),
    messageId
  );

  try {
    db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticket.id);
  } catch (_) {}

  // Fallback pragmático: se o cliente respondeu, considera mensagens anteriores do agente como lidas.
  // Isso cobre cenários em que o webhook de status não chega no ambiente local.
  try {
    const statusUpdate = db.prepare(`
      UPDATE messages
      SET message_status = 'read',
          message_status_updated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
        AND sender = 'agent'
        AND whatsapp_message_id IS NOT NULL
        AND (message_status IS NULL OR message_status IN ('sent', 'delivered'))
    `).run(ticket.id);

    if (statusUpdate && Number(statusUpdate.changes || 0) > 0) {
      try {
        events.emit('message', {
          ticketId: ticket.id,
          messageId: null,
          deliveryStatus: 'read',
          ts: Date.now(),
        });
      } catch (_) {}
    }
  } catch (_) {}

  try {
    events.emit('message', {
      ticketId: ticket.id,
      phone: ticket.phone,
      messageId: inserted && inserted.lastInsertRowid ? inserted.lastInsertRowid : null,
      ts: Date.now(),
    });
  } catch (_) {}
}

function extractWebhookMessageGroups(payload) {
  const groups = [];

  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change && change.value ? change.value : null;
      if (value && Array.isArray(value.messages) && value.messages.length > 0) {
        groups.push(value);
      }
    }
  }

  // Compatibilidade com payloads já "desembrulhados" por gateways/proxies.
  if (payload && Array.isArray(payload.messages) && payload.messages.length > 0) {
    groups.push(payload);
  }

  if (payload && payload.value && Array.isArray(payload.value.messages) && payload.value.messages.length > 0) {
    groups.push(payload.value);
  }

  return groups;
}

function extractWebhookStatusGroups(payload) {
  const groups = [];

  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change && change.value ? change.value : null;
      if (value && Array.isArray(value.statuses) && value.statuses.length > 0) {
        groups.push(value);
      }
    }
  }

  // Compatibilidade com payloads já "desembrulhados" por gateways/proxies.
  if (payload && Array.isArray(payload.statuses) && payload.statuses.length > 0) {
    groups.push(payload);
  }

  if (payload && payload.value && Array.isArray(payload.value.statuses) && payload.value.statuses.length > 0) {
    groups.push(payload.value);
  }

  return groups;
}

function normalizeOutboundMessageStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'sent') return 'sent';
  if (status === 'delivered') return 'delivered';
  if (status === 'read') return 'read';
  if (status === 'failed') return 'failed';
  return null;
}

const OUTBOUND_STATUS_PRIORITY = Object.freeze({
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
});

function shouldPromoteMessageStatus(currentStatus, nextStatus) {
  const current = normalizeOutboundMessageStatus(currentStatus);
  const next = normalizeOutboundMessageStatus(nextStatus);
  if (!next) return false;
  if (!current) return true;
  if (next === current) return false;
  if (next === 'failed') return true;
  if (current === 'failed') return true;
  return OUTBOUND_STATUS_PRIORITY[next] >= OUTBOUND_STATUS_PRIORITY[current];
}

function toSqliteTimestampFromWebhookSeconds(rawSeconds) {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function processStatusWebhook(statusItem) {
  const messageId = String(statusItem && statusItem.id ? statusItem.id : '').trim();
  if (!messageId) return;

  const nextStatus = normalizeOutboundMessageStatus(statusItem && statusItem.status);
  if (!nextStatus) return;

  let row = null;
  try {
    row = db
      .prepare('SELECT id, ticket_id, sender, message_status FROM messages WHERE whatsapp_message_id = ? ORDER BY id DESC LIMIT 1')
      .get(messageId);
  } catch (_) {
    row = null;
  }
  if (!row || !row.id) return;

  if (row.sender !== 'agent') return;
  if (!shouldPromoteMessageStatus(row.message_status, nextStatus)) return;

  const statusAt = toSqliteTimestampFromWebhookSeconds(statusItem && statusItem.timestamp);
  try {
    db.prepare(`
      UPDATE messages
      SET message_status = ?,
          message_status_updated_at = COALESCE(?, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextStatus, statusAt, row.id);
  } catch (_) {
    return;
  }

  try {
    events.emit('message', {
      ticketId: Number(row.ticket_id || 0),
      messageId: Number(row.id),
      deliveryStatus: nextStatus,
      ts: Date.now(),
    });
  } catch (_) {}
}

async function processWebhookPayload(payload) {
  const messageGroups = extractWebhookMessageGroups(payload);
  const statusGroups = extractWebhookStatusGroups(payload);

  for (const group of messageGroups) {
    const messages = Array.isArray(group && group.messages) ? group.messages : [];
    for (const msg of messages) {
      try {
        await processInboundMessage(msg, group);
      } catch (err) {
        logger.error('[WEBHOOK] Erro ao processar mensagem recebida:', err);
      }
    }
  }

  for (const group of statusGroups) {
    const statuses = Array.isArray(group && group.statuses) ? group.statuses : [];
    for (const status of statuses) {
      try {
        processStatusWebhook(status);
      } catch (err) {
        logger.error('[WEBHOOK] Erro ao processar status de mensagem:', err);
      }
    }
  }
}

async function startBot() {
  started = true;
  runtimePhoneNumberId = '';
  activeSender = null;
  const config = getConfig();
  if (!isConfigured(config)) {
    markDisconnected('missing_config', 'WA_CLOUD_ACCESS_TOKEN/WA_CLOUD_PHONE_NUMBER_ID ausentes');
    return getSocket();
  }

  if (!config.verifyToken) {
    markDisconnected('missing_verify_token', 'WA_CLOUD_VERIFY_TOKEN ausente');
    return getSocket();
  }

  try {
    // Valida token e phone_number_id no startup para evitar falso "conectado".
    const configuredPhone = await callGraph(`${config.phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status`, {
      method: 'GET',
    });
    setActiveSender(configuredPhone, 'configured');

    if (isTestSenderMetadata(configuredPhone)) {
      try {
        const resolved = await resolvePreferredPhoneNumber(config.phoneNumberId);
        if (resolved && resolved.phoneNumber && resolved.phoneNumber.id) {
          runtimePhoneNumberId = String(resolved.phoneNumber.id).trim();
          setActiveSender(resolved.phoneNumber, 'auto_selected');
          logger.info(`[STARTUP] Número de teste detectado; usando número personalizado ${runtimePhoneNumberId} (WABA ${resolved.wabaId})`);
          await callGraph(`${runtimePhoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status`, {
            method: 'GET',
          });
        } else {
          logger.warn('[STARTUP] Número de teste ativo e nenhum número personalizado foi encontrado no mesmo WABA.');
        }
      } catch (switchErr) {
        logger.warn(`[STARTUP] Não foi possível buscar número personalizado automaticamente: ${String((switchErr && switchErr.message) || switchErr)}`);
      }
    }

    try {
      const effectiveConfig = getConfig();
      await ensureWabaSubscribedApps(effectiveConfig.phoneNumberId);
    } catch (subscribeErr) {
      logger.warn(`[STARTUP] Falha ao garantir subscribed_apps: ${String((subscribeErr && subscribeErr.message) || subscribeErr)}`);
    }

    await callGraph(`${getConfig().phoneNumberId}?fields=id`, { method: 'GET' });
    markConnected();
  } catch (err) {
    const reason = String((err && err.message) || 'Falha ao validar WhatsApp Cloud API no startup');
    markDisconnected((err && err.httpStatus) || 'startup_validation_failed', reason);
    logger.error('[STARTUP] Falha na validação da WhatsApp Cloud API:', reason);
  }
  return getSocket();
}

function getSocket() {
  if (!isConfigured()) return null;

  return {
    store: { contacts: {} },
    async sendMessage(jid, message, options = {}) {
      const raw = String(jid || '').split('@')[0];
      const phoneNumber = normalizePhone(raw);
      if (!phoneNumber) throw new Error('Telefone inválido para envio');

      const contextMessageId =
        (options && options.quoted && options.quoted.key && options.quoted.key.id)
          ? String(options.quoted.key.id)
          : (options && options.contextMessageId ? String(options.contextMessageId) : null);

      let responsePayload = null;
      if (message && typeof message.text === 'string') {
        try {
          responsePayload = await sendTextMessage(phoneNumber, message.text, { contextMessageId });
        } catch (err) {
          if (contextMessageId && shouldRetryWithoutContext(err)) {
            logger.warn(`[SEND] Falha com context_message_id (${contextMessageId}), tentando sem reply-context.`);
            responsePayload = await sendTextMessage(phoneNumber, message.text, {});
          } else {
            throw err;
          }
        }
      } else if (message && message.audio && message.audio.url) {
        try {
          responsePayload = await sendAudioMessage(phoneNumber, message.audio.url, {
            contextMessageId,
            mimeType: message.mimetype || 'audio/ogg',
          });
        } catch (err) {
          if (contextMessageId && shouldRetryWithoutContext(err)) {
            logger.warn(`[SEND] Falha de áudio com context_message_id (${contextMessageId}), tentando sem reply-context.`);
            responsePayload = await sendAudioMessage(phoneNumber, message.audio.url, {
              mimeType: message.mimetype || 'audio/ogg',
            });
          } else {
            throw err;
          }
        }
      } else if (message && message.image && message.image.url) {
        try {
          responsePayload = await sendImageMessage(phoneNumber, message.image.url, {
            contextMessageId,
            mimeType: message.mimetype || 'image/jpeg',
            caption: message.caption || null,
          });
        } catch (err) {
          if (contextMessageId && shouldRetryWithoutContext(err)) {
            logger.warn(`[SEND] Falha de imagem com context_message_id (${contextMessageId}), tentando sem reply-context.`);
            responsePayload = await sendImageMessage(phoneNumber, message.image.url, {
              mimeType: message.mimetype || 'image/jpeg',
              caption: message.caption || null,
            });
          } else {
            throw err;
          }
        }
      } else {
        throw new Error('Tipo de mensagem não suportado pelo provedor oficial');
      }

      const outboundMessageId = extractSentMessageId(responsePayload);
      return {
        key: {
          id: outboundMessageId,
          remoteJid: `${phoneNumber}@s.whatsapp.net`,
          fromMe: true,
        },
        message: message || {},
        response: responsePayload,
      };
    },
    async profilePictureUrl(jidValue) {
      return fetchContactProfilePictureUrl(jidValue);
    },
    profilePictureLookupState() {
      return getProfilePictureLookupState();
    },
    async onWhatsApp(jidValue) {
      const num = normalizePhone(String(jidValue || '').split('@')[0]);
      if (!num) return [];
      return [{ exists: true, jid: `${num}@s.whatsapp.net` }];
    },
    async getBusinessProfile() {
      return null;
    },
  };
}

function getQrState() {
  const config = getConfig();
  const connected = isConfigured(config);
  const state = getConnectionState(config);

  return {
    qr: null,
    qrAt: null,
    connectionState: state,
    connected: state === 'open' && connected,
    stableConnected: state === 'open' && connected,
    lastConnectedAt,
    lastDisconnectedAt,
    lastDisconnectCode,
    lastDisconnectReason,
    reconnectAttempts: 0,
    reconnectScheduledAt: null,
  };
}

async function forceNewQr(_allowWhenConnected = false) {
  if (!isConfigured()) {
    return { ok: false, reason: 'missing_config' };
  }

  return { ok: true };
}

function verifyWebhook({ mode, token }) {
  const config = getConfig();
  const expected = String(config.verifyToken || '').trim();
  if (!expected) return false;

  return mode === 'subscribe' && token === expected;
}

module.exports = startBot;
module.exports.startBot = startBot;
module.exports.getSocket = getSocket;
module.exports.getQrState = getQrState;
module.exports.forceNewQr = forceNewQr;
module.exports.processWebhookPayload = processWebhookPayload;
module.exports.verifyWebhook = verifyWebhook;
module.exports.sendTextMessage = sendTextMessage;
module.exports.sendAudioMessage = sendAudioMessage;
module.exports.downloadMediaById = downloadMediaFromWhatsApp;
module.exports.isConfigured = () => isConfigured(getConfig());
module.exports.getConfig = getConfig;
module.exports.getActiveSender = getActiveSender;
module.exports.getProfilePictureLookupState = getProfilePictureLookupState;
module.exports._debug = {
  get started() {
    return started;
  },
};
