import {
  StyleSheet,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

type RNStyle = ViewStyle | TextStyle | ImageStyle;
type NamedStyles = Record<string, unknown>;

export function mergeThemedStyles<T extends NamedStyles>(
  baseStyles: T,
  darkOverrides: Partial<Record<keyof T, unknown>>,
  isDark: boolean
): T {
  if (!isDark) return baseStyles;

  const merged = {} as T;
  const keys = new Set<string>([
    ...Object.keys(baseStyles),
    ...Object.keys(darkOverrides || {}),
  ]);

  for (const key of keys) {
    const typedKey = key as keyof T;
    const baseStyle = baseStyles[typedKey];
    const darkStyle = darkOverrides[typedKey];

    if (darkStyle == null) {
      merged[typedKey] = baseStyle;
      continue;
    }

    merged[typedKey] = StyleSheet.flatten([
      baseStyle as StyleProp<RNStyle>,
      darkStyle as StyleProp<RNStyle>,
    ]) as T[keyof T];
  }

  return merged;
}
