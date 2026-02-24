'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getHasAdmin } from '@/src/frontend/lib/authApi';
import { getWhatsAppQrStatus, refreshWhatsAppQr } from '@/src/frontend/lib/whatsappApi';
import type { WhatsAppQrState } from '@/src/frontend/types/whatsapp';
import styles from '@/src/frontend/components/whatsapp/whatsappQr.module.css';

const CONNECTED_POLLS_TO_REDIRECT = 2;

export default function WhatsAppQrPage() {
  const router = useRouter();
  const connectedStreakRef = useRef(0);
  const redirectingRef = useRef(false);

  const [state, setState] = useState<WhatsAppQrState | null>(null);
  const [statusText, setStatusText] = useState('Iniciando...');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadState = useCallback(async () => {
    try {
      const nextState = await getWhatsAppQrStatus();
      setState(nextState);

      const isConnected = !!nextState.connected || !!nextState.stableConnected;
      if (isConnected) {
        connectedStreakRef.current += 1;
      } else {
        connectedStreakRef.current = 0;
      }

      if (isConnected && connectedStreakRef.current >= CONNECTED_POLLS_TO_REDIRECT) {
        if (redirectingRef.current) return;
        redirectingRef.current = true;
        setStatusText('Conectado. Redirecionando...');

        try {
          const auth = await getHasAdmin();
          router.replace(auth.hasAdmin ? '/login' : '/welcome');
        } catch (_) {
          router.replace('/welcome');
        }
        return;
      }

      if (nextState.connected) {
        setStatusText('Conectado');
      } else if (nextState.setupRequired) {
        setStatusText('Configuração pendente');
      } else {
        setStatusText(nextState.message || 'Aguardando integração');
      }
    } catch (_) {
      setStatusText('Erro ao consultar API');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    const schedule = async (delayMs: number) => {
      if (cancelled) return;

      timeoutId = window.setTimeout(async () => {
        if (cancelled) return;
        await loadState();
        const nextDelay = document.hidden ? 8000 : 2200;
        await schedule(nextDelay);
      }, delayMs);
    };

    void schedule(100);

    const handleVisibility = () => {
      if (!document.hidden) {
        void loadState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadState]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshWhatsAppQr();
    } catch (_) {
      // no-op
    } finally {
      setRefreshing(false);
      await loadState();
    }
  }, [loadState]);

  const placeholder = (() => {
    if (loading) return 'Validando configuração da API oficial...';
    if (state?.qrDataUrl) return null;
    return state?.message || 'Configure as variáveis da WhatsApp Cloud API e valide novamente.';
  })();

  return (
    <main className={`${styles.page} route-enter`}>
      <section className={styles.card}>
        <h1 className={styles.title}>Conectar WhatsApp</h1>
        <p className={styles.subtitle}>Integração via API oficial (WhatsApp Cloud API).</p>

        <div className={styles.qrBox}>
          {state?.qrDataUrl ? (
            <img className={styles.qrImage} src={state.qrDataUrl} alt="QR Code do WhatsApp" />
          ) : (
            <span>{placeholder}</span>
          )}
        </div>

        <p className={styles.status}>
          Status:{' '}
          <strong className={state?.connected ? styles.ok : undefined}>
            {statusText}
          </strong>
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Validando...' : 'Validar configuração'}
          </button>
        </div>

        <div className={styles.help}>
          <strong>Checklist rápido</strong>
          <ul className={styles.helpList}>
            <li>Configurar `WA_CLOUD_ACCESS_TOKEN` e `WA_CLOUD_PHONE_NUMBER_ID`</li>
            <li>Configurar `WA_CLOUD_VERIFY_TOKEN`</li>
            <li>Webhook público ativo em `/whatsapp/webhook`</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
