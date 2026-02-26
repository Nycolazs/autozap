import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../context/AppThemeContext';

export function LoadingView({ label = 'Carregando...' }: { label?: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
    },
    label: {
      color: colors.muted,
      fontSize: 14,
    },
  }), [colors.background, colors.muted]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}
