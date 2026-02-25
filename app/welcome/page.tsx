'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError } from '@/src/frontend/lib/http';
import { getHasAdmin, setupAdmin } from '@/src/frontend/lib/authApi';
import { ThemeToggle } from '@/src/frontend/components/system/ThemeToggle';
import authStyles from '@/src/frontend/components/auth/auth.module.css';

export default function WelcomePage() {
  const router = useRouter();

  const [checkingSetup, setCheckingSetup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) return false;
    if (password !== confirmPassword) return false;
    if (password.length < 6) return false;
    return true;
  }, [confirmPassword, password, submitting, username]);

  const ensureNeedsSetup = useCallback(async () => {
    try {
      const response = await getHasAdmin();
      if (response.hasAdmin) {
        router.replace('/login');
        return;
      }
      setCheckingSetup(false);
    } catch (_) {
      setErrorMessage('Não foi possível validar o ambiente. Tente novamente.');
      setCheckingSetup(false);
    }
  }, [router]);

  useEffect(() => {
    void ensureNeedsSetup();
  }, [ensureNeedsSetup]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    if (password !== confirmPassword) {
      setErrorMessage('As senhas não conferem.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      await setupAdmin({
        username: username.trim(),
        password: password.trim(),
      });
      setSuccessMessage('Administrador criado com sucesso. Redirecionando para login...');
      window.setTimeout(() => {
        router.replace('/login');
      }, 900);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 409) {
          router.replace('/login');
          return;
        }
        setErrorMessage(error.message || 'Falha ao criar administrador.');
      } else {
        setErrorMessage('Falha ao criar administrador.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, confirmPassword, password, router, username]);

  if (checkingSetup) {
    return (
      <main className={`${authStyles.page} route-enter`}>
        <section className={authStyles.card}>
          <h1 className={authStyles.title}>AutoZap</h1>
          <p className={authStyles.subtitle}>Validando configuração inicial...</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`${authStyles.page} route-enter`}>
      <section className={authStyles.card}>
        <div className={authStyles.titleRow}>
          <h1 className={authStyles.title}>Bem-vindo ao AutoZap</h1>
          <ThemeToggle compact />
        </div>
        <p className={authStyles.subtitle}>
          Este projeto ainda não possui administrador. Crie o primeiro usuário para iniciar.
        </p>

        <form className={authStyles.form} onSubmit={handleSubmit} autoComplete="off">
          {errorMessage ? <p className={authStyles.error}>{errorMessage}</p> : null}
          {successMessage ? <p className={authStyles.success}>{successMessage}</p> : null}

          <label className={authStyles.field}>
            <span className={authStyles.label}>Usuário administrador</span>
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
              autoComplete="new-password"
              disabled={submitting}
              required
            />
          </label>

          <label className={authStyles.field}>
            <span className={authStyles.label}>Confirmar senha</span>
            <input
              className={authStyles.input}
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              required
            />
          </label>

          <p className={authStyles.hint}>A senha deve ter pelo menos 6 caracteres.</p>

          <button className={authStyles.button} type="submit" disabled={!canSubmit}>
            {submitting ? 'Criando...' : 'Criar administrador'}
          </button>
        </form>
      </section>
    </main>
  );
}
