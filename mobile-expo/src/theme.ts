export type ThemeMode = 'light' | 'dark';

export type AppColors = {
  primary: string;
  primaryStrong: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  success: string;
  danger: string;
  warning: string;
};

export const lightColors: AppColors = {
  primary: '#1a73e8',
  primaryStrong: '#0b57d0',
  background: '#e9eff7',
  surface: '#ffffff',
  border: '#d5dfeb',
  text: '#102a43',
  muted: '#5f7288',
  success: '#0f766e',
  danger: '#b42318',
  warning: '#8a5d00',
};

export const darkColors: AppColors = {
  primary: '#2b6fdb',
  primaryStrong: '#4a90ff',
  background: '#0b141a',
  surface: '#111b21',
  border: '#223244',
  text: '#e9edef',
  muted: '#a0b4c8',
  success: '#2ed573',
  danger: '#ff6b6b',
  warning: '#f6c453',
};

export function resolveThemeColors(mode: ThemeMode): AppColors {
  return mode === 'dark' ? darkColors : lightColors;
}

// Legacy fallback for modules not yet converted to runtime theming.
export const colors = lightColors;
