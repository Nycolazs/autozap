import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addBusinessException,
  getBusinessHours,
  getBusinessMessage,
  listBusinessExceptions,
  removeBusinessException,
  saveBusinessHours,
  saveBusinessMessage,
} from '@/src/frontend/lib/adminApi';
import type {
  BusinessException,
  BusinessHour,
} from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import {
  formatDateOnly,
  getErrorMessage,
  isUnauthorized,
} from '@/src/frontend/components/admin/helpers';

type HoursSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

const DAY_LABELS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];

function buildDefaultHours(): BusinessHour[] {
  return Array.from({ length: 7 }).map((_, day) => ({
    day,
    open_time: '08:00',
    close_time: '18:00',
    enabled: day >= 1 && day <= 5,
  }));
}

export function HoursSection({ onToast, onAuthExpired }: HoursSectionProps) {
  const [hours, setHours] = useState<BusinessHour[]>(buildDefaultHours);
  const [exceptions, setExceptions] = useState<BusinessException[]>([]);
  const [message, setMessage] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newExceptionDate, setNewExceptionDate] = useState('');
  const [newExceptionReason, setNewExceptionReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [hoursResponse, exceptionResponse, messageResponse] = await Promise.all([
        getBusinessHours(),
        listBusinessExceptions(),
        getBusinessMessage(),
      ]);

      const byDay = buildDefaultHours();
      for (const item of hoursResponse || []) {
        if (item && Number.isInteger(item.day) && item.day >= 0 && item.day <= 6) {
          byDay[item.day] = {
            day: item.day,
            open_time: item.open_time,
            close_time: item.close_time,
            enabled: !!item.enabled,
          };
        }
      }

      setHours(byDay);
      setExceptions(Array.isArray(exceptionResponse) ? exceptionResponse : []);
      setMessage(String(messageResponse?.message || ''));
      setMessageEnabled(messageResponse?.enabled !== false);
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar configuracoes de horario.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedExceptions = useMemo(
    () => [...exceptions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [exceptions]
  );

  const updateHour = useCallback((day: number, patch: Partial<BusinessHour>) => {
    setHours((prev) => prev.map((item) => (item.day === day ? { ...item, ...patch } : item)));
  }, []);

  const handleSaveHours = useCallback(async () => {
    setSaving(true);
    try {
      await saveBusinessHours(hours);
      onToast('Horarios salvos com sucesso.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao salvar horarios.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [hours, onAuthExpired, onToast, refresh]);

  const handleAddException = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newExceptionDate) {
      onToast('Informe a data da excecao.', 'warning');
      return;
    }

    setSaving(true);
    try {
      await addBusinessException({
        date: newExceptionDate,
        closed: true,
        reason: newExceptionReason.trim() || null,
      });
      setNewExceptionDate('');
      setNewExceptionReason('');
      onToast('Excecao cadastrada.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao cadastrar excecao.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [newExceptionDate, newExceptionReason, onAuthExpired, onToast, refresh]);

  const handleRemoveException = useCallback(async (id: number) => {
    setSaving(true);
    try {
      await removeBusinessException(id);
      onToast('Excecao removida.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao remover excecao.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  const handleSaveMessage = useCallback(async () => {
    const trimmed = message.trim();
    if (messageEnabled && !trimmed) {
      onToast('Digite uma mensagem para horario fora do expediente.', 'warning');
      return;
    }

    setSaving(true);
    try {
      await saveBusinessMessage({ message: trimmed, enabled: messageEnabled });
      onToast('Mensagem de horario atualizada.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao salvar mensagem.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [message, messageEnabled, onAuthExpired, onToast, refresh]);

  return (
    <>
      <section className={styles.card}>
        <header className={styles.cardHead}>Horarios de funcionamento</header>
        <div className={styles.cardBody}>
          {loading ? <div className={styles.muted}>Carregando...</div> : null}
          {!loading ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Ativo</th>
                    <th>Abre</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((item) => (
                    <tr key={item.day}>
                      <td>{DAY_LABELS[item.day] || `Dia ${item.day}`}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => updateHour(item.day, { enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.input}
                          type="time"
                          value={item.open_time || '08:00'}
                          onChange={(event) => updateHour(item.day, { open_time: event.target.value })}
                          disabled={!item.enabled}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.input}
                          type="time"
                          value={item.close_time || '18:00'}
                          onChange={(event) => updateHour(item.day, { close_time: event.target.value })}
                          disabled={!item.enabled}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className={styles.inlineActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.button} onClick={() => void handleSaveHours()} disabled={saving || loading}>
              Salvar horarios
            </button>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}>Excecoes (feriados e bloqueios)</header>
        <div className={styles.cardBody}>
          <form className={styles.row} onSubmit={handleAddException}>
            <div className={styles.col4}>
              <label className={styles.label}>Data</label>
              <input className={styles.input} type="date" value={newExceptionDate} onChange={(event) => setNewExceptionDate(event.target.value)} />
            </div>
            <div className={styles.col6}>
              <label className={styles.label}>Motivo</label>
              <input className={styles.input} value={newExceptionReason} onChange={(event) => setNewExceptionReason(event.target.value)} />
            </div>
            <div className={styles.col2}>
              <label className={styles.label}>Acao</label>
              <button type="submit" className={styles.button} disabled={saving}>Adicionar</button>
            </div>
          </form>

          <div style={{ marginTop: 12 }}>
            {!sortedExceptions.length ? <div className={styles.empty}>Nenhuma excecao cadastrada.</div> : null}
            {!!sortedExceptions.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Motivo</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedExceptions.map((exception) => (
                      <tr key={exception.id}>
                        <td>{formatDateOnly(exception.date)}</td>
                        <td>{exception.reason || '-'}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.buttonDanger}
                            onClick={() => void handleRemoveException(exception.id)}
                            disabled={saving}
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}>Mensagem fora do horario</header>
        <div className={styles.cardBody}>
          <div className={styles.inlineActions} style={{ marginBottom: 8 }}>
            <label className={styles.inlineActions}>
              <input type="checkbox" checked={messageEnabled} onChange={(event) => setMessageEnabled(event.target.checked)} />
              <span className={styles.muted}>Enviar mensagem automatica fora do horario</span>
            </label>
          </div>
          <textarea className={styles.textarea} value={message} onChange={(event) => setMessage(event.target.value)} />
          <div className={styles.inlineActions} style={{ marginTop: 10 }}>
            <button type="button" className={styles.button} onClick={() => void handleSaveMessage()} disabled={saving}>Salvar mensagem</button>
          </div>
        </div>
      </section>
    </>
  );
}
