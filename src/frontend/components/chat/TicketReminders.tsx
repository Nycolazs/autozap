import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { createTicketReminder, listTicketReminders, updateReminder } from '@/src/frontend/lib/chatApi';
import { parseDate } from '@/src/frontend/lib/runtime';
import type { TicketReminder } from '@/src/frontend/types/chat';
import type { ToastType } from '@/src/frontend/hooks/useToast';
import styles from '@/src/frontend/components/chat/chat.module.css';

type TicketRemindersProps = {
  ticketId: number | null;
  disabled: boolean;
  onToast: (message: string, type?: ToastType) => void;
  onAuthExpired: () => void;
};

function defaultScheduleValue(): string {
  const now = new Date(Date.now() + (30 * 60 * 1000));
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatDateTime(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return '--';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Sao_Paulo',
    }).format(parsed);
  } catch (_) {
    return '--';
  }
}

function normalizeStatusLabel(status: TicketReminder['status']): string {
  if (status === 'scheduled') return 'Agendado';
  if (status === 'done') return 'Concluído';
  if (status === 'resolvido') return 'Resolvido';
  return 'Cancelado';
}

export function TicketReminders({ ticketId, disabled, onToast, onAuthExpired }: TicketRemindersProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reminders, setReminders] = useState<TicketReminder[]>([]);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');

  const loadReminders = useCallback(async () => {
    if (!ticketId) {
      setReminders([]);
      return;
    }

    setLoading(true);
    try {
      const list = await listTicketReminders(ticketId);
      setReminders(Array.isArray(list) ? list : []);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onAuthExpired();
        return;
      }
      onToast('Falha ao carregar agendamentos.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast, ticketId]);

  useEffect(() => {
    if (!open) return;
    void loadReminders();
  }, [loadReminders, open]);

  useEffect(() => {
    setOpen(false);
    setScheduledAt(defaultScheduleValue());
    setNote('');
    setMessage('');
  }, [ticketId]);

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

  const activeCount = useMemo(
    () => reminders.filter((item) => item.status === 'scheduled').length,
    [reminders]
  );

  const handleCreate = useCallback(async () => {
    if (!ticketId || disabled || submitting) return;
    if (!scheduledAt) {
      onToast('Defina data e hora do agendamento.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await createTicketReminder(ticketId, {
        scheduled_at: scheduledAt,
        note: String(note || '').trim() || null,
        message: String(message || '').trim() || null,
      });
      onToast('Agendamento criado com sucesso.', 'success');
      setScheduledAt(defaultScheduleValue());
      setNote('');
      setMessage('');
      await loadReminders();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onAuthExpired();
        return;
      }
      onToast(error instanceof Error ? error.message : 'Falha ao criar agendamento.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [disabled, loadReminders, message, note, onAuthExpired, onToast, scheduledAt, submitting, ticketId]);

  const handleStatusChange = useCallback(async (reminder: TicketReminder, nextStatus: TicketReminder['status']) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await updateReminder(reminder.id, { status: nextStatus });
      await loadReminders();
      onToast('Agendamento atualizado.', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onAuthExpired();
        return;
      }
      onToast(error instanceof Error ? error.message : 'Falha ao atualizar agendamento.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [loadReminders, onAuthExpired, onToast, submitting]);

  if (!ticketId) return null;

  return (
    <div className={styles.remindersWrap} ref={rootRef}>
      <button
        type="button"
        className={styles.remindersToggle}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true" className={styles.remindersToggleIcon}>⏰</span>
        <span>Agendamento</span>
        <span className={styles.remindersCount}>{activeCount}</span>
      </button>

      {open ? (
        <div className={styles.remindersPanel} role="dialog" aria-label="Agendamento de mensagem">
          <div className={styles.remindersPanelHead}>
            <strong className={styles.remindersPanelTitle}>Agendamento de mensagem</strong>
            <button
              type="button"
              className={styles.remindersPanelClose}
              onClick={() => setOpen(false)}
              aria-label="Fechar agendamento"
            >
              ×
            </button>
          </div>
          <div className={styles.remindersForm}>
            <label className={styles.remindersField}>
              <span>Quando</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                disabled={disabled || submitting}
              />
            </label>
            <label className={styles.remindersField}>
              <span>Observação</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                placeholder="Opcional"
                disabled={disabled || submitting}
              />
            </label>
            <label className={styles.remindersFieldWide}>
              <span>Mensagem a enviar</span>
              <textarea
                rows={2}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={10000}
                placeholder="Opcional: mensagem vinculada ao lembrete"
                disabled={disabled || submitting}
              />
            </label>
            <button
              type="button"
              className={styles.remindersCreateButton}
              onClick={() => void handleCreate()}
              disabled={disabled || submitting}
            >
              Salvar agendamento
            </button>
          </div>

          <div className={styles.remindersList}>
            {loading ? <div className={styles.remindersEmpty}>Carregando agendamentos...</div> : null}
            {!loading && !reminders.length ? (
              <div className={styles.remindersEmpty}>Nenhum agendamento para este ticket.</div>
            ) : null}
            {reminders.map((item) => (
              <article key={item.id} className={styles.reminderItem}>
                <div className={styles.reminderHead}>
                  <span className={styles.reminderStatus}>{normalizeStatusLabel(item.status)}</span>
                  <span className={styles.reminderDate}>{formatDateTime(item.scheduled_at)}</span>
                </div>
                {item.note ? <div className={styles.reminderNote}>{item.note}</div> : null}
                {item.message ? <div className={styles.reminderMessage}>{item.message}</div> : null}
                <div className={styles.reminderActions}>
                  {item.status === 'scheduled' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleStatusChange(item, 'done')}
                        disabled={submitting}
                      >
                        Concluir
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStatusChange(item, 'canceled')}
                        disabled={submitting}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
