'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  assignTicket,
  createQuickMessage,
  deleteQuickMessage,
  fetchProfilePicture,
  getAuthSession,
  getConnectionStatus,
  getTicketById,
  getTicketMessages,
  listContactTickets,
  listDueReminders,
  listQuickMessages,
  listAssignees,
  listTickets,
  logout,
  markTicketReadByAgent,
  sendAudioMessage,
  sendImageMessage,
  sendTextMessage,
  updateQuickMessage,
  updateTicketStatus,
} from '@/src/frontend/lib/chatApi';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { clearAuthToken, getApiBase, getAuthToken, resolveProfilePictureUrl } from '@/src/frontend/lib/runtime';
import { useInterval } from '@/src/frontend/hooks/useInterval';
import { useToast } from '@/src/frontend/hooks/useToast';
import type { ToastType } from '@/src/frontend/hooks/useToast';
import { ChatHeader } from '@/src/frontend/components/chat/ChatHeader';
import { MessageComposer } from '@/src/frontend/components/chat/MessageComposer';
import { TicketHistory } from '@/src/frontend/components/chat/TicketHistory';
import { MessageList } from '@/src/frontend/components/chat/MessageList';
import { TicketReminders } from '@/src/frontend/components/chat/TicketReminders';
import { TicketList } from '@/src/frontend/components/chat/TicketList';
import { ToastViewport } from '@/src/frontend/components/chat/ToastViewport';
import type { Assignee, AuthSession, ChatMessage, DueTicketReminder, QuickMessage, Ticket } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

function isClosedTicket(ticket: Ticket | null): boolean {
  if (!ticket) return true;
  return ticket.status === 'resolvido' || ticket.status === 'encerrado';
}

function phoneKey(value: unknown): string {
  return String(value || '').trim();
}

function normalizePhoneForApi(value: unknown): string {
  return String(value || '').split('@')[0].replace(/\D/g, '');
}

function isProfilePictureLookupUrl(value: string): boolean {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;
  return /\/profile-picture\/[^/]+\/image/.test(normalized)
    || /\/__api\/profile-picture\/[^/]+\/image/.test(normalized);
}

function profilePictureScore(value: string): number {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized.startsWith('blob:') || normalized.startsWith('data:')) return 4;
  if (normalized.startsWith('/media/profiles/') || normalized.includes('/__api/media/profiles/')) return 3;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return 2;
  if (isProfilePictureLookupUrl(normalized)) return 1;
  return 0;
}

function isClosedStatus(status: string | null | undefined): boolean {
  return status === 'resolvido' || status === 'encerrado';
}

function buildReminderToastMessage(reminder: DueTicketReminder): string {
  const contact = String(reminder.contact_name || reminder.phone || `Ticket #${reminder.ticket_id}`).trim();
  const base = `Agendamento agora: ${contact}`;
  const reminderText = String(reminder.message || reminder.note || '').trim();
  if (!reminderText) return `${base}. Abra a conversa para continuar.`;
  const clipped = reminderText.length > 180 ? `${reminderText.slice(0, 177)}...` : reminderText;
  return `${base}. Mensagem: ${clipped}`;
}

function sameTicketSnapshot(current: Ticket[], next: Ticket[]): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const b = next[i];
    if (Number(a.id) !== Number(b.id)) return false;
    if (String(a.updated_at || '') !== String(b.updated_at || '')) return false;
    if (String(a.status || '') !== String(b.status || '')) return false;
    if (String(a.phone || '') !== String(b.phone || '')) return false;
    if (String(a.contact_name || '') !== String(b.contact_name || '')) return false;
    if (Number(a.seller_id || 0) !== Number(b.seller_id || 0)) return false;
    if (String(a.seller_name || '') !== String(b.seller_name || '')) return false;
    if (String(a.avatar_url || '') !== String(b.avatar_url || '')) return false;
    if (Number(a.unread_count || 0) !== Number(b.unread_count || 0)) return false;
    if (String(a.last_message_content || '') !== String(b.last_message_content || '')) return false;
    if (String(a.last_message_type || '') !== String(b.last_message_type || '')) return false;
    if (String(a.last_message_sender || '') !== String(b.last_message_sender || '')) return false;
    if (String(a.last_message_at || '') !== String(b.last_message_at || '')) return false;
  }
  return true;
}

function sameMessageSnapshot(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const b = next[i];
    if (Number(a.id) !== Number(b.id)) return false;
    if (String(a.updated_at || '') !== String(b.updated_at || '')) return false;
    if (String(a.content || '') !== String(b.content || '')) return false;
    if (String(a.media_url || '') !== String(b.media_url || '')) return false;
    if (String(a.message_status || '') !== String(b.message_status || '')) return false;
    if (String(a.message_status_updated_at || '') !== String(b.message_status_updated_at || '')) return false;
  }
  return true;
}

function sortTicketsByNewest(list: Ticket[]): Ticket[] {
  return [...list].sort((a, b) => Number(b.id) - Number(a.id));
}

function parseSqliteTimestamp(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasTicketPreviewData(ticket: Ticket): boolean {
  return Boolean(
    String(ticket.last_message_at || '').trim()
    || String(ticket.last_message_content || '').trim()
    || String(ticket.last_message_type || '').trim()
  );
}

function ticketActivityAt(ticket: Ticket): string | null {
  const last = String(ticket.last_message_at || '').trim();
  if (last) return last;
  const updated = String(ticket.updated_at || '').trim();
  if (updated) return updated;
  const created = String(ticket.created_at || '').trim();
  if (created) return created;
  return null;
}

function sortTicketsByActivity(list: Ticket[]): Ticket[] {
  return [...list].sort((a, b) => {
    const aTs = parseSqliteTimestamp(ticketActivityAt(a));
    const bTs = parseSqliteTimestamp(ticketActivityAt(b));
    if (aTs !== bTs) return bTs - aTs;
    return Number(b.id) - Number(a.id);
  });
}

function sortMessagesChronologically(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const aTs = parseSqliteTimestamp(a.created_at || a.updated_at || null);
    const bTs = parseSqliteTimestamp(b.created_at || b.updated_at || null);
    if (aTs !== bTs) return aTs - bTs;
    return Number(a.id) - Number(b.id);
  });
}

function resolveRealtimeSocketUrls(): string[] {
  if (typeof window === 'undefined') return [];

  const token = getAuthToken();
  const candidates = new Set<string>();
  const apiBase = String(getApiBase() || '').trim();
  if (apiBase) candidates.add(apiBase);
  const currentOrigin = String(window.location.origin || '').trim();
  if (currentOrigin) candidates.add(currentOrigin);

  const urls: string[] = [];
  for (const rawBase of candidates) {
    try {
      const url = new URL(rawBase);
      if (url.protocol === 'http:') url.protocol = 'ws:';
      else if (url.protocol === 'https:') url.protocol = 'wss:';
      else continue;
      url.pathname = '/ws';
      url.search = '';
      if (token) url.searchParams.set('auth', token);
      urls.push(url.toString());
    } catch (_) {
      // noop
    }
  }

  return urls;
}

function sortQuickMessagesByNewest(list: QuickMessage[]): QuickMessage[] {
  return [...list].sort((a, b) => {
    const aTs = Date.parse(String(a.updated_at || a.created_at || '')) || 0;
    const bTs = Date.parse(String(b.updated_at || b.created_at || '')) || 0;
    if (aTs !== bTs) return bTs - aTs;
    return Number(b.id) - Number(a.id);
  });
}

function sameQuickMessageSnapshot(current: QuickMessage[], next: QuickMessage[]): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let i = 0; i < current.length; i += 1) {
    const a = current[i];
    const b = next[i];
    if (Number(a.id) !== Number(b.id)) return false;
    if (String(a.shortcut || '') !== String(b.shortcut || '')) return false;
    if (String(a.title || '') !== String(b.title || '')) return false;
    if (String(a.content || '') !== String(b.content || '')) return false;
    if (String(a.updated_at || '') !== String(b.updated_at || '')) return false;
  }
  return true;
}

const QUICK_MESSAGES_STORAGE_PREFIX = 'AUTOZAP_QUICK_MESSAGES_V1';

function normalizeQuickShortcutValue(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24)
    .toLowerCase();
  return normalized || null;
}

function quickMessagesStorageKey(session: AuthSession | null): string {
  if (!session) return `${QUICK_MESSAGES_STORAGE_PREFIX}:guest`;
  return `${QUICK_MESSAGES_STORAGE_PREFIX}:${session.userType}:${session.userId}`;
}

function readLocalQuickMessages(session: AuthSession | null): QuickMessage[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(quickMessagesStorageKey(session));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const fallbackUserId = Number(session?.userId || 0);
    const fallbackUserType = session?.userType === 'admin' ? 'admin' : 'seller';
    const normalized: QuickMessage[] = [];

    for (const row of parsed) {
      const id = Number(row && row.id);
      const title = String((row && row.title) || '').trim();
      const content = String((row && row.content) || '').trim();
      if (!Number.isFinite(id) || id <= 0 || !title || !content) continue;

      const shortcut = normalizeQuickShortcutValue(row && row.shortcut);
      const userType = row && row.user_type === 'admin'
        ? 'admin'
        : row && row.user_type === 'seller'
          ? 'seller'
          : fallbackUserType;
      const userId = Number((row && row.user_id) || fallbackUserId) || fallbackUserId;
      const createdAt = String((row && row.created_at) || '') || new Date().toISOString();
      const updatedAt = String((row && row.updated_at) || createdAt) || createdAt;

      normalized.push({
        id,
        user_id: userId,
        user_type: userType,
        shortcut,
        title,
        content,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }

    return normalized;
  } catch (_) {
    return [];
  }
}

function writeLocalQuickMessages(session: AuthSession | null, rows: QuickMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(quickMessagesStorageKey(session), JSON.stringify(rows));
  } catch (_) {}
}

function getSafeApiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    const message = String(error.message || '').trim();
    if (!message) return fallback;
    if (/^HTTP\s+\d{3}$/i.test(message)) return fallback;
    return message;
  }
  return fallback;
}

function sameTicketRecord(a: Ticket | null, b: Ticket | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Number(a.id) === Number(b.id)
    && String(a.updated_at || '') === String(b.updated_at || '')
    && String(a.status || '') === String(b.status || '')
    && String(a.contact_name || '') === String(b.contact_name || '')
    && String(a.phone || '') === String(b.phone || '')
    && Number(a.seller_id || 0) === Number(b.seller_id || 0)
    && String(a.seller_name || '') === String(b.seller_name || '');
}

type TicketPreviewFallback = {
  last_message_content: string | null;
  last_message_type: Ticket['last_message_type'] | null;
  last_message_sender: Ticket['last_message_sender'] | null;
  last_message_at: string | null;
  source_updated_at: string;
};

export default function AgentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toasts, push: pushToast } = useToast();

  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [includeClosed, setIncludeClosed] = useState(false);

  const [connectionOnline, setConnectionOnline] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [selectedTicketOverride, setSelectedTicketOverride] = useState<Ticket | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [localUnreadVersion, setLocalUnreadVersion] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [contactTickets, setContactTickets] = useState<Ticket[]>([]);
  const [ticketHistoryLoading, setTicketHistoryLoading] = useState(false);
  const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([]);
  const [quickMessagesLoading, setQuickMessagesLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assigneeUpdating, setAssigneeUpdating] = useState(false);

  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list');
  const avatarLookupAtRef = useRef<Record<string, number>>({});
  const avatarInFlightRef = useRef<Record<string, Promise<void>>>({});
  const avatarUnavailableUntilRef = useRef<Record<string, number>>({});
  const quickMessagesModeRef = useRef<'remote' | 'local'>('remote');
  const quickMessagesRouteMissingRef = useRef(false);
  const quickMessagesFallbackWarnedRef = useRef(false);
  const remindedIdsRef = useRef<Record<number, true>>({});
  const selectedTicketIdRef = useRef<number | null>(null);
  const messagesByTicketRef = useRef<Record<number, ChatMessage[]>>({});
  const latestMessagesRequestByTicketRef = useRef<Record<number, number>>({});
  const markReadInFlightRef = useRef<Record<number, Promise<void>>>({});
  const lastMarkReadAtRef = useRef<Record<number, number>>({});
  const previewFallbackByTicketRef = useRef<Record<number, TicketPreviewFallback>>({});
  const previewFetchInFlightRef = useRef<Record<number, Promise<void>>>({});
  const localUnreadByTicketRef = useRef<Record<number, number>>({});
  const lastTicketUpdatedAtRef = useRef<Record<number, number>>({});
  const localUnreadInitializedRef = useRef(false);
  const realtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkHandledRef = useRef(false);

  const queryTicketId = useMemo(() => {
    const raw = String(searchParams.get('ticketId') || searchParams.get('ticket') || '').trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [searchParams]);

  const queryIncludeClosed = useMemo(() => {
    const raw = String(searchParams.get('includeClosed') || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }, [searchParams]);

  const activeTicket = useMemo(() => {
    if (!selectedTicketId) return null;
    const selectedId = Number(selectedTicketId);
    const fromList = tickets.find((ticket) => Number(ticket.id) === selectedId) || null;
    if (fromList) return fromList;
    if (selectedTicketOverride && Number(selectedTicketOverride.id) === selectedId) {
      return selectedTicketOverride;
    }
    return null;
  }, [selectedTicketId, selectedTicketOverride, tickets]);

  const sortedContactTickets = useMemo(
    () => sortTicketsByNewest(contactTickets),
    [contactTickets]
  );

  const latestContactTicketId = useMemo(() => {
    if (sortedContactTickets.length > 0) return Number(sortedContactTickets[0].id);
    if (!activeTicket) return null;
    return Number(activeTicket.id);
  }, [activeTicket, sortedContactTickets]);

  const isHistoricalTicket = useMemo(() => {
    if (!activeTicket || latestContactTicketId == null) return false;
    return Number(activeTicket.id) !== Number(latestContactTicketId);
  }, [activeTicket, latestContactTicketId]);

  const unreadByTicketSnapshot = useMemo(
    () => ({ ...localUnreadByTicketRef.current }),
    [localUnreadVersion]
  );

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    pushToast(message, type);
  }, [pushToast]);

  const handleAuthExpired = useCallback(() => {
    clearAuthToken();
    router.replace('/login');
  }, [router]);

  const loadSession = useCallback(async () => {
    try {
      const authSession = await getAuthSession();
      if (!authSession.authenticated) {
        handleAuthExpired();
        return;
      }
      setSession(authSession);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      showToast('Não foi possível validar sua sessão.', 'error');
    } finally {
      setSessionLoading(false);
    }
  }, [handleAuthExpired, showToast]);

  const loadConnectionStatus = useCallback(async () => {
    try {
      const status = await getConnectionStatus();
      setConnectionOnline(!!status.connected);
    } catch (_) {
      setConnectionOnline(false);
    }
  }, []);

  const loadAssignees = useCallback(async () => {
    try {
      const list = await listAssignees();
      setAssignees(Array.isArray(list) ? list : []);
    } catch (_) {
      setAssignees([]);
    }
  }, []);

  const refreshAvatarForPhone = useCallback(async (
    rawPhone: string,
    opts?: { force?: boolean; mapKey?: string }
  ) => {
    const key = phoneKey(opts && opts.mapKey ? opts.mapKey : rawPhone);
    const normalized = normalizePhoneForApi(rawPhone);
    if (!key || !normalized) return;

    const force = !!(opts && opts.force);
    const now = Date.now();
    const cooldownMs = force ? 4000 : 25000;
    const unavailableUntil = Number(avatarUnavailableUntilRef.current[key] || 0);
    if (!force && unavailableUntil > now) {
      return;
    }
    const lastLookupAt = Number(avatarLookupAtRef.current[key] || 0);
    if (!force && lastLookupAt && (now - lastLookupAt) < cooldownMs) {
      return;
    }

    const inFlight = avatarInFlightRef.current[key];
    if (inFlight) {
      await inFlight;
      return;
    }

    avatarLookupAtRef.current[key] = now;
    const task = (async () => {
      try {
        const payload = await fetchProfilePicture(normalized, force ? { refresh: true } : undefined);
        const nextUrl = payload && payload.url
          ? resolveProfilePictureUrl(normalized, payload.url)
          : '';
        if (!nextUrl) {
          const reason = String((payload && payload.reason) || '').trim().toLowerCase();
          const pending = !!(payload && payload.pending);
          const missTtlMs = pending
            ? 10000
            : (reason.includes('unsupported') ? (2 * 60 * 60 * 1000) : (5 * 60 * 1000));
          avatarUnavailableUntilRef.current[key] = Date.now() + missTtlMs;
          if (!force) return;
          setAvatars((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          return;
        }
        delete avatarUnavailableUntilRef.current[key];
        setAvatars((current) => (current[key] === nextUrl ? current : { ...current, [key]: nextUrl }));
      } catch (_) {
        avatarUnavailableUntilRef.current[key] = Date.now() + (2 * 60 * 1000);
        if (!force) return;
        setAvatars((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      } finally {
        delete avatarInFlightRef.current[key];
      }
    })();

    avatarInFlightRef.current[key] = task;
    await task;
  }, []);

  const mergeTicketWithPreviewFallback = useCallback((ticket: Ticket): Ticket => {
    if (hasTicketPreviewData(ticket)) return ticket;
    const ticketId = Number(ticket.id || 0);
    if (!Number.isFinite(ticketId) || ticketId <= 0) return ticket;
    const fallback = previewFallbackByTicketRef.current[ticketId];
    if (!fallback) return ticket;
    return {
      ...ticket,
      last_message_content: fallback.last_message_content,
      last_message_type: fallback.last_message_type,
      last_message_sender: fallback.last_message_sender,
      last_message_at: fallback.last_message_at,
    };
  }, []);

  const loadPreviewFallbackForTicket = useCallback(async (ticket: Ticket) => {
    const ticketId = Number(ticket.id || 0);
    if (!Number.isFinite(ticketId) || ticketId <= 0) return;
    if (hasTicketPreviewData(ticket)) {
      if (previewFallbackByTicketRef.current[ticketId]) {
        delete previewFallbackByTicketRef.current[ticketId];
      }
      return;
    }

    const sourceUpdatedAt = String(ticket.updated_at || ticket.created_at || '').trim();
    const cached = previewFallbackByTicketRef.current[ticketId];
    if (cached && cached.source_updated_at === sourceUpdatedAt) return;

    const inFlight = previewFetchInFlightRef.current[ticketId];
    if (inFlight) {
      await inFlight;
      return;
    }

    const task = (async () => {
      try {
        const rows = await getTicketMessages(ticketId, 1);
        const last = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null;
        const next: TicketPreviewFallback = {
          last_message_content: last ? String(last.content || '').trim() || null : null,
          last_message_type: last ? (last.message_type || 'text') : null,
          last_message_sender: last ? (last.sender || 'client') : null,
          last_message_at: last ? (last.created_at || last.updated_at || null) : null,
          source_updated_at: sourceUpdatedAt,
        };

        const prev = previewFallbackByTicketRef.current[ticketId];
        if (
          prev
          && prev.last_message_content === next.last_message_content
          && prev.last_message_type === next.last_message_type
          && prev.last_message_sender === next.last_message_sender
          && prev.last_message_at === next.last_message_at
          && prev.source_updated_at === next.source_updated_at
        ) {
          return;
        }

        previewFallbackByTicketRef.current[ticketId] = next;
        setTickets((current) => {
          let changed = false;
          const mapped = current.map((row) => {
            if (Number(row.id) !== ticketId) return row;
            if (hasTicketPreviewData(row)) return row;
            changed = true;
            return {
              ...row,
              last_message_content: next.last_message_content,
              last_message_type: next.last_message_type,
              last_message_sender: next.last_message_sender,
              last_message_at: next.last_message_at,
            };
          });
          if (!changed) return current;
          return sortTicketsByActivity(mapped);
        });
      } catch (_) {
        // noop
      } finally {
        delete previewFetchInFlightRef.current[ticketId];
      }
    })();

    previewFetchInFlightRef.current[ticketId] = task;
    await task;
  }, []);

  const loadTickets = useCallback(async (silent = false): Promise<Ticket[]> => {
    if (!session) return [];
    if (!silent) setTicketsLoading(true);

    try {
      const list = await listTickets({
        userType: session.userType,
        userId: session.userId,
        includeClosed,
      });
      const baseList = Array.isArray(list) ? list : [];
      const ordered = sortTicketsByActivity(baseList.map((ticket) => mergeTicketWithPreviewFallback(ticket)));
      const ticketIds = new Set(ordered.map((ticket) => Number(ticket.id)));
      let localUnreadChanged = false;
      const seenTicketIds = new Set<number>();

      for (const ticket of ordered) {
        const ticketId = Number(ticket.id || 0);
        if (!Number.isFinite(ticketId) || ticketId <= 0) continue;
        seenTicketIds.add(ticketId);

        const serverUnreadRaw = ticket.unread_count;
        const serverUnreadParsed = Number(serverUnreadRaw);
        const hasServerUnread = (
          serverUnreadRaw !== null
          && serverUnreadRaw !== undefined
          && Number.isFinite(serverUnreadParsed)
        );
        const serverUnread = hasServerUnread ? Math.max(0, Math.floor(serverUnreadParsed)) : 0;
        const updatedAtMs = parseSqliteTimestamp(ticketActivityAt(ticket));
        const previousUpdatedAtMs = Number(lastTicketUpdatedAtRef.current[ticketId] || 0);

        if (hasServerUnread && serverUnread > 0) {
          if (Number(localUnreadByTicketRef.current[ticketId] || 0) > 0) {
            localUnreadByTicketRef.current[ticketId] = 0;
            localUnreadChanged = true;
          }
          if (updatedAtMs > previousUpdatedAtMs) {
            lastTicketUpdatedAtRef.current[ticketId] = updatedAtMs;
          }
          continue;
        }

        if (!localUnreadInitializedRef.current || previousUpdatedAtMs <= 0) {
          lastTicketUpdatedAtRef.current[ticketId] = updatedAtMs;
          continue;
        }

        if (updatedAtMs > (previousUpdatedAtMs + 500)) {
          if (Number(selectedTicketIdRef.current || 0) !== ticketId) {
            localUnreadByTicketRef.current[ticketId] = Number(localUnreadByTicketRef.current[ticketId] || 0) + 1;
            localUnreadChanged = true;
          }
          lastTicketUpdatedAtRef.current[ticketId] = updatedAtMs;
          continue;
        }

        if (updatedAtMs > previousUpdatedAtMs) {
          lastTicketUpdatedAtRef.current[ticketId] = updatedAtMs;
        }
      }

      for (const rawId of Object.keys(previewFallbackByTicketRef.current)) {
        const ticketId = Number(rawId);
        if (!Number.isFinite(ticketId) || ticketIds.has(ticketId)) continue;
        delete previewFallbackByTicketRef.current[ticketId];
      }
      for (const rawId of Object.keys(localUnreadByTicketRef.current)) {
        const ticketId = Number(rawId);
        if (!Number.isFinite(ticketId) || seenTicketIds.has(ticketId)) continue;
        delete localUnreadByTicketRef.current[ticketId];
        localUnreadChanged = true;
      }
      for (const rawId of Object.keys(lastTicketUpdatedAtRef.current)) {
        const ticketId = Number(rawId);
        if (!Number.isFinite(ticketId) || seenTicketIds.has(ticketId)) continue;
        delete lastTicketUpdatedAtRef.current[ticketId];
      }
      if (!localUnreadInitializedRef.current) {
        localUnreadInitializedRef.current = true;
      }
      if (localUnreadChanged) {
        setLocalUnreadVersion((value) => value + 1);
      }
      setTickets((current) => (sameTicketSnapshot(current, ordered) ? current : ordered));
      setAvatars((prev) => {
        let next = prev;
        for (const ticket of ordered) {
          const key = phoneKey(ticket.phone);
          if (!key) continue;
          const resolved = resolveProfilePictureUrl(key, ticket.avatar_url || '');
          if (!resolved) continue;
          const current = String(next[key] || '').trim();
          if (current === resolved) continue;
          if (profilePictureScore(current) > profilePictureScore(resolved)) continue;
          if (next === prev) next = { ...prev };
          next[key] = resolved;
        }
        return next;
      });
      setSelectedTicketId((current) => {
        if (current && ordered.some((item) => Number(item.id) === Number(current))) return current;
        if (
          current
          && selectedTicketOverride
          && Number(selectedTicketOverride.id) === Number(current)
        ) {
          return current;
        }
        return ordered.length ? ordered[0].id : null;
      });
      setSelectedTicketOverride((current) => {
        if (!current) return current;
        if (ordered.some((item) => Number(item.id) === Number(current.id))) return null;
        return current;
      });
      return ordered;
    } catch (error) {
      if (!silent) {
        showToast('Falha ao carregar lista de conversas.', 'error');
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      }
      return [];
    } finally {
      if (!silent) setTicketsLoading(false);
    }
  }, [handleAuthExpired, includeClosed, mergeTicketWithPreviewFallback, selectedTicketOverride, session, showToast]);

  const markTicketAsRead = useCallback(async (ticketId: number, opts?: { force?: boolean }) => {
    const normalizedTicketId = Number(ticketId);
    if (!Number.isFinite(normalizedTicketId) || normalizedTicketId <= 0) return;
    if (!isPageVisible) return;

    const force = !!(opts && opts.force);
    const now = Date.now();
    const lastAt = Number(lastMarkReadAtRef.current[normalizedTicketId] || 0);
    if (!force && lastAt && (now - lastAt) < 1200) return;

    const inFlight = markReadInFlightRef.current[normalizedTicketId];
    if (inFlight) {
      await inFlight;
      return;
    }

    lastMarkReadAtRef.current[normalizedTicketId] = now;

    const task = (async () => {
      try {
        await markTicketReadByAgent(normalizedTicketId);
        if (Number(localUnreadByTicketRef.current[normalizedTicketId] || 0) > 0) {
          localUnreadByTicketRef.current[normalizedTicketId] = 0;
          setLocalUnreadVersion((value) => value + 1);
        }
        setTickets((current) => current.map((ticket) => {
          if (Number(ticket.id) !== normalizedTicketId) return ticket;
          if (Number(ticket.unread_count || 0) <= 0) return ticket;
          return { ...ticket, unread_count: 0 };
        }));
        setContactTickets((current) => current.map((ticket) => {
          if (Number(ticket.id) !== normalizedTicketId) return ticket;
          if (Number(ticket.unread_count || 0) <= 0) return ticket;
          return { ...ticket, unread_count: 0 };
        }));
        setSelectedTicketOverride((current) => {
          if (!current || Number(current.id) !== normalizedTicketId) return current;
          if (Number(current.unread_count || 0) <= 0) return current;
          return { ...current, unread_count: 0 };
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          handleAuthExpired();
        }
      } finally {
        delete markReadInFlightRef.current[normalizedTicketId];
      }
    })();

    markReadInFlightRef.current[normalizedTicketId] = task;
    await task;
  }, [handleAuthExpired, isPageVisible]);

  const loadMessages = useCallback(async (
    ticketId: number | null,
    opts?: { silent?: boolean }
  ) => {
    if (!ticketId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    const normalizedTicketId = Number(ticketId);
    const silent = !!(opts && opts.silent);
    const requestId = (latestMessagesRequestByTicketRef.current[normalizedTicketId] || 0) + 1;
    latestMessagesRequestByTicketRef.current[normalizedTicketId] = requestId;

    if (!silent) {
      const hasCache = Array.isArray(messagesByTicketRef.current[normalizedTicketId]);
      if (!hasCache) {
        setMessagesLoading(true);
      }
    }

    try {
      const list = await getTicketMessages(normalizedTicketId, 300);
      const ordered = sortMessagesChronologically(Array.isArray(list) ? list : []);
      messagesByTicketRef.current[normalizedTicketId] = ordered;

      const stillLatestRequest = requestId >= (latestMessagesRequestByTicketRef.current[normalizedTicketId] || 0);
      const stillSelectedTicket = Number(selectedTicketIdRef.current || 0) === normalizedTicketId;
      if (!stillLatestRequest || !stillSelectedTicket) return;

      setMessages((current) => (sameMessageSnapshot(current, ordered) ? current : ordered));
      setMessagesLoading(false);
      void markTicketAsRead(normalizedTicketId);
    } catch (error) {
      const stillSelectedTicket = Number(selectedTicketIdRef.current || 0) === normalizedTicketId;
      if (!silent && stillSelectedTicket) showToast('Falha ao carregar mensagens.', 'error');
      if (stillSelectedTicket) setMessagesLoading(false);
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      }
    } finally {
      const stillLatestRequest = requestId >= (latestMessagesRequestByTicketRef.current[normalizedTicketId] || 0);
      const stillSelectedTicket = Number(selectedTicketIdRef.current || 0) === normalizedTicketId;
      if (!silent && stillLatestRequest && stillSelectedTicket) {
        setMessagesLoading(false);
      }
    }
  }, [handleAuthExpired, markTicketAsRead, showToast]);

  const refreshAfterSend = useCallback(async (ticketId: number) => {
    await Promise.all([
      loadMessages(ticketId, { silent: true }),
      loadTickets(true),
      loadConnectionStatus(),
    ]);
  }, [loadConnectionStatus, loadMessages, loadTickets]);

  const handleSendText = useCallback(async (text: string) => {
    if (!activeTicket) return;
    await sendTextMessage(activeTicket.id, {
      message: text,
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
    });
    setReplyTo(null);
    await refreshAfterSend(activeTicket.id);
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleSendAudio = useCallback(async (blob: Blob, mimeType: string) => {
    if (!activeTicket) return;
    await sendAudioMessage(activeTicket.id, blob, mimeType, replyTo?.id);
    setReplyTo(null);
    await refreshAfterSend(activeTicket.id);
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleSendImage = useCallback(async (file: File, caption: string) => {
    if (!activeTicket) return;
    await sendImageMessage(activeTicket.id, file, {
      caption,
      replyToId: replyTo?.id,
    });
    setReplyTo(null);
    await refreshAfterSend(activeTicket.id);
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleStatusChange = useCallback(async (status: Ticket['status']) => {
    if (!activeTicket) return;
    if (isHistoricalTicket) return;
    if (isClosedTicket(activeTicket)) return;
    if (statusUpdating) return;
    if (activeTicket.status === status) return;

    try {
      setStatusUpdating(true);
      await updateTicketStatus(activeTicket.id, status);
      showToast(`Status atualizado para "${status}".`, 'success');
      await loadTickets();
      if (status === 'resolvido' || status === 'encerrado') {
        setReplyTo(null);
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        showToast(error.message || 'Falha ao atualizar status.', 'error');
      } else {
        showToast('Falha ao atualizar status.', 'error');
      }
    } finally {
      setStatusUpdating(false);
    }
  }, [activeTicket, isHistoricalTicket, loadTickets, showToast, statusUpdating]);

  const handleSellerChange = useCallback(async (sellerId: number | null) => {
    if (!activeTicket) return;
    if (isHistoricalTicket) return;
    if (isClosedTicket(activeTicket)) return;
    if (assigneeUpdating) return;
    const currentSellerId = activeTicket.seller_id != null ? Number(activeTicket.seller_id) : null;
    if (currentSellerId === sellerId) return;

    try {
      setAssigneeUpdating(true);
      await assignTicket(activeTicket.id, sellerId);
      showToast('Responsável atualizado com sucesso.', 'success');
      await loadTickets(true);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        showToast(error.message || 'Falha ao atribuir responsável.', 'error');
      } else {
        showToast('Falha ao atribuir responsável.', 'error');
      }
    } finally {
      setAssigneeUpdating(false);
    }
  }, [activeTicket, assigneeUpdating, isHistoricalTicket, loadTickets, showToast]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (_) {}
    clearAuthToken();
    router.replace('/login');
  }, [router]);

  const handleAvatarError = useCallback((rawPhone: string) => {
    const key = phoneKey(rawPhone);
    const normalized = normalizePhoneForApi(rawPhone);
    if (!key || !normalized) return;

    setAvatars((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    void refreshAvatarForPhone(rawPhone, { force: true, mapKey: key });
  }, [refreshAvatarForPhone]);

  const loadContactTicketHistory = useCallback(async (silent = true) => {
    if (!activeTicket) {
      setContactTickets([]);
      return;
    }

    if (!silent) setTicketHistoryLoading(true);
    try {
      const list = await listContactTickets(activeTicket.phone, 100);
      const safeList = Array.isArray(list) ? list : [];
      const byId = new Map<number, Ticket>();
      for (const item of safeList) {
        byId.set(Number(item.id), item);
      }
      if (!byId.has(Number(activeTicket.id))) {
        byId.set(Number(activeTicket.id), activeTicket);
      }

      const merged = sortTicketsByNewest(Array.from(byId.values()));
      setContactTickets((current) => (sameTicketSnapshot(current, merged) ? current : merged));

      if (!selectedTicketId) return;
      const selected = merged.find((item) => Number(item.id) === Number(selectedTicketId)) || null;
      if (!selected) return;

      const selectedExistsInList = tickets.some((item) => Number(item.id) === Number(selected.id));
      if (selectedExistsInList) {
        setSelectedTicketOverride(null);
        return;
      }

      setSelectedTicketOverride((current) => (sameTicketRecord(current, selected) ? current : selected));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      if (!silent) {
        showToast('Falha ao carregar histórico de tickets.', 'error');
      }
    } finally {
      if (!silent) setTicketHistoryLoading(false);
    }
  }, [activeTicket, handleAuthExpired, selectedTicketId, showToast, tickets]);

  const handleSelectHistoryTicket = useCallback((ticket: Ticket) => {
    setSelectedTicketId(ticket.id);
    const existsInList = tickets.some((item) => Number(item.id) === Number(ticket.id));
    setSelectedTicketOverride(existsInList ? null : ticket);
    setReplyTo(null);
    if (isMobileLayout) {
      setMobilePane('chat');
    }
  }, [isMobileLayout, tickets]);

  const focusReminderConversation = useCallback(async (reminder: DueTicketReminder) => {
    const ticketClosed = isClosedStatus(reminder.ticket_status);

    try {
      if (ticketClosed) {
        await updateTicketStatus(reminder.ticket_id, 'em_atendimento');
        pushToast('Conversa reaberta para o agendamento.', 'success');
      }

      const nextTickets = await loadTickets(true);
      const reminderPhone = phoneKey(reminder.phone);
      const targetTicket = nextTickets.find((item) => Number(item.id) === Number(reminder.ticket_id))
        || nextTickets.find((item) => reminderPhone && phoneKey(item.phone) === reminderPhone)
        || null;

      if (targetTicket) {
        setSelectedTicketId(targetTicket.id);
        setSelectedTicketOverride(null);
      } else {
        setSelectedTicketId(reminder.ticket_id);
        setSelectedTicketOverride(null);
      }
      if (isMobileLayout) {
        setMobilePane('chat');
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      if (error instanceof ApiRequestError) {
        pushToast(error.message || 'Não foi possível abrir o agendamento.', 'error');
        return;
      }
      pushToast('Não foi possível abrir o agendamento.', 'error');
    }
  }, [handleAuthExpired, isMobileLayout, loadTickets, pushToast]);

  const loadDueReminders = useCallback(async () => {
    if (!session || !isPageVisible) return;

    try {
      const dueReminders = await listDueReminders();
      if (!Array.isArray(dueReminders) || !dueReminders.length) return;

      for (const reminder of dueReminders) {
        const reminderId = Number(reminder && reminder.id);
        if (!Number.isFinite(reminderId) || reminderId <= 0) continue;
        if (remindedIdsRef.current[reminderId]) continue;
        remindedIdsRef.current[reminderId] = true;

        const closedConversation = isClosedStatus(reminder.ticket_status);
        pushToast(
          buildReminderToastMessage(reminder),
          'warning',
          12000,
          {
            actionLabel: closedConversation ? 'Reabrir conversa' : 'Abrir conversa',
            onAction: () => {
              void focusReminderConversation(reminder);
            },
          }
        );
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      }
    }
  }, [focusReminderConversation, handleAuthExpired, isPageVisible, pushToast, session]);

  const switchQuickMessagesToLocalMode = useCallback((notify: boolean) => {
    quickMessagesModeRef.current = 'local';
    quickMessagesRouteMissingRef.current = true;
    const localRows = sortQuickMessagesByNewest(readLocalQuickMessages(session));
    setQuickMessages((current) => (sameQuickMessageSnapshot(current, localRows) ? current : localRows));

    if (notify && !quickMessagesFallbackWarnedRef.current) {
      quickMessagesFallbackWarnedRef.current = true;
      showToast('Mensagens rápidas foram ativadas no modo local neste frontend.', 'warning');
    }
  }, [session, showToast]);

  const createQuickMessageLocal = useCallback(async (
    payload: { title: string; content: string; shortcut?: string | null }
  ) => {
    if (!session) throw new Error('Sessão indisponível.');

    const title = String(payload.title || '').trim();
    const content = String(payload.content || '').trim();
    const shortcut = normalizeQuickShortcutValue(payload.shortcut);
    if (!title || !content) {
      showToast('Título e mensagem são obrigatórios.', 'error');
      throw new Error('Invalid payload');
    }

    if (shortcut) {
      const conflict = quickMessages.some((item) => normalizeQuickShortcutValue(item.shortcut) === shortcut);
      if (conflict) {
        showToast('Já existe uma mensagem rápida com esse atalho.', 'error');
        throw new Error('Shortcut conflict');
      }
    }

    const nowIso = new Date().toISOString();
    let nextId = Date.now();
    for (const item of quickMessages) {
      const id = Number(item.id || 0);
      if (id >= nextId) nextId = id + 1;
    }

    const created: QuickMessage = {
      id: nextId,
      user_id: session.userId,
      user_type: session.userType,
      shortcut,
      title,
      content,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const nextRows = sortQuickMessagesByNewest([created, ...quickMessages.filter((item) => Number(item.id) !== Number(created.id))]);
    writeLocalQuickMessages(session, nextRows);
    setQuickMessages(nextRows);
    showToast('Mensagem rápida criada.', 'success');
  }, [quickMessages, session, showToast]);

  const updateQuickMessageLocal = useCallback(async (
    quickMessageId: number,
    payload: { title?: string; content?: string; shortcut?: string | null }
  ) => {
    if (!session) throw new Error('Sessão indisponível.');

    const current = quickMessages.find((item) => Number(item.id) === Number(quickMessageId));
    if (!current) {
      showToast('Mensagem rápida não encontrada.', 'error');
      throw new Error('Quick message not found');
    }

    const nextTitle = Object.prototype.hasOwnProperty.call(payload, 'title')
      ? String(payload.title || '').trim()
      : String(current.title || '').trim();
    const nextContent = Object.prototype.hasOwnProperty.call(payload, 'content')
      ? String(payload.content || '').trim()
      : String(current.content || '').trim();
    const nextShortcut = Object.prototype.hasOwnProperty.call(payload, 'shortcut')
      ? normalizeQuickShortcutValue(payload.shortcut)
      : normalizeQuickShortcutValue(current.shortcut);

    if (!nextTitle || !nextContent) {
      showToast('Título e mensagem são obrigatórios.', 'error');
      throw new Error('Invalid payload');
    }

    if (nextShortcut) {
      const conflict = quickMessages.some((item) => (
        Number(item.id) !== Number(quickMessageId)
        && normalizeQuickShortcutValue(item.shortcut) === nextShortcut
      ));
      if (conflict) {
        showToast('Já existe uma mensagem rápida com esse atalho.', 'error');
        throw new Error('Shortcut conflict');
      }
    }

    const nowIso = new Date().toISOString();
    const nextRows = sortQuickMessagesByNewest(
      quickMessages.map((item) => {
        if (Number(item.id) !== Number(quickMessageId)) return item;
        return {
          ...item,
          title: nextTitle,
          content: nextContent,
          shortcut: nextShortcut,
          updated_at: nowIso,
        };
      })
    );

    writeLocalQuickMessages(session, nextRows);
    setQuickMessages(nextRows);
    showToast('Mensagem rápida atualizada.', 'success');
  }, [quickMessages, session, showToast]);

  const deleteQuickMessageLocal = useCallback(async (quickMessageId: number) => {
    if (!session) throw new Error('Sessão indisponível.');

    const exists = quickMessages.some((item) => Number(item.id) === Number(quickMessageId));
    if (!exists) {
      showToast('Mensagem rápida não encontrada.', 'error');
      throw new Error('Quick message not found');
    }

    const nextRows = quickMessages.filter((item) => Number(item.id) !== Number(quickMessageId));
    writeLocalQuickMessages(session, nextRows);
    setQuickMessages(nextRows);
    showToast('Mensagem rápida removida.', 'success');
  }, [quickMessages, session, showToast]);

  const loadQuickMessageLibrary = useCallback(async (silent = true) => {
    if (!session) return;

    if (!silent) setQuickMessagesLoading(true);
    try {
      const rows = await listQuickMessages();
      const normalized = sortQuickMessagesByNewest(Array.isArray(rows) ? rows : []);
      setQuickMessages((current) => (sameQuickMessageSnapshot(current, normalized) ? current : normalized));
      quickMessagesModeRef.current = 'remote';
      quickMessagesRouteMissingRef.current = false;
      quickMessagesFallbackWarnedRef.current = false;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        switchQuickMessagesToLocalMode(!silent);
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      if (!silent) {
        showToast(getSafeApiMessage(error, 'Falha ao carregar mensagens rápidas.'), 'error');
      }
    } finally {
      if (!silent) setQuickMessagesLoading(false);
    }
  }, [handleAuthExpired, session, showToast, switchQuickMessagesToLocalMode]);

  const handleCreateQuickMessage = useCallback(async (payload: { title: string; content: string; shortcut?: string | null }) => {
    if (quickMessagesModeRef.current === 'local' || quickMessagesRouteMissingRef.current) {
      await createQuickMessageLocal(payload);
      return;
    }

    try {
      const created = await createQuickMessage(payload);
      setQuickMessages((current) => sortQuickMessagesByNewest([created, ...current.filter((item) => Number(item.id) !== Number(created.id))]));
      showToast('Mensagem rápida criada.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        switchQuickMessagesToLocalMode(true);
        await createQuickMessageLocal(payload);
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao criar mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [createQuickMessageLocal, handleAuthExpired, showToast, switchQuickMessagesToLocalMode]);

  const handleUpdateQuickMessage = useCallback(async (
    quickMessageId: number,
    payload: { title?: string; content?: string; shortcut?: string | null }
  ) => {
    if (quickMessagesModeRef.current === 'local' || quickMessagesRouteMissingRef.current) {
      await updateQuickMessageLocal(quickMessageId, payload);
      return;
    }

    try {
      const updated = await updateQuickMessage(quickMessageId, payload);
      setQuickMessages((current) => sortQuickMessagesByNewest(current.map((item) => (
        Number(item.id) === Number(updated.id) ? updated : item
      ))));
      showToast('Mensagem rápida atualizada.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        switchQuickMessagesToLocalMode(true);
        await updateQuickMessageLocal(quickMessageId, payload);
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao atualizar mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [handleAuthExpired, showToast, switchQuickMessagesToLocalMode, updateQuickMessageLocal]);

  const handleDeleteQuickMessage = useCallback(async (quickMessageId: number) => {
    if (quickMessagesModeRef.current === 'local' || quickMessagesRouteMissingRef.current) {
      await deleteQuickMessageLocal(quickMessageId);
      return;
    }

    try {
      await deleteQuickMessage(quickMessageId);
      setQuickMessages((current) => current.filter((item) => Number(item.id) !== Number(quickMessageId)));
      showToast('Mensagem rápida removida.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        switchQuickMessagesToLocalMode(true);
        await deleteQuickMessageLocal(quickMessageId);
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao remover mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [deleteQuickMessageLocal, handleAuthExpired, showToast, switchQuickMessagesToLocalMode]);

  useEffect(() => {
    if (!queryIncludeClosed) return;
    setIncludeClosed(true);
  }, [queryIncludeClosed]);

  useEffect(() => {
    if (!queryTicketId || deepLinkHandledRef.current) return;
    if (!session) return;

    const applyTarget = (targetTicket: Ticket, useOverride: boolean) => {
      setSelectedTicketId(targetTicket.id);
      setSelectedTicketOverride(useOverride ? targetTicket : null);
      setReplyTo(null);
      if (isMobileLayout) {
        setMobilePane('chat');
      }
      deepLinkHandledRef.current = true;
      router.replace('/agent');
    };

    const inMemory = tickets.find((item) => Number(item.id) === Number(queryTicketId));
    if (inMemory) {
      applyTarget(inMemory, false);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const fetched = await getTicketById(queryTicketId);
        if (!active || !fetched || Number(fetched.id) !== Number(queryTicketId)) return;
        applyTarget(fetched, true);
      } catch (_) {
        // Se não existir, mantém lista atual sem quebrar navegação.
      }
    })();

    return () => {
      active = false;
    };
  }, [isMobileLayout, queryTicketId, router, session, tickets]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    void loadConnectionStatus();
    void loadTickets();
    void loadAssignees();
    void loadDueReminders();
    void loadQuickMessageLibrary(false);
  }, [session, includeClosed, loadAssignees, loadConnectionStatus, loadDueReminders, loadQuickMessageLibrary, loadTickets]);

  useEffect(() => {
    if (!activeTicket) {
      setContactTickets([]);
      return;
    }
    void loadContactTicketHistory(false);
  }, [activeTicket?.id, loadContactTicketHistory]);

  useEffect(() => {
    if (!session || !isPageVisible || !tickets.length) return;
    for (const ticket of tickets) {
      const key = phoneKey(ticket.phone);
      if (!key) continue;
      const currentAvatar = String(avatars[key] || resolveProfilePictureUrl(key, ticket.avatar_url || '') || '').trim();
      if (!currentAvatar || isProfilePictureLookupUrl(currentAvatar)) {
        if (isProfilePictureLookupUrl(currentAvatar)) {
          setAvatars((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
        void refreshAvatarForPhone(ticket.phone, { mapKey: key });
      }
    }
  }, [avatars, isPageVisible, refreshAvatarForPhone, session, tickets]);

  useEffect(() => {
    if (!session || !tickets.length) return;
    let active = true;

    void (async () => {
      const missingPreview = tickets.filter((ticket) => !hasTicketPreviewData(ticket)).slice(0, 80);
      for (const ticket of missingPreview) {
        if (!active) break;
        await loadPreviewFallbackForTicket(ticket);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadPreviewFallbackForTicket, session, tickets]);

  const queueRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimeoutRef.current) return;
    realtimeRefreshTimeoutRef.current = setTimeout(() => {
      realtimeRefreshTimeoutRef.current = null;
      void loadTickets(true);
    }, 120);
  }, [loadTickets]);

  useEffect(() => {
    if (!session) return;

    const wsUrls = resolveRealtimeSocketUrls();
    if (!wsUrls.length) return;

    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1200);
    };

    const handleRealtimeMessage = (raw: string) => {
      let parsed: { type?: string } | null = null;
      try {
        parsed = JSON.parse(String(raw || '')) as { type?: string };
      } catch (_) {
        parsed = null;
      }
      if (!parsed || !parsed.type) return;
      if (parsed.type !== 'message' && parsed.type !== 'ticket') return;
      queueRealtimeRefresh();
    };

    const connect = () => {
      if (!active) return;

      const wsUrl = wsUrls[attempt % wsUrls.length];
      attempt += 1;

      try {
        ws = new WebSocket(wsUrl);
      } catch (_) {
        scheduleReconnect();
        return;
      }

      ws.onmessage = (event) => {
        if (!active) return;
        handleRealtimeMessage(String((event && event.data) || ''));
      };

      ws.onerror = () => {
        // noop
      };

      ws.onclose = () => {
        if (!active) return;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (realtimeRefreshTimeoutRef.current) {
        clearTimeout(realtimeRefreshTimeoutRef.current);
        realtimeRefreshTimeoutRef.current = null;
      }
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
    };
  }, [queueRealtimeRefresh, session]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 980px)');
    const apply = () => setIsMobileLayout(media.matches);
    apply();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }

    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setIsPageVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicketId;
  }, [selectedTicketId]);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobilePane('chat');
      return;
    }
    if (!selectedTicketId) {
      setMobilePane('list');
    }
  }, [isMobileLayout, selectedTicketId]);

  useEffect(() => {
    setReplyTo(null);

    if (!selectedTicketId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    const ticketId = Number(selectedTicketId);
    const cached = messagesByTicketRef.current[ticketId];
    if (Array.isArray(cached)) {
      setMessages((current) => (sameMessageSnapshot(current, cached) ? current : cached));
      setMessagesLoading(false);
      void markTicketAsRead(ticketId, { force: true });
      void loadMessages(ticketId, { silent: true });
      return;
    }

    setMessages([]);
    setMessagesLoading(true);
    void loadMessages(ticketId, { silent: false });
  }, [selectedTicketId, loadMessages, markTicketAsRead]);

  useInterval(() => {
    if (!session || !isPageVisible) return;
    void loadConnectionStatus();
  }, session && isPageVisible ? 25000 : null);

  useInterval(() => {
    if (!session || !isPageVisible) return;
    void loadTickets(true);
  }, session && isPageVisible ? 1200 : null);

  useInterval(() => {
    if (!session || !selectedTicketId || !isPageVisible) return;
    void loadMessages(selectedTicketId, { silent: true });
  }, session && selectedTicketId && isPageVisible ? 3200 : null);

  useInterval(() => {
    if (!session || !isPageVisible || !activeTicket) return;
    void loadContactTicketHistory(true);
  }, session && isPageVisible && activeTicket ? 8000 : null);

  useInterval(() => {
    if (!session || !isPageVisible) return;
    void loadDueReminders();
  }, session && isPageVisible ? 15000 : null);

  const handleSelectTicket = useCallback((ticketId: number) => {
    if (Number(localUnreadByTicketRef.current[ticketId] || 0) > 0) {
      localUnreadByTicketRef.current[ticketId] = 0;
      setLocalUnreadVersion((value) => value + 1);
    }
    setSelectedTicketId(ticketId);
    setSelectedTicketOverride(null);
    if (isMobileLayout) {
      setMobilePane('chat');
    }
  }, [isMobileLayout]);

  const pageClassName = useMemo(() => {
    const classes = [styles.page, 'route-enter'];
    if (isMobileLayout) {
      classes.push(styles.pageMobile);
      classes.push(mobilePane === 'chat' ? styles.pageMobileChat : styles.pageMobileList);
    }
    return classes.join(' ');
  }, [isMobileLayout, mobilePane]);

  if (sessionLoading) {
    return <div className={styles.loadingWrap}>Carregando sessão...</div>;
  }

  if (!session) {
    return <div className={styles.loadingWrap}>Redirecionando para login...</div>;
  }

  const ticketInteractionLocked = !!activeTicket && (isClosedTicket(activeTicket) || isHistoricalTicket);
  const composerDisabled = !activeTicket || !connectionOnline || ticketInteractionLocked;

  return (
    <>
      <main className={pageClassName}>
        <TicketList
          tickets={tickets}
          selectedTicketId={selectedTicketId}
          includeClosed={includeClosed}
          loading={ticketsLoading}
          isConnected={connectionOnline}
          avatars={avatars}
          localUnreadByTicket={unreadByTicketSnapshot}
          userName={session.userName}
          isAdmin={session.userType === 'admin'}
          onToggleClosed={setIncludeClosed}
          onSelect={handleSelectTicket}
          onOpenAdmin={() => router.push('/admin-sellers')}
          onLogout={handleLogout}
          onAvatarError={handleAvatarError}
        />

        <section className={styles.chatPanel}>
          <ChatHeader
            ticket={activeTicket}
            avatarUrl={activeTicket ? (avatars[phoneKey(activeTicket.phone)] || null) : null}
            assignees={assignees}
            statusUpdating={statusUpdating || isHistoricalTicket}
            assigneeUpdating={assigneeUpdating || isHistoricalTicket}
            onStatusChange={handleStatusChange}
            onSellerChange={handleSellerChange}
            onAvatarError={handleAvatarError}
            ticketNumberLabel={activeTicket ? `#${activeTicket.id}` : null}
            historyControl={(
              <TicketHistory
                ticket={activeTicket}
                historyTickets={sortedContactTickets}
                loading={ticketHistoryLoading}
                onSelectTicket={handleSelectHistoryTicket}
              />
            )}
            reminderControl={(
              <TicketReminders
                ticketId={activeTicket ? activeTicket.id : null}
                disabled={composerDisabled}
                onToast={showToast}
                onAuthExpired={handleAuthExpired}
              />
            )}
            showBackButton={isMobileLayout}
            onBack={() => setMobilePane('list')}
          />
          <MessageList
            ticketSelected={!!activeTicket}
            messages={messages}
            loading={messagesLoading}
            onReply={(message) => {
              if (isHistoricalTicket) return;
              setReplyTo(message);
            }}
          />
          {isHistoricalTicket ? (
            <div className={styles.historicalReadOnlyHint}>
              Ticket antigo em modo leitura. Use o ticket mais recente para responder.
            </div>
          ) : null}
          <MessageComposer
            disabled={composerDisabled || messagesLoading}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSendText={handleSendText}
            onSendImage={handleSendImage}
            onSendAudio={handleSendAudio}
            quickMessages={quickMessages}
            quickMessagesLoading={quickMessagesLoading}
            onCreateQuickMessage={handleCreateQuickMessage}
            onUpdateQuickMessage={handleUpdateQuickMessage}
            onDeleteQuickMessage={handleDeleteQuickMessage}
            onToast={showToast}
          />
        </section>
      </main>

      <ToastViewport toasts={toasts} />
    </>
  );
}
