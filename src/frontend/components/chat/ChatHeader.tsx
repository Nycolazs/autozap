import type { Assignee, Ticket } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

type ChatHeaderProps = {
  ticket: Ticket | null;
  avatarUrl?: string | null;
  assignees: Assignee[];
  statusUpdating?: boolean;
  assigneeUpdating?: boolean;
  onStatusChange: (status: Ticket['status']) => void;
  onSellerChange: (sellerId: number | null) => void;
  showBackButton?: boolean;
  onBack?: () => void;
};

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em atendimento';
  if (status === 'resolvido') return 'Resolvido';
  return 'Encerrado';
}

function avatarLetter(ticket: Ticket | null): string {
  if (!ticket) return '?';
  const name = String(ticket.contact_name || ticket.phone || '').trim();
  return name.charAt(0).toUpperCase() || '?';
}

export function ChatHeader({
  ticket,
  avatarUrl,
  assignees,
  statusUpdating = false,
  assigneeUpdating = false,
  onStatusChange,
  onSellerChange,
  showBackButton = false,
  onBack,
}: ChatHeaderProps) {
  return (
    <header className={styles.chatHeader}>
      <div className={styles.chatHeaderMain}>
        {showBackButton ? (
          <button
            type="button"
            className={styles.headerBackButton}
            onClick={onBack}
            aria-label="Voltar para conversas"
          >
            ←
          </button>
        ) : null}

        <div className={styles.chatAvatar}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={ticket?.contact_name || ticket?.phone || 'Contato'} />
          ) : (
            avatarLetter(ticket)
          )}
        </div>

        {ticket ? (
          <div className={styles.chatHeaderContact}>
            <div className={styles.chatTitle}>
              {ticket.contact_name || ticket.phone}
            </div>
            <div className={styles.chatSubTitle}>{ticket.phone}</div>
          </div>
        ) : (
          <div className={styles.chatHeaderContact}>
            <div className={styles.chatTitle}>Selecione uma conversa</div>
            <div className={styles.chatSubTitle}>Escolha um ticket na lista para começar</div>
          </div>
        )}
      </div>

      {ticket ? (
        <div className={styles.chatHeaderActions}>
          <div className={styles.dropdownGroup}>
            <span className={styles.dropdownLabel}>Status</span>
            <div className={styles.dropdownSelectWrap}>
              <select
                className={styles.dropdownSelect}
                value={ticket.status}
                onChange={(event) => onStatusChange(event.target.value as Ticket['status'])}
                disabled={statusUpdating}
              >
                <option value="pendente">{statusLabel('pendente')}</option>
                <option value="aguardando">{statusLabel('aguardando')}</option>
                <option value="em_atendimento">{statusLabel('em_atendimento')}</option>
                <option value="resolvido">{statusLabel('resolvido')}</option>
                <option value="encerrado">{statusLabel('encerrado')}</option>
              </select>
              <span className={styles.dropdownCaret}>▾</span>
            </div>
          </div>

          <div className={styles.dropdownGroup}>
            <span className={styles.dropdownLabel}>Responsável</span>
            <div className={styles.dropdownSelectWrap}>
              <select
                className={styles.dropdownSelect}
                value={ticket.seller_id != null ? String(ticket.seller_id) : ''}
                onChange={(event) => {
                  const value = String(event.target.value || '').trim();
                  if (!value) {
                    onSellerChange(null);
                    return;
                  }

                  const sellerId = Number(value);
                  if (Number.isFinite(sellerId)) {
                    onSellerChange(sellerId);
                  }
                }}
                disabled={assigneeUpdating || !assignees.length}
              >
                <option value="">Não atribuído</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={String(assignee.id)}>{assignee.name}</option>
                ))}
              </select>
              <span className={styles.dropdownCaret}>▾</span>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
