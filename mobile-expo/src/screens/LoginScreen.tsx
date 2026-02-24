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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError } from '../api/client';
import { useAppSession } from '../context/AppSessionContext';
import type { RootStackParamList } from '../types/navigation';
import { colors } from '../theme';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: LoginScreenProps) {
  const { signIn, setApiBase, apiBase } = useAppSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(apiBase);
  const [submitting, setSubmitting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const canSubmit = useMemo(
    () => !submitting && username.trim().length > 0 && password.trim().length > 0,
    [password, submitting, username]
  );

  const handleSaveApiBase = async () => {
    const normalized = String(serverUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(normalized)) {
      Alert.alert('Configuração inválida', 'Informe a URL completa, por exemplo: http://192.168.0.10:3000');
      return;
    }

    await setApiBase(normalized);
    Alert.alert('Configuração salva', 'URL da API atualizada com sucesso.');
  };

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
          <View style={styles.card}>
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
              placeholder="Digite sua senha"
              placeholderTextColor="#7b8da3"
            />

            <Pressable
              onPress={handleLogin}
              disabled={!canSubmit}
              style={[styles.button, !canSubmit ? styles.buttonDisabled : null]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
            </Pressable>

            <Pressable onPress={() => setShowConfig((v) => !v)} style={styles.configTrigger}>
              <Text style={styles.configTriggerText}>{showConfig ? 'Ocultar configuração' : 'Configurar URL da API'}</Text>
            </Pressable>

            {showConfig ? (
              <View style={styles.configCard}>
                <Text style={styles.configLabel}>Backend (local/remoto)</Text>
                <TextInput
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  placeholder="http://127.0.0.1:3000"
                  placeholderTextColor="#7b8da3"
                />
                <Pressable onPress={() => void handleSaveApiBase()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Salvar URL</Text>
                </Pressable>
              </View>
            ) : null}
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
    borderColor: '#bfd2ef',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: '#fff',
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
  configTrigger: {
    alignItems: 'center',
    marginTop: 10,
  },
  configTriggerText: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  configCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#d3def0',
    borderRadius: 12,
    backgroundColor: '#f8fbff',
    padding: 10,
    gap: 6,
  },
  configLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#bfd2ef',
    backgroundColor: '#e8f0fe',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
});
