import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  addBlacklist,
  assignTicket,
  createSeller,
  getAwaitConfig,
  getBusinessHours,
  getBusinessMessage,
  getWelcomeMessage,
  getRanking,
  listAdminTickets,
  listAssignees,
  listBlacklist,
  listUsers,
  removeBlacklist,
  saveAwaitConfig,
  saveBusinessHours,
  saveBusinessMessage,
  saveWelcomeMessage,
  updateSeller,
} from '../api/admin';
import { ApiRequestError } from '../api/client';
import { useAppSession } from '../context/AppSessionContext';
import { useAppTheme } from '../context/AppThemeContext';
import { todayIsoDate } from '../lib/date';
import { mergeThemedStyles } from '../lib/themeStyles';
import type { RootStackParamList } from '../types/navigation';
import type {
  AdminSectionKey,
  AdminTicket,
  AdminUser,
  Assignee,
  AwaitConfig,
  BlacklistEntry,
  BusinessHour,
  BusinessMessage,
  RankingSeller,
  WelcomeMessage,
} from '../types/admin';
import type { Ticket as ChatTicket, TicketStatus } from '../types/chat';
import { lightColors } from '../theme';

type AdminScreenProps = NativeStackScreenProps<RootStackParamList, 'Admin'>;

const SECTION_TITLE: Record<AdminSectionKey, string> = {
  users: 'Usuários e papéis',
  tickets: 'Todos os tickets',
  blacklist: 'Blacklist',
  hours: 'Horário comercial',
  welcome: 'Boas-vindas',
  await: 'Aguardando automático',
  ranking: 'Ranking',
};

const SECTION_META: Record<AdminSectionKey, {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  users: {
    title: 'Usuários e papéis',
    subtitle: 'Crie vendedores e gerencie permissões da equipe.',
    icon: 'people-outline',
  },
  tickets: {
    title: 'Todos os tickets',
    subtitle: 'Busque, filtre e abra conversas rapidamente.',
    icon: 'git-compare-outline',
  },
  blacklist: {
    title: 'Blacklist',
    subtitle: 'Bloqueie números e registre motivos de restrição.',
    icon: 'ban-outline',
  },
  hours: {
    title: 'Horário comercial',
    subtitle: 'Defina funcionamento e mensagem fora de horário.',
    icon: 'time-outline',
  },
  welcome: {
    title: 'Boas-vindas',
    subtitle: 'Mensagem automática enviada durante o horário comercial.',
    icon: 'hand-left-outline',
  },
  await: {
    title: 'Aguardando automático',
    subtitle: 'Defina quando tickets sem ação mudam para aguardando.',
    icon: 'hourglass-outline',
  },
  ranking: {
    title: 'Ranking',
    subtitle: 'Acompanhe desempenho por período da operação.',
    icon: 'trophy-outline',
  },
};

const DAY_LABEL: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
};

function formatAdminTicketStatus(status: string): string {
  const normalized = normalizeTicketStatus(status);
  if (normalized === 'em_atendimento') return 'Em atendimento';
  if (normalized === 'aguardando') return 'Aguardando';
  if (normalized === 'pendente') return 'Pendente';
  if (normalized === 'resolvido') return 'Resolvido';
  if (normalized === 'encerrado') return 'Encerrado';
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Sem status';
}

function normalizeTicketStatus(status: unknown): string {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  if (normalized === 'em_atendimento' || normalized === 'ematendimento') return 'em_atendimento';
  if (normalized === 'aguardando') return 'aguardando';
  if (normalized === 'pendente') return 'pendente';
  if (normalized === 'resolvido') return 'resolvido';
  if (normalized === 'encerrado') return 'encerrado';
  return normalized;
}

function normalizeChatTicketStatus(status: string): TicketStatus {
  const normalized = normalizeTicketStatus(status);
  if (normalized === 'pendente') return 'pendente';
  if (normalized === 'aguardando') return 'aguardando';
  if (normalized === 'em_atendimento') return 'em_atendimento';
  if (normalized === 'resolvido') return 'resolvido';
  return 'encerrado';
}

function adminTicketDateKey(ticket: AdminTicket): string {
  const row = ticket as unknown as Record<string, unknown>;
  const updated = String(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt ?? '').trim();
  if (!updated) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(updated)) return updated.slice(0, 10);
  const parsed = Date.parse(updated.replace(' ', 'T'));
  if (!Number.isFinite(parsed)) return '';
  const d = new Date(parsed);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function adminTicketSellerId(ticket: AdminTicket): number | null {
  const row = ticket as unknown as Record<string, unknown>;
  const raw = row.seller_id ?? row.sellerId ?? row.assigned_to ?? row.assignedTo ?? null;
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function userInitial(name: string): string {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  return clean.charAt(0).toUpperCase();
}

function defaultPeriod() {
  const endDate = todayIsoDate();
  const end = new Date(endDate + 'T00:00:00');
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, '0');
  const dd = String(start.getDate()).padStart(2, '0');
  const startDate = `${yyyy}-${mm}-${dd}`;
  return { startDate, endDate };
}

function parseSellerFilterValue(value: string): number | null | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  if (normalized === '__unassigned__') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

type DatePickerTarget = 'ticketsStart' | 'ticketsEnd' | 'rankingStart' | 'rankingEnd';

function isoDateToLocalDate(value: string | null | undefined): Date {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

function localDateToIso(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatIsoDateBr(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '--/--/----';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = String(value || '').split(':');
  const hh = Number(hours);
  const mm = Number(minutes);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return -1;
  return (hh * 60) + mm;
}

function normalizeBusinessTime(value: string | null | undefined): string | null {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;

  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2]);
    const period = String(ampmMatch[3] || '').toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
      return null;
    }
    if (hours < 1 || hours > 12) return null;
    if (period === 'AM') {
      if (hours === 12) hours = 0;
    } else if (period === 'PM') {
      if (hours !== 12) hours += 12;
    }
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const h24Match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!h24Match) return null;
  const hours = Number(h24Match[1]);
  const minutes = Number(h24Match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function validateBusinessHoursPayload(hours: BusinessHour[]): {
  ok: boolean;
  message?: string;
  value?: BusinessHour[];
} {
  const normalizedDays = [...hours]
    .sort((a, b) => Number(a.day) - Number(b.day))
    .map((day) => {
      const open = normalizeBusinessTime(day.open_time);
      const close = normalizeBusinessTime(day.close_time);
      return {
        ...day,
        day: Number(day.day),
        open_time: open,
        close_time: close,
        enabled: !!day.enabled,
      };
    });

  for (const day of normalizedDays) {
    if (!day.enabled) continue;
    const dayLabel = DAY_LABEL[day.day] || `Dia ${day.day}`;
    if (!day.open_time || !day.close_time) {
      return {
        ok: false,
        message: `${dayLabel}: preencha abertura e fechamento em formato válido (HH:MM).`,
      };
    }
    const openMinutes = parseTimeToMinutes(day.open_time);
    const closeMinutes = parseTimeToMinutes(day.close_time);
    if (openMinutes < 0 || closeMinutes < 0 || openMinutes >= closeMinutes) {
      return {
        ok: false,
        message: `${dayLabel}: horário de abertura deve ser menor que o de fechamento.`,
      };
    }
  }

  return {
    ok: true,
    value: normalizedDays,
  };
}

export function AdminScreen({ navigation }: AdminScreenProps) {
  const { session, signOut } = useAppSession();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => mergeThemedStyles(lightStyles, darkStyles, isDark), [isDark]);
  const accentIconColor = isDark ? '#8fb6ff' : '#1f66d6';

  const [activeSection, setActiveSection] = useState<AdminSectionKey>('users');
  const [loading, setLoading] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerPassword, setNewSellerPassword] = useState('');

  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [ticketFilters, setTicketFilters] = useState(() => {
    const range = defaultPeriod();
    return {
      sellerId: '',
      status: '',
      startDate: range.startDate,
      endDate: range.endDate,
    };
  });

  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [blacklistPhone, setBlacklistPhone] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');

  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [businessMessage, setBusinessMessage] = useState<BusinessMessage>({ message: '', enabled: false });
  const [welcomeMessage, setWelcomeMessage] = useState<WelcomeMessage>({ message: '', enabled: true });

  const [awaitConfig, setAwaitConfig] = useState<AwaitConfig>({ minutes: 15 });

  const [ranking, setRanking] = useState<RankingSeller[]>([]);
  const [period, setPeriod] = useState(defaultPeriod());
  const [datePicker, setDatePicker] = useState<{
    visible: boolean;
    target: DatePickerTarget | null;
    draft: Date;
  }>({
    visible: false,
    target: null,
    draft: new Date(),
  });

  const ensureAdmin = useMemo(() => session?.userType === 'admin', [session?.userType]);

  const withAuthGuard = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        await signOut();
        return;
      }
      const message = error instanceof Error ? error.message : 'Falha na operacao.';
      Alert.alert('Erro', message);
    }
  }, [signOut]);

  const refreshUsers = useCallback(async () => {
    const list = await listUsers();
    setUsers(list);
  }, []);

  const refreshTickets = useCallback(async () => {
    const hasInvalidRange = (
      ticketFilters.startDate
      && ticketFilters.endDate
      && ticketFilters.startDate > ticketFilters.endDate
    );

    const [ticketList, assigneesList] = await Promise.all([
      listAdminTickets({
        sellerId: parseSellerFilterValue(ticketFilters.sellerId),
        status: ticketFilters.status || undefined,
        startDate: hasInvalidRange ? undefined : (ticketFilters.startDate || undefined),
        endDate: hasInvalidRange ? undefined : (ticketFilters.endDate || undefined),
      }),
      listAssignees(),
    ]);
    setTickets(ticketList);
    setAssignees(assigneesList);
  }, [ticketFilters.endDate, ticketFilters.sellerId, ticketFilters.startDate, ticketFilters.status]);

  const refreshBlacklist = useCallback(async () => {
    const list = await listBlacklist();
    setBlacklist(list);
  }, []);

  const refreshHours = useCallback(async () => {
    const [hoursList, message] = await Promise.all([getBusinessHours(), getBusinessMessage()]);
    setHours(hoursList);
    setBusinessMessage(message);
  }, []);

  const refreshWelcome = useCallback(async () => {
    const response = await getWelcomeMessage();
    setWelcomeMessage(response);
  }, []);

  const refreshAwait = useCallback(async () => {
    const config = await getAwaitConfig();
    setAwaitConfig(config);
  }, []);

  const refreshRanking = useCallback(async () => {
    const response = await getRanking(period.startDate, period.endDate);
    setRanking(response.ranking || []);
  }, [period.endDate, period.startDate]);

  useEffect(() => {
    if (!ensureAdmin) return;

    const load = async () => {
      setLoading(true);
      await withAuthGuard(async () => {
        if (activeSection === 'users') {
          await refreshUsers();
          return;
        }
        if (activeSection === 'tickets') {
          await refreshTickets();
          return;
        }
        if (activeSection === 'blacklist') {
          await refreshBlacklist();
          return;
        }
        if (activeSection === 'hours') {
          await refreshHours();
          return;
        }
        if (activeSection === 'welcome') {
          await refreshWelcome();
          return;
        }
        if (activeSection === 'await') {
          await refreshAwait();
          return;
        }
        await refreshRanking();
      });
      setLoading(false);
    };

    void load();
  }, [activeSection, ensureAdmin, refreshAwait, refreshBlacklist, refreshHours, refreshRanking, refreshTickets, refreshUsers, refreshWelcome, withAuthGuard]);

  const applyTicketFilters = useCallback(() => {
    void withAuthGuard(async () => {
      if (ticketFilters.startDate && ticketFilters.endDate && ticketFilters.startDate > ticketFilters.endDate) {
        Alert.alert('Filtro inválido', 'A data inicial não pode ser maior que a data final.');
        return;
      }
      await refreshTickets();
    });
  }, [refreshTickets, ticketFilters.endDate, ticketFilters.startDate, withAuthGuard]);

  const openTicketConversation = useCallback((item: AdminTicket) => {
    const ticket: ChatTicket = {
      id: Number(item.id),
      phone: String(item.phone || ''),
      contact_name: item.contact_name || null,
      seller_id: item.seller_id != null ? Number(item.seller_id) : null,
      seller_name: item.seller_name || null,
      status: normalizeChatTicketStatus(item.status),
      updated_at: String(item.updated_at || new Date().toISOString()),
      created_at: String(item.updated_at || new Date().toISOString()),
    };
    navigation.navigate('Chat', { ticket });
  }, [navigation]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((item) => {
      if (ticketFilters.status && normalizeTicketStatus(item.status) !== ticketFilters.status) {
        return false;
      }

      if (ticketFilters.sellerId) {
        const sellerId = adminTicketSellerId(item);
        if (ticketFilters.sellerId === '__unassigned__') {
          if (sellerId != null) return false;
        } else if (Number(ticketFilters.sellerId) !== Number(sellerId)) {
          return false;
        }
      }

      const dateKey = adminTicketDateKey(item);
      if (ticketFilters.startDate && dateKey && dateKey < ticketFilters.startDate) return false;
      if (ticketFilters.endDate && dateKey && dateKey > ticketFilters.endDate) return false;
      return true;
    });
  }, [ticketFilters.endDate, ticketFilters.sellerId, ticketFilters.startDate, ticketFilters.status, tickets]);

  const setDateForTarget = useCallback((target: DatePickerTarget, dateValue: Date) => {
    const iso = localDateToIso(dateValue);
    if (target === 'ticketsStart') {
      setTicketFilters((current) => ({ ...current, startDate: iso }));
      return;
    }
    if (target === 'ticketsEnd') {
      setTicketFilters((current) => ({ ...current, endDate: iso }));
      return;
    }
    if (target === 'rankingStart') {
      setPeriod((current) => ({ ...current, startDate: iso }));
      return;
    }
    setPeriod((current) => ({ ...current, endDate: iso }));
  }, []);

  const openDatePicker = useCallback((target: DatePickerTarget, currentIso: string) => {
    setDatePicker({
      visible: true,
      target,
      draft: isoDateToLocalDate(currentIso),
    });
  }, []);

  const closeDatePicker = useCallback(() => {
    setDatePicker((current) => ({ ...current, visible: false, target: null }));
  }, []);

  const handleDatePickerChange = useCallback((event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) {
      if (Platform.OS === 'android') closeDatePicker();
      return;
    }

    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        closeDatePicker();
        return;
      }
      const target = datePicker.target;
      if (target) {
        setDateForTarget(target, selectedDate);
      }
      closeDatePicker();
      return;
    }

    setDatePicker((current) => ({ ...current, draft: selectedDate }));
  }, [closeDatePicker, datePicker.target, setDateForTarget]);

  const confirmDatePicker = useCallback(() => {
    const target = datePicker.target;
    if (!target) {
      closeDatePicker();
      return;
    }
    setDateForTarget(target, datePicker.draft);
    closeDatePicker();
  }, [closeDatePicker, datePicker.draft, datePicker.target, setDateForTarget]);

  if (!session) return null;

  if (!ensureAdmin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.deniedWrap}>
          <Text style={styles.deniedTitle}>Acesso negado</Text>
          <Text style={styles.deniedText}>Apenas administradores podem abrir o painel.</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryButtonText}>Voltar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={styles.title}>AutoZap</Text>
            <Text style={styles.subtitle}>Painel administrativo</Text>
            <Text style={styles.headerMeta}>Administrador: {session.userName}</Text>
          </View>

          <View style={styles.headerButtons}>
            <Pressable style={styles.headerButton} onPress={() => navigation.goBack()}>
              <Text style={styles.headerButtonText}>Atendimento</Text>
            </Pressable>
            <Pressable style={styles.headerButton} onPress={() => void signOut()}>
              <Text style={styles.headerButtonText}>Sair</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.tabWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {(Object.keys(SECTION_TITLE) as AdminSectionKey[]).map((section) => {
              const meta = SECTION_META[section];
              return (
              <Pressable
                key={section}
                onPress={() => setActiveSection(section)}
                style={[styles.tabButton, activeSection === section ? styles.tabButtonActive : null]}
              >
                <View style={[styles.tabIconWrap, activeSection === section ? styles.tabIconWrapActive : null]}>
                  <Ionicons
                    name={meta.icon}
                    size={14}
                    style={[styles.tabIcon, activeSection === section ? styles.tabIconActive : null]}
                  />
                </View>
                <Text style={[styles.tabButtonText, activeSection === section ? styles.tabButtonTextActive : null]}>
                  {meta.title}
                </Text>
              </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>Módulo administrativo</Text>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name={SECTION_META[activeSection].icon} size={18} color={accentIconColor} />
            </View>
            <Text style={styles.sectionTitle}>{SECTION_META[activeSection].title}</Text>
          </View>
          <Text style={styles.sectionSubtitle}>{SECTION_META[activeSection].subtitle}</Text>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Carregando...</Text>
          </View>
        ) : null}

        {!loading && activeSection === 'users' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="person-add-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Novo vendedor</Text>
                  <Text style={styles.cardDescription}>Crie um usuário para atendimento e distribuição de tickets.</Text>
                </View>
              </View>
              <Text style={styles.fieldLabel}>Usuário</Text>
              <TextInput
                style={styles.input}
                placeholder="Usuario"
                placeholderTextColor="#8ea0b8"
                value={newSellerName}
                onChangeText={setNewSellerName}
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Senha inicial</Text>
              <TextInput
                style={styles.input}
                placeholder="Senha"
                placeholderTextColor="#8ea0b8"
                value={newSellerPassword}
                onChangeText={setNewSellerPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const sellerName = newSellerName.trim();
                    const sellerPassword = newSellerPassword.trim();
                    if (sellerName.length < 3) {
                      Alert.alert('Validação', 'Informe um usuário com pelo menos 3 caracteres.');
                      return;
                    }
                    if (sellerPassword.length < 6) {
                      Alert.alert('Validação', 'A senha inicial deve ter pelo menos 6 caracteres.');
                      return;
                    }
                    await createSeller({ name: sellerName, password: sellerPassword });
                    setNewSellerName('');
                    setNewSellerPassword('');
                    await refreshUsers();
                    Alert.alert('Sucesso', 'Vendedor criado.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Criar vendedor</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="people-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Usuários cadastrados</Text>
                  <Text style={styles.cardDescription}>Ative ou desative vendedores e acompanhe os papéis.</Text>
                </View>
              </View>
              {users.map((user) => (
                <View key={String(user.id)} style={styles.userRow}>
                  <View style={styles.userIdentity}>
                    <View style={styles.userAvatar}>
                      <Text style={styles.userAvatarText}>{userInitial(user.name)}</Text>
                    </View>

                    <View style={styles.listInfo}>
                      <Text style={styles.listTitle}>{user.name}</Text>
                      <View style={styles.userBadgeRow}>
                        {user.isAdmin ? (
                          <View style={[styles.userBadge, styles.userBadgeAdmin]}>
                            <Text style={[styles.userBadgeText, styles.userBadgeTextAdmin]}>Admin</Text>
                          </View>
                        ) : null}
                        {user.isSeller ? (
                          <View style={[styles.userBadge, user.sellerActive ? styles.userBadgeSeller : styles.userBadgeSellerInactive]}>
                            <Text
                              style={[
                                styles.userBadgeText,
                                user.sellerActive ? styles.userBadgeTextSeller : styles.userBadgeTextSellerInactive,
                              ]}
                            >
                              {user.sellerActive ? 'Vendedor ativo' : 'Vendedor inativo'}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.userBadge}>
                            <Text style={styles.userBadgeText}>Sem papel vendedor</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>

                  {user.isSeller ? (
                    <View style={styles.userSwitchWrap}>
                      <Text style={styles.userSwitchLabel}>{user.sellerActive ? 'Ativo' : 'Inativo'}</Text>
                      <Switch
                        value={user.sellerActive}
                        onValueChange={(nextValue) => {
                          const sellerId = Number(user.id);
                          if (!Number.isFinite(sellerId)) return;
                          void withAuthGuard(async () => {
                            await updateSeller(sellerId, { active: nextValue });
                            await refreshUsers();
                          });
                        }}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
              {!users.length ? (
                <Text style={styles.emptyStateText}>Nenhum usuário encontrado.</Text>
              ) : null}
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'tickets' ? (
          <FlatList
            style={styles.sectionBody}
            contentContainerStyle={styles.sectionBodyContent}
            keyExtractor={(item) => String(item.id)}
            initialNumToRender={14}
            maxToRenderPerBatch={14}
            windowSize={11}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={(
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderIcon}>
                    <Ionicons name="options-outline" size={16} color={accentIconColor} />
                  </View>
                  <View style={styles.cardHeaderTextWrap}>
                    <Text style={styles.cardTitle}>Filtros de tickets</Text>
                    <Text style={styles.cardDescription}>Filtre por vendedor e período para pesquisar a fila completa.</Text>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Vendedor</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                  <Pressable
                    style={[
                      styles.filterChip,
                      !ticketFilters.sellerId ? styles.filterChipActive : null,
                    ]}
                    onPress={() => setTicketFilters((current) => ({ ...current, sellerId: '' }))}
                  >
                    <Text style={[styles.filterChipText, !ticketFilters.sellerId ? styles.filterChipTextActive : null]}>
                      Todos
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.filterChip,
                      ticketFilters.sellerId === '__unassigned__' ? styles.filterChipActive : null,
                    ]}
                    onPress={() => setTicketFilters((current) => ({ ...current, sellerId: '__unassigned__' }))}
                  >
                    <Text style={[styles.filterChipText, ticketFilters.sellerId === '__unassigned__' ? styles.filterChipTextActive : null]}>
                      Não atribuídos
                    </Text>
                  </Pressable>
                  {assignees.map((assignee) => (
                    <Pressable
                      key={`seller-filter-${assignee.id}`}
                      style={[
                        styles.filterChip,
                        ticketFilters.sellerId === String(assignee.id) ? styles.filterChipActive : null,
                      ]}
                      onPress={() => setTicketFilters((current) => ({ ...current, sellerId: String(assignee.id) }))}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          ticketFilters.sellerId === String(assignee.id) ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {assignee.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={styles.fieldLabel}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                  <Pressable
                    style={[
                      styles.filterChip,
                      !ticketFilters.status ? styles.filterChipActive : null,
                    ]}
                    onPress={() => setTicketFilters((current) => ({ ...current, status: '' }))}
                  >
                    <Text style={[styles.filterChipText, !ticketFilters.status ? styles.filterChipTextActive : null]}>
                      Todos
                    </Text>
                  </Pressable>
                  {[
                    ['pendente', 'Pendente'],
                    ['aguardando', 'Aguardando'],
                    ['em_atendimento', 'Em atendimento'],
                    ['resolvido', 'Resolvido'],
                    ['encerrado', 'Encerrado'],
                  ].map(([value, label]) => (
                    <Pressable
                      key={`status-filter-${value}`}
                      style={[
                        styles.filterChip,
                        ticketFilters.status === value ? styles.filterChipActive : null,
                      ]}
                      onPress={() => setTicketFilters((current) => ({ ...current, status: value }))}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          ticketFilters.status === value ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.filterDatesRow}>
                  <View style={styles.filterDateCol}>
                    <Text style={styles.fieldLabel}>Data inicial</Text>
                    <Pressable
                      style={styles.dateFieldButton}
                      onPress={() => openDatePicker('ticketsStart', ticketFilters.startDate)}
                    >
                      <Ionicons name="calendar-outline" size={15} style={styles.dateFieldIcon} />
                      <Text style={styles.dateFieldText}>{formatIsoDateBr(ticketFilters.startDate)}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.filterDateCol}>
                    <Text style={styles.fieldLabel}>Data final</Text>
                    <Pressable
                      style={styles.dateFieldButton}
                      onPress={() => openDatePicker('ticketsEnd', ticketFilters.endDate)}
                    >
                      <Ionicons name="calendar-outline" size={15} style={styles.dateFieldIcon} />
                      <Text style={styles.dateFieldText}>{formatIsoDateBr(ticketFilters.endDate)}</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.inlineActions}>
                  <Pressable style={styles.primaryButton} onPress={applyTicketFilters}>
                    <Text style={styles.primaryButtonText}>Aplicar filtros</Text>
                  </Pressable>
                  <Text style={styles.filterCounter}>{filteredTickets.length} ticket(s)</Text>
                </View>
              </View>
            )}
            data={filteredTickets}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Pressable style={styles.ticketTopRow} onPress={() => openTicketConversation(item)}>
                  <View style={styles.listInfo}>
                    <Text style={styles.listTitle}>{item.contact_name || item.phone}</Text>
                    <Text style={styles.listSubtitle}>{item.phone}</Text>
                  </View>
                  <View style={styles.ticketStatusBadge}>
                    <Text style={styles.ticketStatusText}>{formatAdminTicketStatus(item.status)}</Text>
                  </View>
                </Pressable>
                <Text style={styles.listSubtitle}>Responsável atual: {item.seller_name || 'Não atribuído'}</Text>

                <View style={styles.actionRow}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => openTicketConversation(item)}
                  >
                    <Text style={styles.secondaryButtonText}>Abrir chat</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => {
                      void withAuthGuard(async () => {
                        await assignTicket(item.id, null);
                        await refreshTickets();
                      });
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Desatribuir</Text>
                  </Pressable>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assigneeRow}>
                  <Text style={styles.fieldLabel}>Atribuir para:</Text>
                  {assignees.map((assignee) => (
                    <Pressable
                      key={String(assignee.id)}
                      style={[
                        styles.assigneeButton,
                        item.seller_id === assignee.id ? styles.assigneeButtonActive : null,
                      ]}
                      onPress={() => {
                        void withAuthGuard(async () => {
                          await assignTicket(item.id, assignee.id);
                          await refreshTickets();
                        });
                      }}
                    >
                      <Text
                        style={[
                          styles.assigneeButtonText,
                          item.seller_id === assignee.id ? styles.assigneeButtonTextActive : null,
                        ]}
                      >
                        {assignee.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            ListEmptyComponent={(
              <View style={styles.card}>
                <Text style={styles.emptyStateText}>Nenhum ticket encontrado.</Text>
              </View>
            )}
          />
        ) : null}

        {!loading && activeSection === 'blacklist' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="ban-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Adicionar número</Text>
                  <Text style={styles.cardDescription}>Bloqueie contatos com motivo para auditoria da operação.</Text>
                </View>
              </View>
              <Text style={styles.fieldLabel}>Telefone com DDI</Text>
              <TextInput
                style={styles.input}
                placeholder="Telefone com DDI"
                placeholderTextColor="#8ea0b8"
                value={blacklistPhone}
                onChangeText={setBlacklistPhone}
                keyboardType="phone-pad"
              />
              <Text style={styles.fieldLabel}>Motivo</Text>
              <TextInput
                style={styles.input}
                placeholder="Motivo"
                placeholderTextColor="#8ea0b8"
                value={blacklistReason}
                onChangeText={setBlacklistReason}
              />
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const normalizedPhone = blacklistPhone.replace(/\D/g, '');
                    if (normalizedPhone.length < 10) {
                      Alert.alert('Validação', 'Informe um telefone válido com DDI.');
                      return;
                    }
                    await addBlacklist({
                      phone: normalizedPhone,
                      reason: blacklistReason.trim() || undefined,
                    });
                    setBlacklistPhone('');
                    setBlacklistReason('');
                    await refreshBlacklist();
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Adicionar</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Números bloqueados</Text>
                  <Text style={styles.cardDescription}>Remova bloqueios quando o contato voltar a ser permitido.</Text>
                </View>
              </View>
              {blacklist.map((entry) => (
                <View key={entry.phone} style={styles.listRow}>
                  <View style={styles.listInfo}>
                    <Text style={styles.listTitle}>{entry.phone}</Text>
                    <Text style={styles.listSubtitle}>{entry.reason || 'Sem motivo'}</Text>
                  </View>
                  <Pressable
                    style={styles.dangerButton}
                    onPress={() => {
                      void withAuthGuard(async () => {
                        await removeBlacklist(entry.phone);
                        await refreshBlacklist();
                      });
                    }}
                  >
                    <Text style={styles.dangerButtonText}>Remover</Text>
                  </Pressable>
                </View>
              ))}
              {!blacklist.length ? (
                <Text style={styles.emptyStateText}>Nenhum número bloqueado.</Text>
              ) : null}
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'hours' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="time-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Horário por dia</Text>
                  <Text style={styles.cardDescription}>Ative o dia e defina abertura/fechamento no formato 24h.</Text>
                </View>
              </View>
              {hours.map((day) => (
                <View key={day.day} style={styles.dayRow}>
                  <Text style={styles.dayLabel}>{DAY_LABEL[day.day] || String(day.day)}</Text>
                  <Switch
                    value={!!day.enabled}
                    onValueChange={(value) => {
                      setHours((current) => current.map((item) => (
                        item.day === day.day ? { ...item, enabled: value } : item
                      )));
                    }}
                  />
                  <TextInput
                    style={styles.timeInput}
                    value={String(day.open_time || '')}
                    placeholder="08:00"
                    placeholderTextColor="#8ea0b8"
                    onChangeText={(value) => {
                      setHours((current) => current.map((item) => (
                        item.day === day.day ? { ...item, open_time: value } : item
                      )));
                    }}
                  />
                  <TextInput
                    style={styles.timeInput}
                    value={String(day.close_time || '')}
                    placeholder="18:00"
                    placeholderTextColor="#8ea0b8"
                    onChangeText={(value) => {
                      setHours((current) => current.map((item) => (
                        item.day === day.day ? { ...item, close_time: value } : item
                      )));
                    }}
                  />
                </View>
              ))}

              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const validation = validateBusinessHoursPayload(hours);
                    if (!validation.ok || !validation.value) {
                      Alert.alert('Validação', validation.message || 'Revise os horários preenchidos.');
                      return;
                    }
                    await saveBusinessHours(validation.value);
                    setHours(validation.value);
                    Alert.alert('Sucesso', 'Horário salvo.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Salvar horário</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="chatbox-ellipses-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Mensagem fora do horário</Text>
                  <Text style={styles.cardDescription}>Texto automático enviado quando o atendimento estiver fechado.</Text>
                </View>
              </View>
              <View style={styles.inlineRow}>
                <Text style={styles.listSubtitle}>Ativa</Text>
                <Switch
                  value={businessMessage.enabled}
                  onValueChange={(value) => setBusinessMessage((current) => ({ ...current, enabled: value }))}
                />
              </View>

              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={businessMessage.message}
                onChangeText={(value) => setBusinessMessage((current) => ({ ...current, message: value }))}
                multiline
                placeholder="Mensagem enviada fora do horario"
                placeholderTextColor="#8ea0b8"
              />

              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const nextMessage = String(businessMessage.message || '').trim();
                    if (businessMessage.enabled && !nextMessage) {
                      Alert.alert('Validação', 'Informe a mensagem fora do horário ou desative o envio.');
                      return;
                    }
                    await saveBusinessMessage({
                      message: nextMessage,
                      enabled: businessMessage.enabled,
                    });
                    setBusinessMessage((current) => ({ ...current, message: nextMessage }));
                    Alert.alert('Sucesso', 'Mensagem atualizada.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Salvar mensagem</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'welcome' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="hand-left-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Mensagem automática de boas-vindas</Text>
                  <Text style={styles.cardDescription}>Enviada quando o cliente inicia conversa dentro do horário comercial.</Text>
                </View>
              </View>

              <View style={styles.inlineRow}>
                <Text style={styles.listSubtitle}>Ativa</Text>
                <Switch
                  value={welcomeMessage.enabled}
                  onValueChange={(value) => setWelcomeMessage((current) => ({ ...current, enabled: value }))}
                />
              </View>

              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={welcomeMessage.message}
                onChangeText={(value) => setWelcomeMessage((current) => ({ ...current, message: value }))}
                multiline
                placeholder="Mensagem automática de boas-vindas"
                placeholderTextColor="#8ea0b8"
              />

              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const nextMessage = String(welcomeMessage.message || '').trim();
                    if (welcomeMessage.enabled && !nextMessage) {
                      Alert.alert('Validação', 'Informe a mensagem de boas-vindas ou desative o envio.');
                      return;
                    }
                    await saveWelcomeMessage({
                      message: nextMessage,
                      enabled: welcomeMessage.enabled,
                    });
                    setWelcomeMessage((current) => ({ ...current, message: nextMessage }));
                    Alert.alert('Sucesso', 'Mensagem de boas-vindas atualizada.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Salvar mensagem</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'await' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="hourglass-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Aguardando automático</Text>
                  <Text style={styles.cardDescription}>Define em quantos minutos sem ação o ticket muda para aguardando.</Text>
                </View>
              </View>
              <Text style={styles.fieldLabel}>Minutos para transição</Text>
              <TextInput
                style={styles.input}
                value={String(awaitConfig.minutes)}
                onChangeText={(value) => {
                  const numeric = Number(value.replace(/\D/g, ''));
                  setAwaitConfig({ minutes: Number.isFinite(numeric) ? numeric : 0 });
                }}
                keyboardType="number-pad"
              />

              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    const minutes = Math.max(1, Number(awaitConfig.minutes || 0));
                    if (!Number.isFinite(minutes) || minutes > (24 * 60)) {
                      Alert.alert('Validação', 'Informe um valor entre 1 e 1440 minutos.');
                      return;
                    }
                    await saveAwaitConfig(minutes);
                    setAwaitConfig({ minutes });
                    Alert.alert('Sucesso', 'Configuração salva.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Salvar</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'ranking' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="calendar-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Período</Text>
                  <Text style={styles.cardDescription}>Informe início e fim para atualizar o ranking de desempenho.</Text>
                </View>
              </View>
              <Text style={styles.fieldLabel}>Data inicial</Text>
              <Pressable
                style={styles.dateFieldButton}
                onPress={() => openDatePicker('rankingStart', period.startDate)}
              >
                <Ionicons name="calendar-outline" size={15} style={styles.dateFieldIcon} />
                <Text style={styles.dateFieldText}>{formatIsoDateBr(period.startDate)}</Text>
              </Pressable>
              <Text style={styles.fieldLabel}>Data final</Text>
              <Pressable
                style={styles.dateFieldButton}
                onPress={() => openDatePicker('rankingEnd', period.endDate)}
              >
                <Ionicons name="calendar-outline" size={15} style={styles.dateFieldIcon} />
                <Text style={styles.dateFieldText}>{formatIsoDateBr(period.endDate)}</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    if (period.startDate && period.endDate && period.startDate > period.endDate) {
                      Alert.alert('Filtro inválido', 'A data inicial não pode ser maior que a data final.');
                      return;
                    }
                    await refreshRanking();
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Atualizar ranking</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="trophy-outline" size={16} color={accentIconColor} />
                </View>
                <View style={styles.cardHeaderTextWrap}>
                  <Text style={styles.cardTitle}>Vendedores</Text>
                  <Text style={styles.cardDescription}>Ordem decrescente de tickets resolvidos no período escolhido.</Text>
                </View>
              </View>
              {ranking.map((item, index) => (
                <View key={`${item.seller_id}`} style={styles.listRow}>
                  <View style={styles.rankingPositionWrap}>
                    <Text style={styles.rankingPositionText}>{index + 1}</Text>
                  </View>
                  <View style={styles.listInfo}>
                    <Text style={styles.listTitle}>{item.seller_name}</Text>
                    <Text style={styles.listSubtitle}>{item.tickets_resolved} tickets resolvidos</Text>
                  </View>
                </View>
              ))}
              {!ranking.length ? (
                <Text style={styles.emptyStateText}>Nenhum dado no período informado.</Text>
              ) : null}
            </View>
          </ScrollView>
        ) : null}

        {Platform.OS === 'android' && datePicker.visible ? (
          <DateTimePicker
            value={datePicker.draft}
            mode="date"
            display="calendar"
            onChange={handleDatePickerChange}
          />
        ) : null}

        {Platform.OS !== 'android' ? (
          <Modal
            visible={datePicker.visible}
            transparent
            animationType="fade"
            onRequestClose={closeDatePicker}
          >
            <View style={styles.datePickerOverlay}>
              <View style={styles.datePickerCard}>
                <Text style={styles.datePickerTitle}>Selecionar data</Text>
                <DateTimePicker
                  value={datePicker.draft}
                  mode="date"
                  display="spinner"
                  onChange={handleDatePickerChange}
                />
                <View style={styles.datePickerActions}>
                  <Pressable style={styles.secondaryButton} onPress={closeDatePicker}>
                    <Text style={styles.secondaryButtonText}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.primaryButton} onPress={confirmDatePicker}>
                    <Text style={styles.primaryButtonText}>Confirmar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#eef3fb',
  },
  container: {
    flex: 1,
    backgroundColor: '#eef3fb',
  },
  deniedWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 12,
  },
  deniedTitle: {
    color: '#16335f',
    fontSize: 24,
    fontWeight: '800',
  },
  deniedText: {
    color: '#5f7288',
    textAlign: 'center',
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    marginTop: 10,
    marginHorizontal: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 22,
    backgroundColor: '#0b2f79',
    borderBottomWidth: 1,
    borderColor: '#1f4ca7',
    shadowColor: '#0b2f79',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  title: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#d7e4ff',
    fontSize: 16,
    marginTop: 2,
  },
  headerMeta: {
    color: '#bfd4ff',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  headerButtons: {
    marginLeft: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  headerButton: {
    borderWidth: 1,
    borderColor: '#5b8fe6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerButtonText: {
    color: '#eff5ff',
    fontWeight: '700',
    fontSize: 13,
  },
  tabWrap: {
    marginTop: 10,
    marginHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d6e3f8',
    backgroundColor: '#fff',
  },
  tabRow: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  tabButton: {
    borderWidth: 1,
    borderColor: '#d3e2f8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f4f8ff',
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'center',
  },
  tabButtonActive: {
    borderColor: '#2b6fdb',
    backgroundColor: '#e6efff',
  },
  tabIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f0fe',
  },
  tabIconWrapActive: {
    backgroundColor: '#d5e6ff',
  },
  tabIcon: {
    color: '#4d6f95',
  },
  tabIconActive: {
    color: '#1f66d6',
  },
  tabButtonText: {
    color: '#365170',
    fontWeight: '700',
    fontSize: 11,
  },
  tabButtonTextActive: {
    color: '#0b53c1',
  },
  sectionHeader: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d6e3f8',
    backgroundColor: '#fff',
  },
  sectionEyebrow: {
    color: '#6b829d',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: '#16335f',
    fontSize: 22,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#5f7288',
    marginTop: 6,
    fontSize: 13,
  },
  sectionBody: {
    flex: 1,
  },
  sectionBodyContent: {
    paddingHorizontal: 12,
    paddingBottom: 28,
    paddingTop: 2,
    gap: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#5f7288',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d9e6f9',
    padding: 14,
    gap: 10,
    shadowColor: '#123d88',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 2,
  },
  cardHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: '#16335f',
    fontSize: 17,
    fontWeight: '800',
  },
  cardDescription: {
    color: '#6f839a',
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
  },
  fieldLabel: {
    color: '#4c6786',
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccdcf4',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    color: '#16335f',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  dateFieldButton: {
    borderWidth: 1,
    borderColor: '#ccdcf4',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateFieldIcon: {
    color: '#3e5f85',
  },
  dateFieldText: {
    color: '#16335f',
    fontSize: 16,
    fontWeight: '700',
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f66d6',
    backgroundColor: lightColors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#b7cff5',
    backgroundColor: '#ecf3ff',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: lightColors.primaryStrong,
    fontWeight: '700',
    fontSize: 13,
  },
  dangerButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f2b5b5',
    backgroundColor: '#fff1f1',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dangerButtonText: {
    color: '#b42318',
    fontWeight: '700',
    fontSize: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderColor: '#e7eef8',
    paddingTop: 12,
    paddingBottom: 4,
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
  },
  listTitle: {
    color: '#16335f',
    fontWeight: '700',
    fontSize: 15,
  },
  listSubtitle: {
    color: '#627589',
    fontSize: 12,
  },
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketStatusBadge: {
    borderWidth: 1,
    borderColor: '#d3e2f8',
    backgroundColor: '#eef5ff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ticketStatusText: {
    color: '#285486',
    fontSize: 11,
    fontWeight: '700',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderColor: '#e7eef8',
    paddingTop: 12,
    paddingBottom: 8,
  },
  userIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dce9ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c1d4f4',
  },
  userAvatarText: {
    color: '#234266',
    fontWeight: '800',
    fontSize: 16,
  },
  userBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  userBadge: {
    borderWidth: 1,
    borderColor: '#d3dfef',
    backgroundColor: '#f7faff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  userBadgeAdmin: {
    borderColor: '#e9cf9d',
    backgroundColor: '#fff4dd',
  },
  userBadgeSeller: {
    borderColor: '#bfe0c8',
    backgroundColor: '#e8faee',
  },
  userBadgeSellerInactive: {
    borderColor: '#d6deea',
    backgroundColor: '#f2f5f9',
  },
  userBadgeText: {
    color: '#4d6178',
    fontSize: 11,
    fontWeight: '700',
  },
  userBadgeTextAdmin: {
    color: '#8a5d00',
  },
  userBadgeTextSeller: {
    color: '#14603b',
  },
  userBadgeTextSellerInactive: {
    color: '#59697c',
  },
  userSwitchWrap: {
    alignItems: 'center',
    gap: 2,
    paddingTop: 2,
  },
  userSwitchLabel: {
    color: '#516b86',
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 2,
    paddingRight: 2,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: '#c8daf4',
    backgroundColor: '#f1f7ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: '#2b6fdb',
    backgroundColor: '#deebff',
  },
  filterChipText: {
    color: '#2e557f',
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#0d4ba7',
  },
  filterDatesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterDateCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  filterCounter: {
    color: '#556f8f',
    fontSize: 12,
    fontWeight: '700',
  },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 14, 28, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  datePickerCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#ccdcf4',
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 14,
    gap: 10,
  },
  datePickerTitle: {
    color: '#16335f',
    fontSize: 16,
    fontWeight: '800',
  },
  datePickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    gap: 6,
  },
  assigneeButton: {
    borderWidth: 1,
    borderColor: '#c6d9f7',
    backgroundColor: '#f3f8ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  assigneeButtonActive: {
    borderColor: lightColors.primary,
    backgroundColor: '#dcecff',
  },
  assigneeButtonText: {
    color: lightColors.primaryStrong,
    fontWeight: '700',
    fontSize: 13,
  },
  assigneeButtonTextActive: {
    color: '#0a47a1',
  },
  dayRow: {
    borderTopWidth: 1,
    borderColor: '#e7eef8',
    paddingTop: 10,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayLabel: {
    color: '#16335f',
    fontWeight: '700',
    width: 86,
  },
  timeInput: {
    borderWidth: 1,
    borderColor: '#ccdcf4',
    borderRadius: 10,
    backgroundColor: '#f9fbff',
    color: '#16335f',
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: 78,
    textAlign: 'center',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyStateText: {
    color: '#607388',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 6,
  },
  rankingPositionWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c5d8f7',
    backgroundColor: '#e9f1ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 1,
  },
  rankingPositionText: {
    color: '#2f5c90',
    fontSize: 11,
    fontWeight: '800',
  },
});

const darkStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#0b141a',
  },
  container: {
    backgroundColor: '#0b141a',
  },
  deniedTitle: {
    color: '#d7e4f5',
  },
  deniedText: {
    color: '#9eb4ca',
  },
  header: {
    backgroundColor: '#111b21',
    borderColor: '#223244',
    shadowColor: '#000',
  },
  title: {
    color: '#c5daff',
  },
  subtitle: {
    color: '#9eb4ca',
  },
  headerMeta: {
    color: '#9eb4ca',
  },
  headerButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  headerButtonText: {
    color: '#d6e3f0',
  },
  tabWrap: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  tabButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  tabButtonActive: {
    borderColor: '#4a90ff',
    backgroundColor: '#193a5a',
  },
  tabIconWrap: {
    backgroundColor: '#20364a',
  },
  tabIconWrapActive: {
    backgroundColor: '#244665',
  },
  tabIcon: {
    color: '#9cb6cf',
  },
  tabIconActive: {
    color: '#8fb6ff',
  },
  tabButtonText: {
    color: '#c0d0de',
  },
  tabButtonTextActive: {
    color: '#9dc5ff',
  },
  sectionHeader: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  sectionEyebrow: {
    color: '#7e9bb6',
  },
  sectionIconWrap: {
    backgroundColor: '#1c3248',
  },
  sectionTitle: {
    color: '#d7e4f5',
  },
  sectionSubtitle: {
    color: '#9eb4ca',
  },
  loadingText: {
    color: '#9eb4ca',
  },
  card: {
    backgroundColor: '#111b21',
    borderColor: '#223244',
    shadowOpacity: 0.18,
  },
  cardHeaderIcon: {
    backgroundColor: '#1c3248',
  },
  cardTitle: {
    color: '#d7e4f5',
  },
  cardDescription: {
    color: '#92abc3',
  },
  fieldLabel: {
    color: '#9ab1c9',
  },
  input: {
    borderColor: '#34506f',
    backgroundColor: '#102636',
    color: '#e9edef',
  },
  dateFieldButton: {
    borderColor: '#34506f',
    backgroundColor: '#102636',
  },
  dateFieldIcon: {
    color: '#89a6c6',
  },
  dateFieldText: {
    color: '#e9edef',
  },
  primaryButton: {
    borderColor: '#4a90ff',
    backgroundColor: '#1f77ff',
  },
  secondaryButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  secondaryButtonText: {
    color: '#c5daff',
  },
  filterChip: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  filterChipActive: {
    borderColor: '#4a90ff',
    backgroundColor: '#193a5a',
  },
  filterChipText: {
    color: '#c0d0de',
  },
  filterChipTextActive: {
    color: '#9dc5ff',
  },
  filterCounter: {
    color: '#9eb4ca',
  },
  datePickerCard: {
    borderColor: '#34506f',
    backgroundColor: '#111b21',
  },
  datePickerTitle: {
    color: '#d7e4f5',
  },
  listRow: {
    borderColor: '#223244',
  },
  listTitle: {
    color: '#d7e4f5',
  },
  listSubtitle: {
    color: '#9eb4ca',
  },
  ticketStatusBadge: {
    borderColor: '#3d5c7d',
    backgroundColor: '#18334d',
  },
  ticketStatusText: {
    color: '#a6ccff',
  },
  userRow: {
    borderColor: '#223244',
  },
  userAvatar: {
    backgroundColor: '#20364a',
    borderColor: '#34506f',
  },
  userAvatarText: {
    color: '#c5daff',
  },
  userBadge: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  userBadgeSellerInactive: {
    borderColor: '#34506f',
    backgroundColor: '#1f2e3d',
  },
  userBadgeText: {
    color: '#c0d0de',
  },
  userSwitchLabel: {
    color: '#9ab1c9',
  },
  assigneeButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  assigneeButtonActive: {
    borderColor: '#4a90ff',
    backgroundColor: '#193a5a',
  },
  assigneeButtonText: {
    color: '#c0d0de',
  },
  assigneeButtonTextActive: {
    color: '#9dc5ff',
  },
  dayRow: {
    borderColor: '#223244',
  },
  dayLabel: {
    color: '#d7e4f5',
  },
  timeInput: {
    borderColor: '#34506f',
    backgroundColor: '#102636',
    color: '#e9edef',
  },
  emptyStateText: {
    color: '#9eb4ca',
  },
  rankingPositionWrap: {
    borderColor: '#34506f',
    backgroundColor: '#1c3248',
  },
  rankingPositionText: {
    color: '#9dc5ff',
  },
});
