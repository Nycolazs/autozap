import { useCallback, useEffect, useState } from 'react';
import { getWelcomeMessage, saveWelcomeMessage } from '@/src/frontend/lib/adminApi';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { getErrorMessage, isUnauthorized } from '@/src/frontend/components/admin/helpers';

type WelcomeSectionProps = {
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onAuthExpired: () => void;
};

export function WelcomeSection({ onToast, onAuthExpired }: WelcomeSectionProps) {
  const [message, setMessage] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getWelcomeMessage();
      setMessage(String(response?.message || ''));
      setEnabled(response?.enabled !== false);
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao carregar mensagem de boas-vindas.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired, onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    const trimmed = message.trim();
    if (enabled && !trimmed) {
      onToast('Digite uma mensagem de boas-vindas.', 'warning');
      return;
    }

    setSaving(true);
    try {
      await saveWelcomeMessage({ message: trimmed, enabled });
      onToast('Mensagem de boas-vindas atualizada.', 'success');
      await refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        onAuthExpired();
        return;
      }
      onToast(getErrorMessage(error, 'Falha ao salvar mensagem de boas-vindas.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [enabled, message, onAuthExpired, onToast, refresh]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>Boas-vindas no horário comercial</header>
      <div className={styles.cardBody}>
        {loading ? <div className={styles.muted}>Carregando...</div> : null}

        <div className={styles.inlineActions} style={{ marginBottom: 8 }}>
          <label className={styles.inlineActions}>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span className={styles.muted}>Enviar automaticamente quando a conversa iniciar no horário de atendimento</span>
          </label>
        </div>

        <textarea
          className={styles.textarea}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Mensagem automática de boas-vindas"
        />

        <div className={styles.inlineActions} style={{ marginTop: 10 }}>
          <button type="button" className={styles.button} onClick={() => void handleSave()} disabled={saving || loading}>
            Salvar mensagem
          </button>
        </div>
      </div>
    </section>
  );
}
