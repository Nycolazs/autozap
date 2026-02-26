import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiRequestError } from '../api/client';
import { fetchProfilePicture, getConnectionStatus, listTickets } from '../api/chat';
import { useAppSession } from '../context/AppSessionContext';
import { useAppTheme } from '../context/AppThemeContext';
import { formatDate, formatTime } from '../lib/date';
import { resolveProfilePictureUrl } from '../lib/media';
import { mergeThemedStyles } from '../lib/themeStyles';
import type { RootStackParamList } from '../types/navigation';
import type { Ticket } from '../types/chat';
import { lightColors } from '../theme';

type TicketsScreenProps = NativeStackScreenProps<RootStackParamList, 'Tickets'>;

let ticketsScreenCache: Ticket[] = [];
let ticketsAvatarCache: Record<string, string | null> = {};

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em atendimento';
  if (status === 'resolvido') return 'Resolvido';
  return 'Encerrado';
}

function statusBadgeStyle(status: Ticket['status'], isDark: boolean) {
  if (isDark) {
    if (status === 'pendente') {
      return { backgroundColor: '#3f3317', color: '#f6cf72', borderColor: '#6f5b2d' };
    }
    if (status === 'aguardando') {
      return { backgroundColor: '#15314c', color: '#87c6ff', borderColor: '#28527a' };
    }
    if (status === 'em_atendimento') {
      return { backgroundColor: '#1a3a2f', color: '#8fe4b8', borderColor: '#2d6552' };
    }
    if (status === 'resolvido') {
      return { backgroundColor: '#2c3642', color: '#d0d8e2', borderColor: '#445465' };
    }
    return { backgroundColor: '#2a3240', color: '#c8d1dd', borderColor: '#3f4d60' };
  }

  if (status === 'pendente') {
    return { backgroundColor: '#fff8dc', color: '#8a6800', borderColor: '#ffe7a6' };
  }
  if (status === 'aguardando') {
    return { backgroundColor: '#eaf3ff', color: '#1459a8', borderColor: '#cfe0ff' };
  }
  if (status === 'em_atendimento') {
    return { backgroundColor: '#e6f2ff', color: '#124f9c', borderColor: '#c7ddff' };
  }
  if (status === 'resolvido') {
    return { backgroundColor: '#f4f6f8', color: '#4b5563', borderColor: '#e2e8f0' };
  }
  return { backgroundColor: '#eef2f6', color: '#5f6c7b', borderColor: '#d7e0ea' };
}

function avatarLetter(ticket: Ticket): string {
  const base = String(ticket.contact_name || ticket.phone || '').trim();
  const tokens = base
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (!tokens.length) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0].charAt(0)}${tokens[1].charAt(0)}`.toUpperCase();
}

function normalizePhoneForApi(value: unknown): string {
  return String(value || '').split('@')[0].replace(/\D/g, '');
}

function isProfilePictureLookupUrl(value: string): boolean {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;
  return /\/profile-picture\/[^/]+\/image/.test(normalized);
}

export function TicketsScreen({ navigation }: TicketsScreenProps) {
  const { session, signOut } = useAppSession();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => mergeThemedStyles(lightStyles, darkStyles, isDark), [isDark]);

  const [includeClosed, setIncludeClosed] = useState(false);
  const [connectionOnline, setConnectionOnline] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>(() => ticketsScreenCache);
  const [loading, setLoading] = useState(() => ticketsScreenCache.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [avatars, setAvatars] = useState<Record<string, string | null>>(() => ticketsAvatarCache);
  const ticketsLengthRef = useRef<number>(ticketsScreenCache.length);
  const avatarLookupAtRef = useRef<Record<string, number>>({});
  const avatarInFlightRef = useRef<Record<string, Promise<void>>>({});
  const avatarUnavailableUntilRef = useRef<Record<string, number>>({});
  const avatarRetryTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const openCount = useMemo(
    () => tickets.filter((ticket) => ticket.status !== 'resolvido' && ticket.status !== 'encerrado').length,
    [tickets]
  );

  const loadConnection = useCallback(async () => {
    try {
      const state = await getConnectionStatus();
      setConnectionOnline(!!state.connected);
    } catch (_) {
      setConnectionOnline(false);
    }
  }, []);

  const loadTickets = useCallback(async (silent = false) => {
    if (!session) {
      if (silent) setRefreshing(false);
      return;
    }
    if (!silent && ticketsLengthRef.current === 0) setLoading(true);

    try {
      const list = await listTickets({
        userType: session.userType,
        userId: session.userId,
        includeClosed,
      });
      setTickets(list);
      setAvatars((current) => {
        let next = current;
        for (const ticket of list) {
          const normalizedPhone = normalizePhoneForApi(ticket.phone);
          if (!normalizedPhone) continue;
          const resolved = resolveProfilePictureUrl(normalizedPhone, ticket.avatar_url || '');
          if (!resolved || isProfilePictureLookupUrl(resolved)) continue;
          if (next[normalizedPhone] === resolved) continue;
          if (next === current) next = { ...current };
          next[normalizedPhone] = resolved;
        }
        return next;
      });
    } catch (error) {
      if (!silent) {
        if (error instanceof ApiRequestError && error.status === 401) {
          await signOut();
          return;
        }
      }
    } finally {
      if (!silent) setLoading(false);
      if (silent) setRefreshing(false);
    }
  }, [includeClosed, session, signOut]);

  useEffect(() => {
    ticketsScreenCache = tickets;
    ticketsLengthRef.current = tickets.length;
  }, [tickets]);

  useEffect(() => {
    ticketsAvatarCache = avatars;
  }, [avatars]);

  const refreshAvatarForPhone = useCallback(async (rawPhone: string, opts?: { force?: boolean }) => {
    const normalizedPhone = normalizePhoneForApi(rawPhone);
    if (!normalizedPhone) return;

    const force = !!opts?.force;
    const now = Date.now();
    const cooldownMs = force ? 3500 : 20000;
    const unavailableUntil = Number(avatarUnavailableUntilRef.current[normalizedPhone] || 0);
    if (!force && unavailableUntil > now) return;

    const lastLookupAt = Number(avatarLookupAtRef.current[normalizedPhone] || 0);
    if (!force && lastLookupAt && (now - lastLookupAt) < cooldownMs) return;

    const inFlight = avatarInFlightRef.current[normalizedPhone];
    if (inFlight) {
      await inFlight;
      return;
    }

    avatarLookupAtRef.current[normalizedPhone] = now;
    const task = (async () => {
      try {
        const payload = await fetchProfilePicture(
          normalizedPhone,
          force ? { refresh: true } : undefined
        );
        const resolved = resolveProfilePictureUrl(normalizedPhone, payload?.url || null);
        if (resolved) {
          delete avatarUnavailableUntilRef.current[normalizedPhone];
          if (avatarRetryTimeoutRef.current[normalizedPhone]) {
            clearTimeout(avatarRetryTimeoutRef.current[normalizedPhone]);
            delete avatarRetryTimeoutRef.current[normalizedPhone];
          }
          setAvatars((current) => (
            current[normalizedPhone] === resolved
              ? current
              : { ...current, [normalizedPhone]: resolved }
          ));
          return;
        }

        const pending = !!(payload && payload.pending);
        const reason = String((payload && payload.reason) || '').trim().toLowerCase();
        const missTtlMs = pending
          ? 7000
          : (reason.includes('unsupported') ? (30 * 60 * 1000) : (2 * 60 * 1000));
        avatarUnavailableUntilRef.current[normalizedPhone] = Date.now() + missTtlMs;

        setAvatars((current) => (
          current[normalizedPhone] === null
            ? current
            : { ...current, [normalizedPhone]: null }
        ));

        if (pending) {
          if (avatarRetryTimeoutRef.current[normalizedPhone]) {
            clearTimeout(avatarRetryTimeoutRef.current[normalizedPhone]);
          }
          avatarRetryTimeoutRef.current[normalizedPhone] = setTimeout(() => {
            delete avatarRetryTimeoutRef.current[normalizedPhone];
            void refreshAvatarForPhone(normalizedPhone, { force: true });
          }, 1200);
        }
      } catch (_) {
        avatarUnavailableUntilRef.current[normalizedPhone] = Date.now() + (2 * 60 * 1000);
        setAvatars((current) => (
          current[normalizedPhone] === null
            ? current
            : { ...current, [normalizedPhone]: null }
        ));
      } finally {
        delete avatarInFlightRef.current[normalizedPhone];
      }
    })();

    avatarInFlightRef.current[normalizedPhone] = task;
    await task;
  }, []);

  useEffect(() => {
    void Promise.all([loadConnection(), loadTickets()]);
  }, [loadConnection, loadTickets]);

  useEffect(() => {
    const ticketsInterval = setInterval(() => {
      void loadTickets(true);
    }, 4500);

    const connectionInterval = setInterval(() => {
      void loadConnection();
    }, 20000);

    return () => {
      clearInterval(ticketsInterval);
      clearInterval(connectionInterval);
    };
  }, [loadConnection, loadTickets]);

  useEffect(() => {
    if (!tickets.length) return;
    for (const ticket of tickets) {
      const normalizedPhone = normalizePhoneForApi(ticket.phone);
      if (!normalizedPhone) continue;
      const currentAvatar = String(avatars[normalizedPhone] || '').trim();
      if (!currentAvatar || isProfilePictureLookupUrl(currentAvatar)) {
        void refreshAvatarForPhone(normalizedPhone);
      }
    }
  }, [avatars, refreshAvatarForPhone, tickets]);

  useEffect(() => (
    () => {
      for (const timer of Object.values(avatarRetryTimeoutRef.current)) {
        clearTimeout(timer);
      }
      avatarRetryTimeoutRef.current = {};
    }
  ), []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadTickets(true);
  }, [loadTickets]);

  const showBlockingLoader = loading && tickets.length === 0;

  if (!session) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Conversas</Text>
          <Text style={styles.subtitle}>Conversas ativas: {openCount} • Logado como {session.userName}</Text>

          <View style={styles.controlsRow}>
            <View style={styles.switchWrap}>
              <Switch value={includeClosed} onValueChange={setIncludeClosed} />
              <Text style={styles.switchText}>Mostrar encerrados</Text>
            </View>

            {session.userType === 'admin' ? (
              <Pressable onPress={() => navigation.navigate('Admin')} style={styles.adminButton}>
                <Text style={styles.adminButtonText}>Painel admin</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.headerFooter}>
            <Text style={[styles.connectionBadge, connectionOnline ? styles.onlineBadge : styles.offlineBadge]}>
              {connectionOnline ? 'WhatsApp online' : 'WhatsApp offline'}
            </Text>
            <Pressable onPress={() => void signOut()} style={styles.logoutButton}>
              <Text style={styles.logoutButtonText}>Sair</Text>
            </Pressable>
          </View>
        </View>

        {showBlockingLoader ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Carregando conversas...</Text>
          </View>
        ) : (
          <View style={styles.listWrap}>
            <FlatList
              data={tickets}
              keyExtractor={(item) => String(item.id)}
              refreshing={refreshing}
              onRefresh={onRefresh}
              initialNumToRender={16}
              maxToRenderPerBatch={16}
              windowSize={11}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const normalizedPhone = normalizePhoneForApi(item.phone);
                const avatarUrl = normalizedPhone
                  ? (avatars[normalizedPhone]
                    || resolveProfilePictureUrl(normalizedPhone, item.avatar_url || '')
                    || null)
                  : null;
                const badge = statusBadgeStyle(item.status, isDark);
                const hasContactName = String(item.contact_name || '').trim().length > 0;

                return (
                  <Pressable
                    style={styles.ticketItem}
                    onPress={() => navigation.navigate('Chat', { ticket: item })}
                  >
                    <View style={styles.avatarWrap}>
                      {avatarUrl ? (
                        <Image
                          source={{ uri: avatarUrl }}
                          style={styles.avatarImage}
                          onError={() => {
                            if (!normalizedPhone) return;
                            setAvatars((current) => (
                              current[normalizedPhone] === null
                                ? current
                                : { ...current, [normalizedPhone]: null }
                            ));
                            void refreshAvatarForPhone(normalizedPhone, { force: true });
                          }}
                        />
                      ) : (
                        <Text style={styles.avatarLetter}>{avatarLetter(item)}</Text>
                      )}
                    </View>

                    <View style={styles.ticketMain}>
                      <View style={styles.ticketTopRow}>
                        <View style={styles.ticketIdentityRow}>
                          <Text numberOfLines={1} style={styles.ticketName}>{item.contact_name || item.phone}</Text>
                          {hasContactName ? <Text style={styles.ticketPhoneDivider}>•</Text> : null}
                          {hasContactName ? <Text numberOfLines={1} style={styles.ticketPhoneInline}>{item.phone}</Text> : null}
                        </View>
                        <View style={styles.ticketDateTimeWrap}>
                          <Text style={styles.ticketDate}>{formatDate(item.updated_at)}</Text>
                          <Text style={styles.ticketTime}>{formatTime(item.updated_at)}</Text>
                        </View>
                      </View>
                      <View style={[styles.statusBadge, {
                        backgroundColor: badge.backgroundColor,
                        borderColor: badge.borderColor,
                      }]}>
                        <Text style={[styles.statusBadgeText, { color: badge.color }]}>{statusLabel(item.status)}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={(
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>Nenhuma conversa encontrada.</Text>
                </View>
              )}
            />

            {loading ? (
              <View pointerEvents="none" style={styles.softLoadingWrap}>
                <View style={styles.softLoadingChip}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.softLoadingText}>Atualizando conversas...</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  container: { flex: 1, backgroundColor: lightColors.background },
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderColor: lightColors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    color: lightColors.primaryStrong,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: lightColors.muted,
    fontSize: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  switchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  switchText: {
    color: lightColors.text,
    fontSize: 13,
  },
  adminButton: {
    borderWidth: 1,
    borderColor: '#c8dafb',
    backgroundColor: '#e8f0fe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  adminButtonText: {
    color: lightColors.primaryStrong,
    fontWeight: '700',
    fontSize: 12,
  },
  headerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  connectionBadge: {
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  onlineBadge: {
    color: '#1256a4',
    backgroundColor: '#e4efff',
  },
  offlineBadge: {
    color: '#9a3412',
    backgroundColor: '#ffedd5',
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: '#c8dafb',
    backgroundColor: '#edf4ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  logoutButtonText: {
    color: lightColors.primaryStrong,
    fontWeight: '700',
    fontSize: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  listWrap: {
    flex: 1,
  },
  softLoadingWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    alignItems: 'center',
  },
  softLoadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#d2ddef',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  softLoadingText: {
    color: lightColors.primaryStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingText: {
    color: lightColors.muted,
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 20,
  },
  ticketItem: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#edf2f7',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 10,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#dbe8fb',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: {
    fontWeight: '700',
    color: '#365a8a',
    fontSize: 20,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  ticketMain: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketDateTimeWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 0,
  },
  ticketIdentityRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  ticketName: {
    color: lightColors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  ticketPhoneDivider: {
    color: lightColors.muted,
    fontSize: 11,
    opacity: 0.7,
  },
  ticketPhoneInline: {
    color: lightColors.muted,
    fontSize: 12,
    flexShrink: 0,
  },
  ticketTime: {
    color: lightColors.muted,
    fontSize: 12,
    flexShrink: 0,
  },
  ticketDate: {
    color: lightColors.muted,
    fontSize: 12,
    flexShrink: 0,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: lightColors.muted,
  },
});

const darkStyles = StyleSheet.create({
  safeArea: { backgroundColor: '#0b141a' },
  container: { backgroundColor: '#0b141a' },
  header: {
    backgroundColor: '#111b21',
    borderColor: '#223244',
  },
  title: {
    color: '#8fb6ff',
  },
  subtitle: {
    color: '#9eb4ca',
  },
  switchText: {
    color: '#e6edf4',
  },
  adminButton: {
    borderColor: '#34506f',
    backgroundColor: '#132b44',
  },
  adminButtonText: {
    color: '#c5daff',
  },
  onlineBadge: {
    color: '#73c1ff',
    backgroundColor: '#16334f',
  },
  offlineBadge: {
    color: '#ffaf8f',
    backgroundColor: '#462821',
  },
  logoutButton: {
    borderColor: '#34506f',
    backgroundColor: '#132b44',
  },
  logoutButtonText: {
    color: '#c5daff',
  },
  loadingText: {
    color: '#9eb4ca',
  },
  softLoadingChip: {
    borderColor: '#29435c',
    backgroundColor: 'rgba(17,27,33,0.94)',
  },
  softLoadingText: {
    color: '#9dc5ff',
  },
  ticketItem: {
    backgroundColor: '#111b21',
    borderColor: '#223244',
  },
  avatarWrap: {
    backgroundColor: '#20364a',
  },
  avatarLetter: {
    color: '#c5daf3',
  },
  ticketName: {
    color: '#e9edef',
  },
  ticketPhoneDivider: {
    color: '#8fa4bc',
  },
  ticketPhoneInline: {
    color: '#a1b5cb',
  },
  ticketTime: {
    color: '#a1b5cb',
  },
  ticketDate: {
    color: '#a1b5cb',
  },
  emptyText: {
    color: '#a1b5cb',
  },
});
