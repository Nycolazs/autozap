import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDate } from '@/src/frontend/lib/runtime';
import type { Ticket } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

type TicketHistoryProps = {
  ticket: Ticket | null;
  historyTickets: Ticket[];
  loading: boolean;
  onSelectTicket: (ticket: Ticket) => void;
};

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em Atendimento';
  if (status === 'resolvido') return 'Resolvido';
  return 'Encerrado';
}

function formatHistoryDate(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return '--';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Sao_Paulo',
    }).format(parsed);
  } catch (_) {
    return '--';
  }
}

export function TicketHistory({ ticket, historyTickets, loading, onSelectTicket }: TicketHistoryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const oldTicketsCount = useMemo(
    () => Math.max(0, historyTickets.length - 1),
    [historyTickets.length]
  );

  useEffect(() => {
    setOpen(false);
  }, [ticket?.id]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  if (!ticket) return null;

  return (
    <div className={`${styles.ticketHistoryWrap} ${open ? styles.ticketHistoryWrapOpen : ''}`} ref={rootRef}>
      <button
        type="button"
        className={styles.ticketHistoryButton}
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading || oldTicketsCount <= 0}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={styles.ticketHistoryButtonIcon} aria-hidden="true">🕘</span>
        <span className={styles.ticketHistoryButtonText}>Tickets anteriores</span>
        <span className={styles.ticketHistoryButtonCount}>{oldTicketsCount}</span>
      </button>

      {open ? (
        <div className={styles.ticketHistoryPanel} role="dialog" aria-label="Histórico de tickets do cliente">
          <div className={styles.ticketHistoryPanelHead}>
            <strong className={styles.ticketHistoryPanelTitle}>Histórico de tickets do cliente</strong>
            <button
              type="button"
              className={styles.ticketHistoryPanelClose}
              onClick={() => setOpen(false)}
              aria-label="Fechar histórico"
            >
              ×
            </button>
          </div>
          <div className={styles.ticketHistoryList}>
            {!historyTickets.length ? (
              <div className={styles.ticketHistoryEmpty}>Nenhum ticket encontrado para este cliente.</div>
            ) : null}
            {historyTickets.map((item) => {
              const active = Number(item.id) === Number(ticket.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.ticketHistoryItem} ${active ? styles.ticketHistoryItemActive : ''}`}
                  onClick={() => {
                    setOpen(false);
                    if (active) return;
                    onSelectTicket(item);
                  }}
                >
                  <div className={styles.ticketHistoryItemMain}>
                    <span>#{item.id}</span>
                    <span className={styles.ticketHistoryItemDot}>•</span>
                    <span>{statusLabel(item.status)}</span>
                  </div>
                  <div className={styles.ticketHistoryItemMeta}>
                    {item.seller_name ? `Responsável: ${item.seller_name}` : 'Não atribuído'}
                    <span className={styles.ticketHistoryItemDot}>•</span>
                    <span>{formatHistoryDate(item.updated_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
