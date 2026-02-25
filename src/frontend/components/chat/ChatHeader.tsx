import { useEffect, useState, type ReactNode } from 'react';
import type { Assignee, Ticket } from '@/src/frontend/types/chat';
import { resolveProfilePictureUrl } from '@/src/frontend/lib/runtime';
import styles from '@/src/frontend/components/chat/chat.module.css';

type ChatHeaderProps = {
  ticket: Ticket | null;
  avatarUrl?: string | null;
  assignees: Assignee[];
  statusUpdating?: boolean;
  assigneeUpdating?: boolean;
  onStatusChange: (status: Ticket['status']) => void;
  onSellerChange: (sellerId: number | null) => void;
  reminderControl?: ReactNode;
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

function avatarInitials(ticket: Ticket | null): string {
  if (!ticket) return '?';
  const name = String(ticket.contact_name || ticket.phone || '').trim();
  const tokens = name
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (!tokens.length) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0].charAt(0)}${tokens[1].charAt(0)}`.toUpperCase();
}

export function ChatHeader({
  ticket,
  avatarUrl,
  assignees,
  statusUpdating = false,
  assigneeUpdating = false,
  onStatusChange,
  onSellerChange,
  reminderControl = null,
  showBackButton = false,
  onBack,
}: ChatHeaderProps) {
  const resolvedAvatarUrl = avatarUrl || (ticket ? resolveProfilePictureUrl(ticket.phone, ticket.avatar_url || '') : '');
  const [failedAvatar, setFailedAvatar] = useState('');

  useEffect(() => {
    setFailedAvatar('');
  }, [resolvedAvatarUrl, ticket?.id]);

  const showAvatarImage = !!resolvedAvatarUrl && failedAvatar !== resolvedAvatarUrl;

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
          {showAvatarImage ? (
            <img
              src={resolvedAvatarUrl}
              alt=""
              onError={() => setFailedAvatar(resolvedAvatarUrl)}
            />
          ) : (
            avatarInitials(ticket)
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

          {reminderControl}
        </div>
      ) : null}
    </header>
  );
}
