import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import {
  addBlacklist,
  assignTicket,
  createSeller,
  getAwaitConfig,
  getBusinessHours,
  getBusinessMessage,
  getRanking,
  listAdminTickets,
  listAssignees,
  listBlacklist,
  listUsers,
  removeBlacklist,
  saveAwaitConfig,
  saveBusinessHours,
  saveBusinessMessage,
  updateSeller,
} from '../api/admin';
import { ApiRequestError } from '../api/client';
import { useAppSession } from '../context/AppSessionContext';
import { todayIsoDate } from '../lib/date';
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
} from '../types/admin';
import { colors } from '../theme';

type AdminScreenProps = NativeStackScreenProps<RootStackParamList, 'Admin'>;

const SECTION_TITLE: Record<AdminSectionKey, string> = {
  users: 'Usuários e papéis',
  tickets: 'Tickets',
  blacklist: 'Blacklist',
  hours: 'Horário comercial',
  await: 'Aguardando automático',
  ranking: 'Ranking',
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

export function AdminScreen({ navigation }: AdminScreenProps) {
  const { session, signOut } = useAppSession();

  const [activeSection, setActiveSection] = useState<AdminSectionKey>('users');
  const [loading, setLoading] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerPassword, setNewSellerPassword] = useState('');

  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [blacklistPhone, setBlacklistPhone] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');

  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [businessMessage, setBusinessMessage] = useState<BusinessMessage>({ message: '', enabled: false });

  const [awaitConfig, setAwaitConfig] = useState<AwaitConfig>({ minutes: 15 });

  const [ranking, setRanking] = useState<RankingSeller[]>([]);
  const [period, setPeriod] = useState(defaultPeriod());

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
    const [ticketList, assigneesList] = await Promise.all([listAdminTickets(), listAssignees()]);
    setTickets(ticketList);
    setAssignees(assigneesList);
  }, []);

  const refreshBlacklist = useCallback(async () => {
    const list = await listBlacklist();
    setBlacklist(list);
  }, []);

  const refreshHours = useCallback(async () => {
    const [hoursList, message] = await Promise.all([getBusinessHours(), getBusinessMessage()]);
    setHours(hoursList);
    setBusinessMessage(message);
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
        if (activeSection === 'await') {
          await refreshAwait();
          return;
        }
        await refreshRanking();
      });
      setLoading(false);
    };

    void load();
  }, [activeSection, ensureAdmin, refreshAwait, refreshBlacklist, refreshHours, refreshRanking, refreshTickets, refreshUsers, withAuthGuard]);

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
            {(Object.keys(SECTION_TITLE) as AdminSectionKey[]).map((section) => (
              <Pressable
                key={section}
                onPress={() => setActiveSection(section)}
                style={[styles.tabButton, activeSection === section ? styles.tabButtonActive : null]}
              >
                <Text style={[styles.tabButtonText, activeSection === section ? styles.tabButtonTextActive : null]}>
                  {SECTION_TITLE[section]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{SECTION_TITLE[activeSection]}</Text>
          <Text style={styles.sectionSubtitle}>Gerencie configurações, equipe e distribuição de atendimento.</Text>
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
              <Text style={styles.cardTitle}>Novo vendedor</Text>
              <TextInput
                style={styles.input}
                placeholder="Usuario"
                placeholderTextColor="#8ea0b8"
                value={newSellerName}
                onChangeText={setNewSellerName}
                autoCapitalize="none"
              />
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
                    await createSeller({ name: newSellerName.trim(), password: newSellerPassword.trim() });
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
              <Text style={styles.cardTitle}>Usuarios cadastrados</Text>
              {users.map((user) => (
                <View key={String(user.id)} style={styles.listRow}>
                  <View style={styles.listInfo}>
                    <Text style={styles.listTitle}>{user.name}</Text>
                    <Text style={styles.listSubtitle}>
                      {user.isAdmin ? 'Admin' : 'Nao admin'} | {user.isSeller ? (user.sellerActive ? 'Vendedor ativo' : 'Vendedor inativo') : 'Nao vendedor'}
                    </Text>
                  </View>

                  {user.isSeller ? (
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
                  ) : null}
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'tickets' ? (
          <FlatList
            style={styles.sectionBody}
            contentContainerStyle={styles.sectionBodyContent}
            data={tickets}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.listTitle}>{item.contact_name || item.phone}</Text>
                <Text style={styles.listSubtitle}>{item.phone}</Text>
                <Text style={styles.listSubtitle}>Status: {item.status}</Text>
                <Text style={styles.listSubtitle}>Responsavel: {item.seller_name || 'Nao atribuido'}</Text>

                <View style={styles.actionRow}>
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
          />
        ) : null}

        {!loading && activeSection === 'blacklist' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Adicionar numero</Text>
              <TextInput
                style={styles.input}
                placeholder="Telefone com DDI"
                placeholderTextColor="#8ea0b8"
                value={blacklistPhone}
                onChangeText={setBlacklistPhone}
                keyboardType="phone-pad"
              />
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
                    await addBlacklist({
                      phone: blacklistPhone.trim(),
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
              <Text style={styles.cardTitle}>Numeros bloqueados</Text>
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
            </View>
          </ScrollView>
        ) : null}

        {!loading && activeSection === 'hours' ? (
          <ScrollView style={styles.sectionBody} contentContainerStyle={styles.sectionBodyContent}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Horario por dia</Text>
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
                    await saveBusinessHours(hours);
                    Alert.alert('Sucesso', 'Horario salvo.');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Salvar horario</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mensagem fora do horario</Text>
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
                    await saveBusinessMessage({
                      message: businessMessage.message,
                      enabled: businessMessage.enabled,
                    });
                    Alert.alert('Sucesso', 'Mensagem atualizada.');
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
              <Text style={styles.cardTitle}>Aguardando automatico</Text>
              <Text style={styles.listSubtitle}>Minutos para mover para aguardando</Text>
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
                    await saveAwaitConfig(awaitConfig.minutes);
                    Alert.alert('Sucesso', 'Configuracao salva.');
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
              <Text style={styles.cardTitle}>Periodo</Text>
              <TextInput
                style={styles.input}
                value={period.startDate}
                onChangeText={(value) => setPeriod((current) => ({ ...current, startDate: value }))}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#8ea0b8"
              />
              <TextInput
                style={styles.input}
                value={period.endDate}
                onChangeText={(value) => setPeriod((current) => ({ ...current, endDate: value }))}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#8ea0b8"
              />
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  void withAuthGuard(async () => {
                    await refreshRanking();
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>Atualizar ranking</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Vendedores</Text>
              {ranking.map((item) => (
                <View key={`${item.seller_id}`} style={styles.listRow}>
                  <View style={styles.listInfo}>
                    <Text style={styles.listTitle}>{item.seller_name}</Text>
                    <Text style={styles.listSubtitle}>{item.tickets_resolved} tickets resolvidos</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
    fontSize: 60,
    lineHeight: 60,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d6e3f8',
    backgroundColor: '#fff',
  },
  tabRow: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  tabButton: {
    borderWidth: 1,
    borderColor: '#d3e2f8',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#f4f8ff',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  tabButtonActive: {
    borderColor: '#2b6fdb',
    backgroundColor: '#e6efff',
  },
  tabButtonText: {
    color: '#365170',
    fontWeight: '700',
    fontSize: 12,
  },
  tabButtonTextActive: {
    color: '#0b53c1',
  },
  sectionHeader: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d6e3f8',
    backgroundColor: '#fff',
  },
  sectionTitle: {
    color: '#16335f',
    fontSize: 30,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#5f7288',
    marginTop: 4,
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
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    color: '#16335f',
    fontSize: 20,
    fontWeight: '800',
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
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f66d6',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
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
    color: colors.primaryStrong,
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
    fontSize: 16,
  },
  listSubtitle: {
    color: '#627589',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  assigneeRow: {
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
    borderColor: colors.primary,
    backgroundColor: '#dcecff',
  },
  assigneeButtonText: {
    color: colors.primaryStrong,
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
});
