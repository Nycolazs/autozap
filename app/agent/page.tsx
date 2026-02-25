'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignTicket,
  createQuickMessage,
  deleteQuickMessage,
  fetchProfilePicture,
  getAuthSession,
  getConnectionStatus,
  getTicketMessages,
  listContactTickets,
  listDueReminders,
  listQuickMessages,
  listAssignees,
  listTickets,
  logout,
  sendAudioMessage,
  sendImageMessage,
  sendTextMessage,
  updateQuickMessage,
  updateTicketStatus,
} from '@/src/frontend/lib/chatApi';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { clearAuthToken, resolveProfilePictureUrl } from '@/src/frontend/lib/runtime';
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

function getSafeApiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    const message = String(error.message || '').trim();
    return message || fallback;
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

export default function AgentPage() {
  const router = useRouter();
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
  const remindedIdsRef = useRef<Record<number, true>>({});
  const selectedTicketIdRef = useRef<number | null>(null);
  const messagesByTicketRef = useRef<Record<number, ChatMessage[]>>({});
  const latestMessagesRequestByTicketRef = useRef<Record<number, number>>({});

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

  const loadTickets = useCallback(async (silent = false): Promise<Ticket[]> => {
    if (!session) return [];
    if (!silent) setTicketsLoading(true);

    try {
      const list = await listTickets({
        userType: session.userType,
        userId: session.userId,
        includeClosed,
      });
      setTickets((current) => (sameTicketSnapshot(current, list) ? current : list));
      setAvatars((prev) => {
        let next = prev;
        for (const ticket of list) {
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
        if (current && list.some((item) => Number(item.id) === Number(current))) return current;
        if (
          current
          && selectedTicketOverride
          && Number(selectedTicketOverride.id) === Number(current)
        ) {
          return current;
        }
        return list.length ? list[0].id : null;
      });
      setSelectedTicketOverride((current) => {
        if (!current) return current;
        if (list.some((item) => Number(item.id) === Number(current.id))) return null;
        return current;
      });
      return list;
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
  }, [handleAuthExpired, includeClosed, selectedTicketOverride, session, showToast]);

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
      messagesByTicketRef.current[normalizedTicketId] = list;

      const stillLatestRequest = requestId >= (latestMessagesRequestByTicketRef.current[normalizedTicketId] || 0);
      const stillSelectedTicket = Number(selectedTicketIdRef.current || 0) === normalizedTicketId;
      if (!stillLatestRequest || !stillSelectedTicket) return;

      setMessages((current) => (sameMessageSnapshot(current, list) ? current : list));
      setMessagesLoading(false);
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
  }, [handleAuthExpired, showToast]);

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

  const loadQuickMessageLibrary = useCallback(async (silent = true) => {
    if (!session) return;

    if (!silent) setQuickMessagesLoading(true);
    try {
      const rows = await listQuickMessages();
      const normalized = sortQuickMessagesByNewest(Array.isArray(rows) ? rows : []);
      setQuickMessages((current) => (sameQuickMessageSnapshot(current, normalized) ? current : normalized));
    } catch (error) {
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
  }, [handleAuthExpired, session, showToast]);

  const handleCreateQuickMessage = useCallback(async (payload: { title: string; content: string; shortcut?: string | null }) => {
    try {
      const created = await createQuickMessage(payload);
      setQuickMessages((current) => sortQuickMessagesByNewest([created, ...current.filter((item) => Number(item.id) !== Number(created.id))]));
      showToast('Mensagem rápida criada.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao criar mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [handleAuthExpired, showToast]);

  const handleUpdateQuickMessage = useCallback(async (
    quickMessageId: number,
    payload: { title?: string; content?: string; shortcut?: string | null }
  ) => {
    try {
      const updated = await updateQuickMessage(quickMessageId, payload);
      setQuickMessages((current) => sortQuickMessagesByNewest(current.map((item) => (
        Number(item.id) === Number(updated.id) ? updated : item
      ))));
      showToast('Mensagem rápida atualizada.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao atualizar mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [handleAuthExpired, showToast]);

  const handleDeleteQuickMessage = useCallback(async (quickMessageId: number) => {
    try {
      await deleteQuickMessage(quickMessageId);
      setQuickMessages((current) => current.filter((item) => Number(item.id) !== Number(quickMessageId)));
      showToast('Mensagem rápida removida.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      } else {
        showToast(getSafeApiMessage(error, 'Falha ao remover mensagem rápida.'), 'error');
      }
      throw error;
    }
  }, [handleAuthExpired, showToast]);

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
      void loadMessages(ticketId, { silent: true });
      return;
    }

    setMessages([]);
    setMessagesLoading(true);
    void loadMessages(ticketId, { silent: false });
  }, [selectedTicketId, loadMessages]);

  useInterval(() => {
    if (!session || !isPageVisible) return;
    void loadConnectionStatus();
  }, session && isPageVisible ? 25000 : null);

  useInterval(() => {
    if (!session || !isPageVisible) return;
    void loadTickets(true);
  }, session && isPageVisible ? 6500 : null);

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
