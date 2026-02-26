import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { assignTicket, listAdminTickets, listAssignees } from '@/src/frontend/lib/adminApi';
import type { AdminTicket, Assignee } from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { AdminDateField } from '@/src/frontend/components/admin/AdminDateField';
import {
  formatDateTime,
  formatIsoDateBr,
  getErrorMessage,
  isUnauthorized,
  toIsoDateInput,
} from '@/src/frontend/components/admin/helpers';

type TicketsSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

type DistributionFilters = {
  sellerFilter: string;
  startDate: string;
  endDate: string;
  statusFilter: string;
};

function normalizeTicketStatus(status: unknown): string {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  if (normalized === 'em_atendimento' || normalized === 'ematendimento') return 'em_atendimento';
  if (normalized === 'pendente') return 'pendente';
  if (normalized === 'aguardando') return 'aguardando';
  if (normalized === 'resolvido') return 'resolvido';
  if (normalized === 'encerrado') return 'encerrado';
  return normalized;
}

function ticketSellerId(ticket: AdminTicket): number | null {
  const row = ticket as unknown as Record<string, unknown>;
  const raw = row.seller_id ?? row.sellerId ?? row.assigned_to ?? row.assignedTo ?? null;
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function statusClass(status: string): string {
  const normalized = normalizeTicketStatus(status);
  if (normalized === 'pendente') return `${styles.status} ${styles.statusPendente}`;
  if (normalized === 'aguardando') return `${styles.status} ${styles.statusAguardando}`;
  if (normalized === 'em_atendimento') return `${styles.status} ${styles.statusEm}`;
  return `${styles.status} ${styles.statusFechado}`;
}

function statusLabel(status: string): string {
  const normalized = normalizeTicketStatus(status);
  if (normalized === 'pendente') return 'Pendente';
  if (normalized === 'aguardando') return 'Aguardando';
  if (normalized === 'em_atendimento') return 'Em Atendimento';
  if (normalized === 'resolvido') return 'Resolvido';
  if (normalized === 'encerrado') return 'Encerrado';
  return String(status || '').replace(/_/g, ' ');
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: toIsoDateInput(start),
    endDate: toIsoDateInput(end),
  };
}

function parseSellerFilter(sellerFilter: string): number | null | undefined {
  if (!sellerFilter) return undefined;
  if (sellerFilter === '__unassigned__') return null;
  const parsed = Number(sellerFilter);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function ticketDateKey(ticket: AdminTicket): string {
  const row = ticket as unknown as Record<string, unknown>;
  const updated = String(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt ?? '').trim();
  if (!updated) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(updated)) return updated.slice(0, 10);
  const parsed = Date.parse(updated.replace(' ', 'T'));
  if (!Number.isFinite(parsed)) return '';
  const d = new Date(parsed);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function TicketsSection({ onToast, onAuthExpired }: TicketsSectionProps) {
  const router = useRouter();
  const defaults = useMemo(() => defaultRange(), []);
  const autoFilterReadyRef = useRef(false);
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningTicketId, setAssigningTicketId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  const loadTickets = useCallback(async (filters: DistributionFilters) => {
    setLoading(true);
    try {
      const [ticketList, assigneeList] = await Promise.all([
        listAdminTickets({
          sellerId: parseSellerFilter(filters.sellerFilter),
          status: filters.statusFilter || undefined,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
        }),
        listAssignees(),
      ]);
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

  const applyFilters = useCallback(() => {
    if (startDate && endDate && startDate > endDate) {
      onToast('Data inicial nao pode ser maior que a final.', 'warning');
      return;
    }
    void loadTickets({ sellerFilter, startDate, endDate, statusFilter });
  }, [endDate, loadTickets, onToast, sellerFilter, startDate, statusFilter]);

  useEffect(() => {
    void loadTickets({
      sellerFilter: '',
      startDate: defaults.startDate,
      endDate: defaults.endDate,
      statusFilter: '',
    });
  }, [defaults.endDate, defaults.startDate, loadTickets]);

  useEffect(() => {
    if (!autoFilterReadyRef.current) {
      autoFilterReadyRef.current = true;
      return;
    }
    if (startDate && endDate && startDate > endDate) return;
    void loadTickets({ sellerFilter, startDate, endDate, statusFilter });
  }, [endDate, loadTickets, sellerFilter, startDate, statusFilter]);

  const filteredTickets = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();

    return tickets.filter((ticket) => {
      const normalizedStatus = normalizeTicketStatus(ticket.status);
      if (statusFilter && normalizedStatus !== statusFilter) return false;
      if (sellerFilter) {
        const sellerId = ticketSellerId(ticket);
        if (sellerFilter === '__unassigned__') {
          if (sellerId != null) return false;
        } else if (Number(sellerFilter) !== Number(sellerId)) {
          return false;
        }
      }

      const dateKey = ticketDateKey(ticket);
      if (startDate && dateKey && dateKey < startDate) return false;
      if (endDate && dateKey && dateKey > endDate) return false;

      if (!needle) return true;

      const text = [
        String(ticket.contact_name || ''),
        String(ticket.phone || ''),
        String(ticket.seller_name || ''),
        statusLabel(ticket.status),
      ].join(' ').toLowerCase();

      return text.includes(needle);
    });
  }, [endDate, search, sellerFilter, startDate, statusFilter, tickets]);

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

  const handleOpenTicket = useCallback((ticketId: number) => {
    router.push(`/agent?ticketId=${encodeURIComponent(String(ticketId))}&includeClosed=1`);
  }, [router]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Todos os tickets</header>
      <div className={styles.cardBody}>
        <div className={styles.row} style={{ marginBottom: 12 }}>
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
          <div className={styles.col4}>
            <AdminDateField label="Data inicial" value={startDate} onChange={setStartDate} />
          </div>
          <div className={styles.col4}>
            <AdminDateField label="Data final" value={endDate} onChange={setEndDate} />
          </div>
        </div>

        <div className={styles.inlineActions} style={{ marginBottom: 12 }}>
          <button type="button" className={styles.button} onClick={() => applyFilters()} disabled={loading}>
            Aplicar filtros
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => applyFilters()}
            disabled={loading}
          >
            Atualizar
          </button>
          <span className={styles.muted}>{filteredTickets.length} ticket(s)</span>
        </div>

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
              <option value="em_atendimento">Em Atendimento</option>
              <option value="resolvido">Resolvido</option>
              <option value="encerrado">Encerrado</option>
            </select>
          </div>
          <div className={styles.col4}>
            <label className={styles.label}>Periodo ativo</label>
            <input
              className={styles.input}
              value={`${formatIsoDateBr(startDate) || '-'} até ${formatIsoDateBr(endDate) || '-'}`}
              readOnly
            />
          </div>
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
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => handleOpenTicket(ticket.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.buttonGhost}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenTicket(ticket.id);
                        }}
                      >
                        {ticket.contact_name || '-'}
                      </button>
                    </td>
                    <td>{ticket.phone}</td>
                    <td><span className={statusClass(ticket.status)}>{statusLabel(ticket.status)}</span></td>
                    <td>
                      <select
                        className={styles.select}
                        value={ticket.seller_id != null ? String(ticket.seller_id) : ''}
                        onClick={(event) => event.stopPropagation()}
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
                    <td>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenTicket(ticket.id);
                        }}
                      >
                        Abrir chat
                      </button>
                    </td>
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
