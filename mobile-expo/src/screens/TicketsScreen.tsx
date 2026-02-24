import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatTime } from '../lib/date';
import { resolveMediaUrl } from '../lib/media';
import type { RootStackParamList } from '../types/navigation';
import type { Ticket } from '../types/chat';
import { colors } from '../theme';

type TicketsScreenProps = NativeStackScreenProps<RootStackParamList, 'Tickets'>;

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em atendimento';
  if (status === 'resolvido') return 'Resolvido';
  return 'Encerrado';
}

function statusBadgeStyle(status: Ticket['status']) {
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
  return (base.charAt(0) || '?').toUpperCase();
}

export function TicketsScreen({ navigation }: TicketsScreenProps) {
  const { session, signOut } = useAppSession();

  const [includeClosed, setIncludeClosed] = useState(false);
  const [connectionOnline, setConnectionOnline] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  const loadConnection = useCallback(async () => {
    try {
      const state = await getConnectionStatus();
      setConnectionOnline(!!state.connected);
    } catch (_) {
      setConnectionOnline(false);
    }
  }, []);

  const loadTickets = useCallback(async (silent = false) => {
    if (!session) return;
    if (!silent) setLoading(true);

    try {
      const list = await listTickets({
        userType: session.userType,
        userId: session.userId,
        includeClosed,
      });
      setTickets(list);
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar conversas.';
        if (error instanceof ApiRequestError && error.status === 401) {
          await signOut();
          return;
        }
        console.warn(message);
      }
    } finally {
      if (!silent) setLoading(false);
      if (silent) setRefreshing(false);
    }
  }, [includeClosed, session, signOut]);

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

  const missingAvatars = useMemo(() => {
    const pending: string[] = [];
    for (const ticket of tickets) {
      const phone = String(ticket.phone || '').trim();
      if (!phone) continue;
      if (avatars[phone]) continue;
      pending.push(phone);
    }
    return pending;
  }, [avatars, tickets]);

  useEffect(() => {
    let disposed = false;
    if (!missingAvatars.length) return;

    (async () => {
      for (const phone of missingAvatars) {
        if (disposed) return;
        try {
          const response = await fetchProfilePicture(phone);
          const url = resolveMediaUrl(String(response?.url || '').trim());
          if (!url) continue;
          setAvatars((current) => {
            if (current[phone] === url) return current;
            return { ...current, [phone]: url };
          });
        } catch (_) {}
      }
    })();

    return () => {
      disposed = true;
    };
  }, [missingAvatars]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadTickets(true);
  }, [loadTickets]);

  if (!session) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Conversas</Text>
          <Text style={styles.subtitle}>Logado como {session.userName}</Text>

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

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Carregando conversas...</Text>
          </View>
        ) : (
          <FlatList
            data={tickets}
            keyExtractor={(item) => String(item.id)}
            refreshing={refreshing}
            onRefresh={onRefresh}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const avatarUrl = avatars[item.phone] || null;
              const badge = statusBadgeStyle(item.status);

              return (
                <Pressable
                  style={styles.ticketItem}
                  onPress={() => navigation.navigate('Chat', { ticket: item })}
                >
                  <View style={styles.avatarWrap}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                    ) : (
                      <Text style={styles.avatarLetter}>{avatarLetter(item)}</Text>
                    )}
                  </View>

                  <View style={styles.ticketMain}>
                    <View style={styles.ticketTopRow}>
                      <Text numberOfLines={1} style={styles.ticketName}>{item.contact_name || item.phone}</Text>
                      <Text style={styles.ticketTime}>{formatTime(item.updated_at)}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.ticketPhone}>{item.phone}</Text>
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
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  title: {
    color: colors.primaryStrong,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
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
    color: colors.text,
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
    color: colors.primaryStrong,
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
    color: colors.primaryStrong,
    fontWeight: '700',
    fontSize: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
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
  },
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  ticketName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  ticketTime: {
    color: colors.muted,
    fontSize: 12,
  },
  ticketPhone: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 6,
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
    color: colors.muted,
  },
});
