'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignTicket,
  fetchProfilePicture,
  getAuthSession,
  getConnectionStatus,
  getTicketMessages,
  listAssignees,
  listTickets,
  logout,
  sendAudioMessage,
  sendImageMessage,
  sendTextMessage,
  updateTicketStatus,
} from '@/src/frontend/lib/chatApi';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { clearAuthToken, resolveMediaUrl } from '@/src/frontend/lib/runtime';
import { useInterval } from '@/src/frontend/hooks/useInterval';
import { useToast } from '@/src/frontend/hooks/useToast';
import type { ToastType } from '@/src/frontend/hooks/useToast';
import { ChatHeader } from '@/src/frontend/components/chat/ChatHeader';
import { MessageComposer } from '@/src/frontend/components/chat/MessageComposer';
import { MessageList } from '@/src/frontend/components/chat/MessageList';
import { TicketList } from '@/src/frontend/components/chat/TicketList';
import { ToastViewport } from '@/src/frontend/components/chat/ToastViewport';
import type { Assignee, AuthSession, ChatMessage, Ticket } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

function isClosedTicket(ticket: Ticket | null): boolean {
  if (!ticket) return true;
  return ticket.status === 'resolvido' || ticket.status === 'encerrado';
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assigneeUpdating, setAssigneeUpdating] = useState(false);

  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list');

  const activeTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [selectedTicketId, tickets]
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

  const loadTickets = useCallback(async (silent = false) => {
    if (!session) return;
    if (!silent) setTicketsLoading(true);

    try {
      const list = await listTickets({
        userType: session.userType,
        userId: session.userId,
        includeClosed,
      });
      setTickets(list);
      setSelectedTicketId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        return list.length ? list[0].id : null;
      });
    } catch (error) {
      if (!silent) {
        showToast('Falha ao carregar lista de conversas.', 'error');
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      }
    } finally {
      if (!silent) setTicketsLoading(false);
    }
  }, [handleAuthExpired, includeClosed, session, showToast]);

  const loadMessages = useCallback(async (silent = false) => {
    if (!selectedTicketId) {
      setMessages([]);
      return;
    }

    if (!silent) setMessagesLoading(true);
    try {
      const list = await getTicketMessages(selectedTicketId, 300);
      setMessages(list);
    } catch (error) {
      if (!silent) showToast('Falha ao carregar mensagens.', 'error');
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
      }
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, [handleAuthExpired, selectedTicketId, showToast]);

  const refreshAfterSend = useCallback(async () => {
    await Promise.all([
      loadMessages(true),
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
    await refreshAfterSend();
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleSendAudio = useCallback(async (blob: Blob, mimeType: string) => {
    if (!activeTicket) return;
    await sendAudioMessage(activeTicket.id, blob, mimeType, replyTo?.id);
    setReplyTo(null);
    await refreshAfterSend();
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleSendImage = useCallback(async (file: File, caption: string) => {
    if (!activeTicket) return;
    await sendImageMessage(activeTicket.id, file, {
      caption,
      replyToId: replyTo?.id,
    });
    setReplyTo(null);
    await refreshAfterSend();
  }, [activeTicket, refreshAfterSend, replyTo]);

  const handleStatusChange = useCallback(async (status: Ticket['status']) => {
    if (!activeTicket) return;
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
  }, [activeTicket, loadTickets, showToast, statusUpdating]);

  const handleSellerChange = useCallback(async (sellerId: number | null) => {
    if (!activeTicket) return;
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
  }, [activeTicket, assigneeUpdating, loadTickets, showToast]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (_) {}
    clearAuthToken();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    void loadConnectionStatus();
    void loadTickets();
    void loadAssignees();
  }, [session, includeClosed, loadAssignees, loadConnectionStatus, loadTickets]);

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
    void loadMessages();
  }, [selectedTicketId, loadMessages]);

  useInterval(() => {
    if (!session) return;
    void loadConnectionStatus();
  }, session ? 20000 : null);

  useInterval(() => {
    if (!session) return;
    void loadTickets(true);
  }, session ? 4500 : null);

  useInterval(() => {
    if (!session || !selectedTicketId) return;
    void loadMessages(true);
  }, session && selectedTicketId ? 2200 : null);

  const phonesWithoutAvatar = useMemo(() => {
    const pending: string[] = [];
    for (const ticket of tickets) {
      const phone = String(ticket.phone || '').trim();
      if (!phone) continue;
      if (avatars[phone]) continue;
      pending.push(phone);
    }
    return pending;
  }, [avatars, tickets]);

  useEffect(() => {
    let canceled = false;
    if (!phonesWithoutAvatar.length) return () => { canceled = true; };

    (async () => {
      for (const phone of phonesWithoutAvatar) {
        try {
          const response = await fetchProfilePicture(phone);
          const raw = String(response.url || '').trim();
          if (!raw || canceled) continue;
          const resolved = resolveMediaUrl(raw);
          setAvatars((prev) => (prev[phone] ? prev : { ...prev, [phone]: resolved }));
        } catch (_) {}
      }
    })();

    return () => {
      canceled = true;
    };
  }, [phonesWithoutAvatar]);

  const handleSelectTicket = useCallback((ticketId: number) => {
    setSelectedTicketId(ticketId);
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

  const composerDisabled = !activeTicket || !connectionOnline || isClosedTicket(activeTicket);

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
        />

        <section className={styles.chatPanel}>
          <ChatHeader
            ticket={activeTicket}
            avatarUrl={activeTicket ? avatars[activeTicket.phone] || null : null}
            assignees={assignees}
            statusUpdating={statusUpdating}
            assigneeUpdating={assigneeUpdating}
            onStatusChange={handleStatusChange}
            onSellerChange={handleSellerChange}
            showBackButton={isMobileLayout}
            onBack={() => setMobilePane('list')}
          />
          <MessageList
            ticketSelected={!!activeTicket}
            messages={messages}
            onReply={setReplyTo}
          />
          {messagesLoading ? null : (
            <MessageComposer
              disabled={composerDisabled}
              replyTo={replyTo}
              onClearReply={() => setReplyTo(null)}
              onSendText={handleSendText}
              onSendImage={handleSendImage}
              onSendAudio={handleSendAudio}
              onToast={showToast}
            />
          )}
        </section>
      </main>

      <ToastViewport toasts={toasts} />
    </>
  );
}
