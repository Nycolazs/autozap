import { useCallback, useEffect, useState } from 'react';
import { addBlacklist, listBlacklist, removeBlacklist } from '@/src/frontend/lib/adminApi';
import type { BlacklistEntry } from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import {
  formatDateTime,
  formatPhoneBr,
  getErrorMessage,
  isUnauthorized,
  normalizePhone,
} from '@/src/frontend/components/admin/helpers';

type BlacklistSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

export function BlacklistSection({ onToast, onAuthExpired }: BlacklistSectionProps) {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listBlacklist();
      setEntries(Array.isArray(rows) ? rows : []);
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar blacklist.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = normalizePhone(phone);
    if (!cleaned) {
      onToast('Informe um numero valido.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await addBlacklist({ phone: cleaned, reason: reason.trim() || undefined });
      setPhone('');
      setReason('');
      onToast('Numero adicionado na blacklist.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao adicionar numero.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, phone, reason, refresh]);

  const handleRemove = useCallback(async (entry: BlacklistEntry) => {
    setSubmitting(true);
    try {
      await removeBlacklist(entry.phone);
      onToast('Numero removido da blacklist.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao remover numero.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [onAuthExpired, onToast, refresh]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Blacklist</header>
      <div className={styles.cardBody}>
        <form className={styles.row} onSubmit={handleAdd}>
          <div className={styles.col4}>
            <label className={styles.label}>Telefone</label>
            <input
              className={styles.input}
              value={phone}
              onChange={(event) => setPhone(formatPhoneBr(event.target.value))}
              placeholder="(85) 99999-9999"
            />
          </div>
          <div className={styles.col6}>
            <label className={styles.label}>Motivo</label>
            <input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className={styles.col2}>
            <label className={styles.label}>Acao</label>
            <button className={styles.button} type="submit" disabled={submitting}>Adicionar</button>
          </div>
        </form>

        <div style={{ marginTop: 14 }}>
          {loading ? <div className={styles.muted}>Carregando...</div> : null}
          {!loading && entries.length === 0 ? <div className={styles.empty}>Blacklist vazia.</div> : null}

          {!!entries.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Telefone</th>
                    <th>Motivo</th>
                    <th>Criado em</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.phone}>
                      <td>{entry.phone}</td>
                      <td>{entry.reason || '-'}</td>
                      <td>{formatDateTime(entry.created_at || null)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.buttonDanger}
                          onClick={() => void handleRemove(entry)}
                          disabled={submitting}
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
  );
}
