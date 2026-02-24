import { useCallback, useEffect, useMemo, useState } from 'react';
import { assignTicket, listAdminTickets, listAssignees } from '@/src/frontend/lib/adminApi';
import type { AdminTicket, Assignee } from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { formatDateTime, getErrorMessage, isUnauthorized } from '@/src/frontend/components/admin/helpers';

type TicketsSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

function statusClass(status: string): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'pendente') return `${styles.status} ${styles.statusPendente}`;
  if (normalized === 'aguardando') return `${styles.status} ${styles.statusAguardando}`;
  if (normalized === 'em_atendimento') return `${styles.status} ${styles.statusEm}`;
  return `${styles.status} ${styles.statusFechado}`;
}

export function TicketsSection({ onToast, onAuthExpired }: TicketsSectionProps) {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningTicketId, setAssigningTicketId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketList, assigneeList] = await Promise.all([listAdminTickets(), listAssignees()]);
      setTickets(Array.isArray(ticketList) ? ticketList : []);
      setAssignees(Array.isArray(assigneeList) ? assigneeList : []);
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar tickets.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredTickets = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();

    return tickets.filter((ticket) => {
      if (statusFilter && String(ticket.status || '') !== statusFilter) return false;
      if (sellerFilter) {
        if (sellerFilter === '__unassigned__') {
          if (ticket.seller_id != null) return false;
        } else if (Number(sellerFilter) !== Number(ticket.seller_id)) {
          return false;
        }
      }

      if (!needle) return true;

      const text = [
        String(ticket.contact_name || ''),
        String(ticket.phone || ''),
        String(ticket.seller_name || ''),
      ].join(' ').toLowerCase();

      return text.includes(needle);
    });
  }, [tickets, search, sellerFilter, statusFilter]);

  const handleAssign = useCallback(async (ticketId: number, nextSeller: string) => {
    const parsedSeller = nextSeller ? Number(nextSeller) : null;
    const sellerId = Number.isFinite(parsedSeller as number) ? parsedSeller : null;

    setAssigningTicketId(ticketId);
    try {
      await assignTicket(ticketId, sellerId);
      setTickets((prev) => prev.map((ticket) => {
        if (ticket.id !== ticketId) return ticket;
        const assignee = assignees.find((item) => item.id === sellerId) || null;
        return {
          ...ticket,
          seller_id: sellerId,
          seller_name: assignee ? assignee.name : null,
        };
      }));
      onToast('Atribuicao atualizada.', 'success');
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao atribuir ticket.'), 'error');
    } finally {
      setAssigningTicketId(null);
    }
  }, [assignees, onAuthExpired, onToast]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Tickets</header>
      <div className={styles.cardBody}>
        <div className={styles.row} style={{ marginBottom: 12 }}>
          <div className={styles.col4}>
            <label className={styles.label}>Busca</label>
            <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Contato, telefone, vendedor" />
          </div>
          <div className={styles.col4}>
            <label className={styles.label}>Status</label>
            <select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="aguardando">Aguardando</option>
              <option value="em_atendimento">Em atendimento</option>
              <option value="resolvido">Resolvido</option>
              <option value="encerrado">Encerrado</option>
            </select>
          </div>
          <div className={styles.col4}>
            <label className={styles.label}>Vendedor</label>
            <select className={styles.select} value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="__unassigned__">Nao atribuido</option>
              {assignees.map((seller) => (
                <option key={seller.id} value={String(seller.id)}>{seller.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.inlineActions} style={{ marginBottom: 10 }}>
          <button type="button" className={styles.buttonSecondary} onClick={() => void refresh()} disabled={loading}>Atualizar</button>
          <span className={styles.muted}>{filteredTickets.length} ticket(s)</span>
        </div>

        {loading ? <div className={styles.muted}>Carregando tickets...</div> : null}
        {!loading && filteredTickets.length === 0 ? <div className={styles.empty}>Nenhum ticket para o filtro atual.</div> : null}

        {!!filteredTickets.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Telefone</th>
                  <th>Status</th>
                  <th>Responsavel</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.contact_name || '-'}</td>
                    <td>{ticket.phone}</td>
                    <td><span className={statusClass(ticket.status)}>{ticket.status}</span></td>
                    <td>
                      <select
                        className={styles.select}
                        value={ticket.seller_id != null ? String(ticket.seller_id) : ''}
                        onChange={(event) => void handleAssign(ticket.id, event.target.value)}
                        disabled={assigningTicketId === ticket.id}
                      >
                        <option value="">Nao atribuido</option>
                        {assignees.map((seller) => (
                          <option key={seller.id} value={String(seller.id)}>{seller.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDateTime(ticket.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
