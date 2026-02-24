import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_TOKEN_KEY = 'autozap.authToken';
const API_BASE_KEY = 'autozap.apiBase';

export async function readAuthToken(): Promise<string> {
  try {
    return String((await AsyncStorage.getItem(AUTH_TOKEN_KEY)) || '').trim();
  } catch (_) {
    return '';
  }
}

export async function writeAuthToken(token: string): Promise<void> {
  const normalized = String(token || '').trim();
  try {
    if (!normalized) {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      return;
    }
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, normalized);
  } catch (_) {}
}

export async function readApiBase(): Promise<string> {
  try {
    return String((await AsyncStorage.getItem(API_BASE_KEY)) || '').trim().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

export async function writeApiBase(apiBase: string): Promise<void> {
  const normalized = String(apiBase || '').trim().replace(/\/+$/, '');
  try {
    if (!normalized) {
      await AsyncStorage.removeItem(API_BASE_KEY);
      return;
    }
    await AsyncStorage.setItem(API_BASE_KEY, normalized);
  } catch (_) {}
}
