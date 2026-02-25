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
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 4.5L20 21.5M10.75 10.32C10.26 10.71 10 11.32 10 12C10 13.1 10.9 14 12 14C12.67 14 13.28 13.73 13.68 13.25M6.72 8.22C5.36 9.2 4.3 10.53 3.62 12C5.24 15.53 8.37 18 12 18C13.42 18 14.76 17.62 15.95 16.94M9.88 6.26C10.56 6.09 11.27 6 12 6C15.63 6 18.76 8.47 20.38 12C20.04 12.73 19.62 13.42 19.13 14.05"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className={authStyles.passwordToggleIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.8 12C4.48 8.52 8 6 12 6C16 6 19.52 8.52 21.2 12C19.52 15.48 16 18 12 18C8 18 4.48 15.48 2.8 12Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
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
