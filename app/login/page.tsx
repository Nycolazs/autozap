'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { getHasAdmin, login } from '@/src/frontend/lib/authApi';
import { setAuthToken } from '@/src/frontend/lib/runtime';
import authStyles from '@/src/frontend/components/auth/auth.module.css';

export default function LoginPage() {
  const router = useRouter();

  const [checkingSetup, setCheckingSetup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canSubmit = useMemo(
    () => !submitting && username.trim().length > 0 && password.trim().length > 0,
    [password, submitting, username]
  );

  const ensureAdminExists = useCallback(async () => {
    try {
      const response = await getHasAdmin();
      if (!response.hasAdmin) {
        router.replace('/welcome');
        return;
      }
      setCheckingSetup(false);
    } catch (_) {
      setErrorMessage('Não foi possível validar o ambiente. Tente novamente.');
      setCheckingSetup(false);
    }
  }, [router]);

  useEffect(() => {
    void ensureAdminExists();
  }, [ensureAdminExists]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMessage('');

    try {
      const response = await login({
        username: username.trim(),
        password: password.trim(),
      });

      if (response.accessToken) {
        setAuthToken(response.accessToken);
      }
      router.replace('/agent');
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 409) {
          router.replace('/welcome');
          return;
        }
        setErrorMessage(error.message || 'Falha ao autenticar.');
      } else {
        setErrorMessage('Falha ao autenticar.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, password, router, username]);

  if (checkingSetup) {
    return (
      <main className={`${authStyles.page} route-enter`}>
        <section className={authStyles.card}>
          <h1 className={authStyles.title}>AutoZap</h1>
          <p className={authStyles.subtitle}>Verificando configuração inicial...</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`${authStyles.page} route-enter`}>
      <section className={authStyles.card}>
        <h1 className={authStyles.title}>AutoZap</h1>
        <p className={authStyles.subtitle}>Acesse sua conta para continuar o atendimento.</p>

        <form className={authStyles.form} onSubmit={handleSubmit}>
          {errorMessage ? <p className={authStyles.error}>{errorMessage}</p> : null}

          <label className={authStyles.field}>
            <span className={authStyles.label}>Usuário</span>
            <input
              className={authStyles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={submitting}
              required
            />
          </label>

          <label className={authStyles.field}>
            <span className={authStyles.label}>Senha</span>
            <input
              className={authStyles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
          </label>

          <button className={authStyles.button} type="submit" disabled={!canSubmit}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
