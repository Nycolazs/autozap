import React, { useMemo, useState } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ApiRequestError } from '../api/client';
import { useAppSession } from '../context/AppSessionContext';
import { useAppTheme } from '../context/AppThemeContext';
import type { RootStackParamList } from '../types/navigation';
import type { AppColors } from '../theme';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: LoginScreenProps) {
  const { signIn } = useAppSession();
  const { colors, isDark } = useAppTheme();
  const { width } = useWindowDimensions();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = useMemo(
    () => !submitting && username.trim().length > 0 && password.trim().length > 0,
    [password, submitting, username]
  );
  const compactLayout = width < 420;
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const handleLogin = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await signIn(username, password);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        navigation.replace('SetupAdmin');
        return;
      }
      const message = error instanceof Error ? error.message : 'Falha ao autenticar.';
      Alert.alert('Erro no login', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <View style={[styles.card, compactLayout ? null : styles.cardWide]}>
            <Text style={styles.title}>AutoZap</Text>
            <Text style={styles.subtitle}>Acesse sua conta para continuar o atendimento.</Text>

            <Text style={styles.label}>Usuário</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              style={styles.input}
              placeholder="Digite seu usuário"
              placeholderTextColor="#7b8da3"
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
            />

            <Text style={styles.label}>Senha</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                style={styles.passwordInput}
                placeholder="Digite sua senha"
                placeholderTextColor="#7b8da3"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
              />
              <Pressable
                style={styles.passwordToggle}
                onPress={() => setShowPassword((prev) => !prev)}
                accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#5c6f86" />
              </Pressable>
            </View>

            <Pressable
              onPress={handleLogin}
              disabled={!canSubmit}
              style={[styles.button, !canSubmit ? styles.buttonDisabled : null]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors, isDark: boolean) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: {
      flex: 1,
      backgroundColor: isDark ? colors.background : colors.primary,
    },
    container: {
      flex: 1,
      justifyContent: 'center',
      padding: 18,
      backgroundColor: isDark ? colors.background : colors.primary,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: isDark ? '#27405a' : '#cfe0ff',
      padding: 18,
      gap: 8,
    },
    cardWide: {
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    title: {
      fontSize: 40,
      color: colors.primaryStrong,
      fontWeight: '800',
    },
    subtitle: {
      color: colors.muted,
      marginBottom: 8,
    },
    label: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#34506f' : '#bfd2ef',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      backgroundColor: isDark ? '#0b2438' : '#fff',
    },
    passwordWrap: {
      borderWidth: 1,
      borderColor: isDark ? '#34506f' : '#bfd2ef',
      borderRadius: 12,
      backgroundColor: isDark ? '#0b2438' : '#fff',
      paddingLeft: 12,
      paddingRight: 4,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
    },
    passwordInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: 10,
    },
    passwordToggle: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    button: {
      height: 46,
      borderRadius: 12,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    buttonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
  });
}
