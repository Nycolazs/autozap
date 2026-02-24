import Constants from 'expo-constants';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { configureApiClient, getApiBase as readConfiguredApiBase } from '../api/client';
import { getHasAdmin, login as loginRequest, setupAdmin as setupAdminRequest } from '../api/auth';
import { getAuthSession, logout as logoutRequest } from '../api/chat';
import { readApiBase, readAuthToken, writeApiBase, writeAuthToken } from '../lib/storage';
import type { AuthSession } from '../types/chat';

type AppSessionContextValue = {
  booting: boolean;
  hasAdmin: boolean;
  session: AuthSession | null;
  apiBase: string;
  token: string;
  setApiBase: (apiBase: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setupAdmin: (username: string, password: string) => Promise<void>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function normalizeApiBase(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readDefaultApiBase(): string {
  const extra = (Constants.expoConfig?.extra || {}) as { apiBaseUrl?: string };
  const fromExtra = normalizeApiBase(String(extra.apiBaseUrl || ''));
  if (fromExtra) return fromExtra;
  return 'http://127.0.0.1:3000';
}

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [apiBase, setApiBaseState] = useState<string>(readDefaultApiBase());
  const [token, setToken] = useState<string>('');

  const applyClientConfig = useCallback((nextApiBase: string, nextToken: string) => {
    configureApiClient({
      apiBase: normalizeApiBase(nextApiBase),
      authToken: String(nextToken || '').trim(),
    });
  }, []);

  const setApiBase = useCallback(async (nextApiBase: string) => {
    const normalized = normalizeApiBase(nextApiBase);
    setApiBaseState(normalized);
    await writeApiBase(normalized);
    applyClientConfig(normalized, token);
  }, [applyClientConfig, token]);

  const refreshSession = useCallback(async () => {
    const effectiveApiBase = normalizeApiBase(readConfiguredApiBase() || apiBase);
    if (!token) {
      setSession(null);
      return;
    }

    try {
      const authSession = await getAuthSession();
      if (!authSession?.authenticated) {
        setSession(null);
        setToken('');
        await writeAuthToken('');
        applyClientConfig(effectiveApiBase, '');
        return;
      }
      setSession(authSession);
    } catch (_) {
      setSession(null);
      setToken('');
      await writeAuthToken('');
      applyClientConfig(effectiveApiBase, '');
    }
  }, [apiBase, applyClientConfig, token]);

  const signIn = useCallback(async (username: string, password: string) => {
    const effectiveApiBase = normalizeApiBase(readConfiguredApiBase() || apiBase);
    const response = await loginRequest({
      username: username.trim(),
      password: password.trim(),
    });

    const accessToken = String(response.accessToken || '').trim();
    setToken(accessToken);
    await writeAuthToken(accessToken);
    applyClientConfig(effectiveApiBase, accessToken);

    setSession({
      authenticated: true,
      userId: response.userId,
      userName: response.userName,
      userType: response.userType,
    });
    setHasAdmin(true);
  }, [apiBase, applyClientConfig]);

  const signOut = useCallback(async () => {
    const effectiveApiBase = normalizeApiBase(readConfiguredApiBase() || apiBase);
    try {
      await logoutRequest();
    } catch (_) {}

    setSession(null);
    setToken('');
    await writeAuthToken('');
    applyClientConfig(effectiveApiBase, '');
  }, [apiBase, applyClientConfig]);

  const setupAdmin = useCallback(async (username: string, password: string) => {
    await setupAdminRequest({ username: username.trim(), password: password.trim() });
    setHasAdmin(true);
  }, []);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const [savedApiBase, savedToken] = await Promise.all([readApiBase(), readAuthToken()]);
        const nextApiBase = normalizeApiBase(savedApiBase || readDefaultApiBase());
        const nextToken = String(savedToken || '').trim();

        if (disposed) return;

        setApiBaseState(nextApiBase);
        setToken(nextToken);
        applyClientConfig(nextApiBase, nextToken);

        const setup = await getHasAdmin();
        if (disposed) return;

        if (!setup.hasAdmin) {
          setHasAdmin(false);
          setSession(null);
          setToken('');
          await writeAuthToken('');
          applyClientConfig(nextApiBase, '');
          return;
        }

        setHasAdmin(true);
        if (!nextToken) {
          setSession(null);
          return;
        }

        try {
          const authSession = await getAuthSession();
          if (disposed) return;

          if (authSession?.authenticated) {
            setSession(authSession);
          } else {
            setSession(null);
            setToken('');
            await writeAuthToken('');
            applyClientConfig(nextApiBase, '');
          }
        } catch (_) {
          if (disposed) return;
          setSession(null);
          setToken('');
          await writeAuthToken('');
          applyClientConfig(nextApiBase, '');
        }
      } catch (_) {
        if (!disposed) {
          setSession(null);
        }
      } finally {
        if (!disposed) {
          setBooting(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [applyClientConfig]);

  const value = useMemo<AppSessionContextValue>(() => ({
    booting,
    hasAdmin,
    session,
    apiBase,
    token,
    setApiBase,
    refreshSession,
    signIn,
    signOut,
    setupAdmin,
  }), [apiBase, booting, hasAdmin, refreshSession, session, setApiBase, setupAdmin, signIn, signOut, token]);

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  );
}

export function useAppSession(): AppSessionContextValue {
  const ctx = useContext(AppSessionContext);
  if (!ctx) {
    throw new Error('useAppSession must be used inside AppSessionProvider');
  }
  return ctx;
}
