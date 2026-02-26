import { Animated, Appearance } from 'react-native';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AppColors, ThemeMode } from '../theme';
import { resolveThemeColors } from '../theme';

type AppThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: AppColors;
  transition: Animated.Value;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function resolveInitialMode(): ThemeMode {
  const system = Appearance.getColorScheme();
  return system === 'dark' ? 'dark' : 'light';
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(resolveInitialMode);
  const [transition] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const listener = Appearance.addChangeListener((next) => {
      const nextMode: ThemeMode = next.colorScheme === 'dark' ? 'dark' : 'light';
      setMode(nextMode);
    });

    return () => {
      listener.remove();
    };
  }, []);

  useEffect(() => {
    transition.stopAnimation();
    transition.setValue(0.93);
    Animated.timing(transition, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [mode, transition]);

  const value = useMemo<AppThemeContextValue>(() => ({
    mode,
    isDark: mode === 'dark',
    colors: resolveThemeColors(mode),
    transition,
  }), [mode, transition]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeContextValue {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used inside AppThemeProvider');
  }
  return context;
}
