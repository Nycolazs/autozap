import { formatTime } from '@/src/frontend/lib/runtime';
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

function avatarLetter(ticket: Ticket): string {
  const name = displayName(ticket);
  return name.charAt(0).toUpperCase() || '?';
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
}: TicketListProps) {
  const openCount = tickets.filter((ticket) => ticket.status !== 'encerrado' && ticket.status !== 'resolvido').length;

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
          {isAdmin ? (
            <button type="button" className={styles.adminButton} onClick={onOpenAdmin}>
              Painel admin
            </button>
          ) : null}
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
          const avatarUrl = avatars[ticket.phone];
          return (
            <button
              type="button"
              key={ticket.id}
              className={`${styles.ticketItem} ${isSelected ? styles.ticketItemActive : ''}`}
              onClick={() => onSelect(ticket.id)}
            >
              <span className={styles.ticketAvatar}>
                {avatarUrl ? <img src={avatarUrl} alt={displayName(ticket)} /> : avatarLetter(ticket)}
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
