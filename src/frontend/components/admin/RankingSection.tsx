import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRanking } from '@/src/frontend/lib/adminApi';
import type { RankingSeller } from '@/src/frontend/types/admin';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { AdminDateField } from '@/src/frontend/components/admin/AdminDateField';
import {
  formatIsoDateBr,
  getErrorMessage,
  isUnauthorized,
  toIsoDateInput,
} from '@/src/frontend/components/admin/helpers';

type RankingSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    start: toIsoDateInput(start),
    end: toIsoDateInput(end),
  };
}

export function RankingSection({ onToast, onAuthExpired }: RankingSectionProps) {
  const defaults = defaultRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [loading, setLoading] = useState(true);
  const [ranking, setRanking] = useState<RankingSeller[]>([]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) {
      onToast('Informe o periodo.', 'warning');
      return;
    }
    if (startDate > endDate) {
      onToast('Data inicial nao pode ser maior que a final.', 'warning');
      return;
    }

    setLoading(true);
    try {
      const response = await getRanking(startDate, endDate);
      setRanking(Array.isArray(response?.ranking) ? response.ranking : []);
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar ranking.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [endDate, onAuthExpired, onToast, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    return [...ranking].sort((a, b) => Number(b.tickets_resolved || 0) - Number(a.tickets_resolved || 0));
  }, [ranking]);

  const totalResolved = useMemo(
    () => sorted.reduce((acc, item) => acc + Number(item.tickets_resolved || 0), 0),
    [sorted]
  );

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Ranking de vendedores</header>
      <div className={styles.cardBody}>
        <div className={styles.row} style={{ marginBottom: 12 }}>
          <div className={styles.col4}>
            <AdminDateField label="Data inicial" value={startDate} onChange={setStartDate} />
          </div>
          <div className={styles.col4}>
            <AdminDateField label="Data final" value={endDate} onChange={setEndDate} />
          </div>
          <div className={styles.col4}>
            <label className={styles.label}>Período</label>
            <input className={styles.input} value={`${formatIsoDateBr(startDate)} até ${formatIsoDateBr(endDate)}`} readOnly />
          </div>
        </div>
        <div className={styles.row} style={{ marginBottom: 12 }}>
          <div className={styles.col4}>
            <label className={styles.label}>Acao</label>
            <button className={styles.button} type="button" onClick={() => void load()} disabled={loading}>
              Atualizar ranking
            </button>
          </div>
        </div>

        {loading ? <div className={styles.muted}>Carregando...</div> : null}

        {!loading && sorted.length === 0 ? (
          <div className={styles.empty}>Nenhum dado de ranking para o periodo selecionado.</div>
        ) : null}

        {!!sorted.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vendedor</th>
                  <th>Resolvidos</th>
                  <th>Participacao</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, index) => {
                  const resolved = Number(item.tickets_resolved || 0);
                  const percent = totalResolved > 0 ? Math.round((resolved / totalResolved) * 100) : 0;

                  return (
                    <tr key={`${item.seller_id}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{item.seller_name || `Vendedor ${item.seller_id}`}</td>
                      <td>{resolved}</td>
                      <td>
                        <div className={styles.inlineActions} style={{ width: '100%' }}>
                          <div className={styles.progressWrap}>
                            <div className={styles.progressBar} style={{ width: `${percent}%` }} />
                          </div>
                          <span className={styles.muted}>{percent}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
