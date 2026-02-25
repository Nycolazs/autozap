export type AppTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'AUTOZAP_THEME';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function normalizeTheme(value: unknown): AppTheme | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'dark') return 'dark';
  if (normalized === 'light') return 'light';
  return null;
}

export function getStoredTheme(): AppTheme | null {
  if (!isBrowser()) return null;
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

export function getPreferredTheme(): AppTheme {
  if (!isBrowser()) return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (_) {
    return 'light';
  }
}

export function getResolvedTheme(): AppTheme {
  return getStoredTheme() || getPreferredTheme();
}

export function applyTheme(theme: AppTheme): void {
  if (!isBrowser()) return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: AppTheme): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {}
  applyTheme(theme);
}

export function toggleTheme(currentTheme?: AppTheme): AppTheme {
  const base = currentTheme || getResolvedTheme();
  const next = base === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
