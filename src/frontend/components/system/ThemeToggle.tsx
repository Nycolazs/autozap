'use client';

import { useEffect, useState } from 'react';
import { applyTheme, getResolvedTheme, toggleTheme, type AppTheme } from '@/src/frontend/lib/theme';

type ThemeToggleProps = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className = '', compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<AppTheme>('light');

  useEffect(() => {
    const resolved = getResolvedTheme();
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  const nextLabel = theme === 'dark' ? 'Claro' : 'Escuro';
  const icon = theme === 'dark' ? '☀️' : '🌙';

  return (
    <button
      type="button"
      className={`themeToggleButton ${compact ? 'themeToggleButtonCompact' : ''} ${className}`.trim()}
      onClick={() => setTheme(toggleTheme(theme))}
      aria-label={`Ativar modo ${nextLabel.toLowerCase()}`}
      title={`Modo ${nextLabel}`}
    >
      <span aria-hidden="true">{icon}</span>
      {compact ? null : <span>{nextLabel}</span>}
    </button>
  );
}
