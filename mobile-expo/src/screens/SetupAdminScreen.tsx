import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError } from '../api/client';
import { useAppSession } from '../context/AppSessionContext';
import { colors } from '../theme';

export function SetupAdminScreen() {
  const { setupAdmin } = useAppSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) return false;
    if (password !== confirmPassword) return false;
    if (password.length < 6) return false;
    return true;
  }, [confirmPassword, password, submitting, username]);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await setupAdmin(username, password);
      Alert.alert('Sucesso', 'Administrador criado com sucesso. Faça login para continuar.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        Alert.alert('Admin já existe', 'Já existe um administrador cadastrado. Faça login.');
      } else {
        const message = error instanceof Error ? error.message : 'Falha ao criar administrador.';
        Alert.alert('Erro', message);
      }
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
          <View style={styles.card}>
            <Text style={styles.title}>Bem-vindo ao AutoZap</Text>
            <Text style={styles.subtitle}>Crie o primeiro administrador para iniciar o sistema.</Text>

            <Text style={styles.label}>Usuário administrador</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              style={styles.input}
            />

            <Text style={styles.label}>Senha</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              style={styles.input}
            />

            <Text style={styles.label}>Confirmar senha</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              style={styles.input}
            />

            <Text style={styles.hint}>A senha deve ter pelo menos 6 caracteres.</Text>

            <Pressable
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              style={[styles.button, !canSubmit ? styles.buttonDisabled : null]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Criar administrador</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: colors.primary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cfe0ff',
    padding: 18,
    gap: 8,
  },
  title: {
    fontSize: 28,
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
    borderColor: '#bfd2ef',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: '#fff',
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
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
