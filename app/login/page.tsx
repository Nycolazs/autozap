'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { getHasAdmin, login } from '@/src/frontend/lib/authApi';
import { setAuthToken } from '@/src/frontend/lib/runtime';
import { ThemeToggle } from '@/src/frontend/components/system/ThemeToggle';
import authStyles from '@/src/frontend/components/auth/auth.module.css';

export default function LoginPage() {
  const router = useRouter();

  const [checkingSetup, setCheckingSetup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        <div className={authStyles.titleRow}>
          <h1 className={authStyles.title}>AutoZap</h1>
          <ThemeToggle compact />
        </div>
        <p className={authStyles.subtitle}>Acesse sua conta para continuar o atendimento.</p>

        <form className={authStyles.form} onSubmit={handleSubmit} autoComplete="off">
          <input type="text" name="fake-user" autoComplete="off" tabIndex={-1} hidden />
          <input type="password" name="fake-pass" autoComplete="off" tabIndex={-1} hidden />
          {errorMessage ? <p className={authStyles.error}>{errorMessage}</p> : null}

          <label className={authStyles.field}>
            <span className={authStyles.label}>Usuário</span>
            <input
              className={authStyles.input}
              id="access-user"
              name="access-user"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              aria-autocomplete="none"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              autoCapitalize="none"
              disabled={submitting}
              required
            />
          </label>

          <label className={authStyles.field}>
            <span className={authStyles.label}>Senha</span>
            <span className={authStyles.passwordWrap}>
              <input
                className={authStyles.input}
                id="access-secret"
                name="access-secret"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                aria-autocomplete="none"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                autoCapitalize="none"
                disabled={submitting}
                required
              />
              <button
                type="button"
                className={authStyles.passwordToggle}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                disabled={submitting}
                title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? (
                  <svg
                    className={authStyles.passwordToggleIcon}
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 3L17 17M8.8 8.86C8.3 9.17 8 9.58 8 10C8 11.1 8.9 12 10 12C10.42 12 10.83 11.7 11.14 11.2M6.53 6.59C5.03 7.47 3.86 8.65 3.2 10C4.26 12.2 6.95 14 10 14C11.35 14 12.63 13.66 13.74 13.05M9.08 6.03C9.37 6.01 9.68 6 10 6C13.05 6 15.74 7.8 16.8 10C16.47 10.67 16.01 11.3 15.47 11.85"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className={authStyles.passwordToggleIcon}
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.6 10C3.78 7.56 6.55 6 10 6C13.45 6 16.22 7.56 17.4 10C16.22 12.44 13.45 14 10 14C6.55 14 3.78 12.44 2.6 10Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                )}
              </button>
            </span>
          </label>

          <button className={authStyles.button} type="submit" disabled={!canSubmit}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
