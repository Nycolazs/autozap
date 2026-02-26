import { useEffect, useState } from 'react';
import { formatDate, formatTime, resolveProfilePictureUrl } from '@/src/frontend/lib/runtime';
import { ThemeToggle } from '@/src/frontend/components/system/ThemeToggle';
import type { Ticket } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

type TicketListProps = {
  tickets: Ticket[];
  selectedTicketId: number | null;
  includeClosed: boolean;
  loading: boolean;
  isConnected: boolean;
  avatars: Record<string, string>;
  localUnreadByTicket?: Record<number, number>;
  userName: string;
  isAdmin: boolean;
  onToggleClosed: (value: boolean) => void;
  onSelect: (ticketId: number) => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onAvatarError?: (phone: string) => void;
};

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em Atendimento';
  if (status === 'encerrado') return 'Encerrado';
  return 'Resolvido';
}

function statusClass(status: Ticket['status']): string {
  if (status === 'pendente') return styles.statusPendente;
  if (status === 'aguardando') return styles.statusAguardando;
  if (status === 'em_atendimento') return styles.statusEmAtendimento;
  if (status === 'encerrado') return styles.statusEncerrado;
  return styles.statusResolvido;
}

function displayName(ticket: Ticket): string {
  const contact = String(ticket.contact_name || '').trim();
  if (contact) return contact;
  return 'Cliente';
}

function avatarInitials(ticket: Ticket): string {
  const name = displayName(ticket);
  const tokens = name
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (!tokens.length) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0].charAt(0)}${tokens[1].charAt(0)}`.toUpperCase();
}

function unreadLabel(ticket: Ticket, localUnreadByTicket?: Record<number, number>): string | null {
  const serverUnread = Number(ticket.unread_count || 0);
  const localUnread = Number(localUnreadByTicket && localUnreadByTicket[Number(ticket.id)] || 0);
  const unread = Math.max(
    Number.isFinite(serverUnread) ? Math.floor(serverUnread) : 0,
    Number.isFinite(localUnread) ? Math.floor(localUnread) : 0
  );
  if (!Number.isFinite(unread) || unread <= 0) return null;
  if (unread > 99) return '99+';
  return String(unread);
}

function normalizeMessageType(type: unknown): string {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return 'text';
  if (normalized === 'image') return 'image';
  if (normalized === 'audio') return 'audio';
  if (normalized === 'video') return 'video';
  if (normalized === 'sticker') return 'sticker';
  if (normalized === 'document') return 'document';
  if (normalized === 'system') return 'system';
  return 'text';
}

function mediaTypeLabel(type: string): string {
  if (type === 'image') return 'Imagem';
  if (type === 'audio') return 'Áudio';
  if (type === 'video') return 'Vídeo';
  if (type === 'sticker') return 'Figurinha';
  if (type === 'document') return 'Documento';
  if (type === 'system') return 'Atualização';
  return '';
}

function previewLabel(ticket: Ticket): string {
  const type = normalizeMessageType(ticket.last_message_type);
  const rawContent = String(ticket.last_message_content || '').replace(/\s+/g, ' ').trim();
  const sender = String(ticket.last_message_sender || '').trim().toLowerCase();
  const hasLastMessageData = Boolean(
    String(ticket.last_message_at || '').trim()
    || rawContent
    || String(ticket.last_message_type || '').trim()
  );

  let preview = rawContent;
  if (!preview) {
    preview = mediaTypeLabel(type);
  } else if (type !== 'text') {
    const mediaLabel = mediaTypeLabel(type);
    if (mediaLabel) preview = `${mediaLabel}: ${preview}`;
  }

  if (!preview) return hasLastMessageData ? 'Sem mensagens' : '';
  if (sender === 'agent') return `Você: ${preview}`;
  return preview;
}

export function TicketList({
  tickets,
  selectedTicketId,
  includeClosed,
  loading,
  isConnected,
  avatars,
  localUnreadByTicket,
  userName,
  isAdmin,
  onToggleClosed,
  onSelect,
  onOpenAdmin,
  onLogout,
  onAvatarError,
}: TicketListProps) {
  const [failedAvatarByKey, setFailedAvatarByKey] = useState<Record<string, true>>({});
  const openCount = tickets.filter((ticket) => ticket.status !== 'encerrado' && ticket.status !== 'resolvido').length;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFailedAvatarByKey({});
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setFailedAvatarByKey({});
  }, [avatars]);

  return (
    <aside className={styles.sidebar}>
      <header className={styles.sidebarHeader}>
        <div className={styles.sidebarTitle}>
          <span>AutoZap</span>
          <button type="button" className={styles.logoutButton} onClick={onLogout}>
            Sair
          </button>
        </div>
        <div className={styles.sidebarSubtitle}>
          Conversas ativas: {openCount} • Logado como {userName}
        </div>
        <div className={styles.sidebarConnectionRow}>
          <span
            className={`${styles.connectionBadge} ${isConnected ? styles.connected : styles.disconnected}`}
          >
            {isConnected ? 'WhatsApp online' : 'WhatsApp offline'}
          </span>
        </div>
        <div className={styles.sidebarControls}>
          <label className={styles.switchLabel} aria-label="Mostrar encerrados">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => onToggleClosed(event.target.checked)}
              className={styles.switchInput}
            />
            <span className={styles.switchControl} aria-hidden="true" />
            <span className={styles.switchText}>Mostrar encerrados</span>
          </label>
          <div className={styles.sidebarControlRight}>
            <ThemeToggle compact />
            {isAdmin ? (
              <button type="button" className={styles.adminButton} onClick={onOpenAdmin}>
                Painel admin
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className={styles.ticketList}>
        {loading && !tickets.length && (
          <div className={styles.emptyChat}>Carregando conversas...</div>
        )}
        {!loading && !tickets.length && (
          <div className={styles.emptyChat}>Nenhuma conversa disponível no momento.</div>
        )}
        {tickets.map((ticket) => {
          const isSelected = ticket.id === selectedTicketId;
          const phone = String(ticket.phone || '').trim();
          const avatarUrl = avatars[phone] || resolveProfilePictureUrl(phone, ticket.avatar_url || '');
          const avatarKey = `${ticket.id}:${avatarUrl}`;
          const showAvatarImage = !!avatarUrl && !failedAvatarByKey[avatarKey];
          const unread = unreadLabel(ticket, localUnreadByTicket);
          const preview = previewLabel(ticket);
          const activityAt = ticket.last_message_at || ticket.updated_at;
          return (
            <button
              type="button"
              key={ticket.id}
              className={`${styles.ticketItem} ${isSelected ? styles.ticketItemActive : ''}`}
              onClick={() => onSelect(ticket.id)}
            >
              <span className={styles.ticketAvatar}>
                {showAvatarImage ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    onError={() => {
                      setFailedAvatarByKey((current) => {
                        if (current[avatarKey]) return current;
                        return { ...current, [avatarKey]: true };
                      });
                      if (typeof onAvatarError === 'function') {
                        onAvatarError(phone);
                      }
                    }}
                  />
                ) : (
                  avatarInitials(ticket)
                )}
              </span>
              <span className={styles.ticketMain}>
                <span className={styles.ticketHeading}>
                  <span className={styles.ticketName}>{displayName(ticket)}</span>
                </span>
                {preview ? <span className={styles.ticketPreview}>{preview}</span> : null}
                <span className={styles.ticketMeta}>
                  <span className={`${styles.statusBadge} ${statusClass(ticket.status)}`}>
                    {statusLabel(ticket.status)}
                  </span>
                  <span className={styles.ticketDateTime}>
                    <span className={styles.ticketDate}>{formatDate(activityAt)}</span>
                    <span className={styles.ticketTime}>{formatTime(activityAt)}</span>
                    {unread ? <span className={styles.ticketUnreadBadge}>{unread}</span> : null}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
