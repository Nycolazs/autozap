'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminSidebar } from '@/src/frontend/components/admin/AdminSidebar';
import { AwaitSection } from '@/src/frontend/components/admin/AwaitSection';
import { BlacklistSection } from '@/src/frontend/components/admin/BlacklistSection';
import { HoursSection } from '@/src/frontend/components/admin/HoursSection';
import { RankingSection } from '@/src/frontend/components/admin/RankingSection';
import { TicketsSection } from '@/src/frontend/components/admin/TicketsSection';
import { UsersSection } from '@/src/frontend/components/admin/UsersSection';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { useToast } from '@/src/frontend/hooks/useToast';
import { ToastViewport } from '@/src/frontend/components/chat/ToastViewport';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { clearAuthToken } from '@/src/frontend/lib/runtime';
import { getAuthSession, logout } from '@/src/frontend/lib/chatApi';
import type { AdminSectionKey } from '@/src/frontend/types/admin';
import type { AuthSession } from '@/src/frontend/types/chat';

const SECTION_TITLE: Record<AdminSectionKey, string> = {
  users: 'Usuários e papéis',
  tickets: 'Tickets',
  blacklist: 'Blacklist',
  hours: 'Horário comercial',
  await: 'Aguardando automático',
  ranking: 'Ranking de vendedores',
};

const SECTION_HINT: Record<AdminSectionKey, string> = {
  users: 'Gerencie perfis, papéis e permissões',
  tickets: 'Distribua e acompanhe atendimentos',
  blacklist: 'Bloqueie contatos e gerencie restrições',
  hours: 'Configure horários, exceções e mensagens',
  await: 'Automatize retorno para status aguardando',
  ranking: 'Acompanhe performance do time',
};

export default function AdminSellersPage() {
  const router = useRouter();
  const { toasts, push } = useToast();

  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [activeSection, setActiveSection] = useState<AdminSectionKey>('users');

  const handleAuthExpired = useCallback(() => {
    clearAuthToken();
    router.replace('/login');
  }, [router]);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    push(message, type);
  }, [push]);

  const loadSession = useCallback(async () => {
    try {
      const authSession = await getAuthSession();
      if (!authSession?.authenticated) {
        handleAuthExpired();
        return;
      }
      if (authSession.userType !== 'admin') {
        router.replace('/agent');
        return;
      }
      setSession(authSession);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      showToast('Falha ao validar sessao.', 'error');
    } finally {
      setChecking(false);
    }
  }, [handleAuthExpired, router, showToast]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (_) {
      // no-op
    }
    clearAuthToken();
    router.replace('/login');
  }, [router]);

  const sectionElement = useMemo(() => {
    const sharedProps = {
      onToast: showToast,
      onAuthExpired: handleAuthExpired,
    };

    if (activeSection === 'users') return <UsersSection {...sharedProps} />;
    if (activeSection === 'tickets') return <TicketsSection {...sharedProps} />;
    if (activeSection === 'blacklist') return <BlacklistSection {...sharedProps} />;
    if (activeSection === 'hours') return <HoursSection {...sharedProps} />;
    if (activeSection === 'await') return <AwaitSection {...sharedProps} />;
    return <RankingSection {...sharedProps} />;
  }, [activeSection, handleAuthExpired, showToast]);

  if (checking) {
    return <div className={styles.loading}>Carregando painel administrativo...</div>;
  }

  if (!session) {
    return <div className={styles.loading}>Redirecionando...</div>;
  }

  return (
    <>
      <main className={`${styles.page} route-enter`}>
        <AdminSidebar
          active={activeSection}
          onChange={setActiveSection}
          onOpenChat={() => router.push('/agent')}
          onLogout={handleLogout}
        />

        <section className={styles.content}>
          <header className={styles.header}>
            <div className={styles.headerTitleWrap}>
              <h1 className={styles.title}>{SECTION_TITLE[activeSection]}</h1>
              <p className={styles.subtitle}>Administrador: {session.userName}</p>
            </div>
            <div className={styles.headerBadge}>
              <span className={styles.headerBadgeLabel}>Seção ativa</span>
              <strong className={styles.headerBadgeValue}>{SECTION_HINT[activeSection]}</strong>
            </div>
          </header>

          <div className={styles.contentInner}>
            <div key={activeSection} className={styles.sectionStage}>
              {sectionElement}
            </div>
          </div>
        </section>
      </main>

      <ToastViewport toasts={toasts} />
    </>
  );
}
