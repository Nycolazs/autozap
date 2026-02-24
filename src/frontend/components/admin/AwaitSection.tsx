import { useCallback, useEffect, useState } from 'react';
import { getAwaitConfig, saveAwaitConfig } from '@/src/frontend/lib/adminApi';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { getErrorMessage, isUnauthorized } from '@/src/frontend/components/admin/helpers';

type AwaitSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

export function AwaitSection({ onToast, onAuthExpired }: AwaitSectionProps) {
  const [minutes, setMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAwaitConfig();
      setMinutes(Number(response?.minutes || 0));
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar configuracao.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!Number.isFinite(minutes) || minutes < 0) {
      onToast('Informe um valor valido (0 ou mais).', 'warning');
      return;
    }

    setSaving(true);
    try {
      await saveAwaitConfig(Number(minutes));
      onToast('Configuracao de aguardando salva.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao salvar configuracao.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [minutes, onAuthExpired, onToast, refresh]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Aguardando automatico</header>
      <div className={styles.cardBody}>
        <div className={styles.alert}>
          Quando um ticket ficar sem resposta por este tempo, ele pode ser movido automaticamente para "aguardando".
        </div>

        <div className={styles.row} style={{ marginTop: 12 }}>
          <div className={styles.col4}>
            <label className={styles.label}>Minutos</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value || 0))}
              disabled={loading}
            />
          </div>
        </div>

        <div className={styles.inlineActions} style={{ marginTop: 12 }}>
          <button type="button" className={styles.button} onClick={() => void handleSave()} disabled={saving || loading}>
            Salvar
          </button>
        </div>
      </div>
    </section>
  );
}
