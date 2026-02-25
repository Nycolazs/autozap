import { useEffect, useState } from 'react';
import { formatTime, resolveProfilePictureUrl } from '@/src/frontend/lib/runtime';
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
  if (status === 'em_atendimento') return 'Em atendimento';
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
  return String(ticket.phone || '').trim();
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

export function TicketList({
  tickets,
  selectedTicketId,
  includeClosed,
  loading,
  isConnected,
  avatars,
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
                <span className={styles.ticketName}>{displayName(ticket)}</span>
                <span className={styles.ticketPhone}>{ticket.phone}</span>
                <span className={styles.ticketMeta}>
                  <span className={`${styles.statusBadge} ${statusClass(ticket.status)}`}>
                    {statusLabel(ticket.status)}
                  </span>
                  <span className={styles.ticketTime}>{formatTime(ticket.updated_at)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
