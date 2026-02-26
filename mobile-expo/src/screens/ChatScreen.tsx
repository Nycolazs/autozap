import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Video, Audio, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import ImageViewing from 'react-native-image-viewing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiRequestError, getAuthToken, resolveApiUrl } from '../api/client';
import { assignTicket, listAssignees } from '../api/admin';
import {
  createQuickMessage,
  deleteQuickMessage,
  fetchProfilePicture,
  getConnectionStatus,
  listContactTickets,
  listQuickMessages,
  getTicketMessages,
  markTicketReadByAgent,
  sendAudioMessage,
  sendImageMessage,
  sendTextMessage,
  updateQuickMessage,
  updateTicketStatus,
} from '../api/chat';
import { AudioMessagePlayer } from '../components/AudioMessagePlayer';
import { useAppSession } from '../context/AppSessionContext';
import { useAppTheme } from '../context/AppThemeContext';
import { formatTime } from '../lib/date';
import { resolveMediaUrl, resolveProfilePictureUrl } from '../lib/media';
import { mergeThemedStyles } from '../lib/themeStyles';
import type { RootStackParamList } from '../types/navigation';
import type { Assignee } from '../types/admin';
import type { ChatMessage, QuickMessage, Ticket } from '../types/chat';
import { lightColors } from '../theme';

type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;

type MessageTypeNormalized = 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'document' | 'system';
type DeliveryStatusNormalized = 'sent' | 'delivered' | 'read' | 'failed' | null;
type SelectorOption = {
  key: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

type RuntimeStyleRefs = {
  messageRow: StyleProp<ViewStyle>;
  messageRowClient: StyleProp<ViewStyle>;
  messageRowAgent: StyleProp<ViewStyle>;
  messageRowSystem: StyleProp<ViewStyle>;
  messageAnimatedWrap: StyleProp<ViewStyle>;
  messageBubble: StyleProp<ViewStyle>;
  bubbleClient: StyleProp<ViewStyle>;
  bubbleAgent: StyleProp<ViewStyle>;
  bubbleSystem: StyleProp<ViewStyle>;
  replyPreview: StyleProp<ViewStyle>;
  replyAuthor: StyleProp<TextStyle>;
  replyText: StyleProp<TextStyle>;
  messageMetaRow: StyleProp<ViewStyle>;
  messageMetaSystem: StyleProp<ViewStyle>;
  messageTime: StyleProp<TextStyle>;
  metaIcon: StyleProp<TextStyle>;
  selectorOverlay: StyleProp<ViewStyle>;
  selectorSheet: StyleProp<ViewStyle>;
  selectorTitle: StyleProp<TextStyle>;
  selectorItem: StyleProp<ViewStyle>;
  selectorItemActive: StyleProp<ViewStyle>;
  selectorItemDisabled: StyleProp<ViewStyle>;
  selectorItemText: StyleProp<TextStyle>;
  selectorItemTextActive: StyleProp<TextStyle>;
};

let runtimeStyles = {} as RuntimeStyleRefs;
let runtimePalette = {
  primary: lightColors.primary,
  primaryStrong: lightColors.primaryStrong,
  muted: lightColors.muted,
};
const chatMessagesCacheByTicket = new Map<number, ChatMessage[]>();
const MEDIA_PLACEHOLDER_SET = new Set([
  '[imagem]',
  '[figurinha]',
  '[áudio]',
  '[audio]',
  '[vídeo]',
  '[video]',
  '[documento]',
  '🖼️ imagem',
  '🧩 figurinha',
  '🎵 áudio',
  '🎤 áudio',
  '🎬 vídeo',
  '📄 documento',
]);

function normalizeMessageType(message: ChatMessage): MessageTypeNormalized {
  if (message.message_type) return message.message_type;

  const content = String(message.content || '').trim().toLowerCase();
  const mediaUrl = String(message.media_url || '').toLowerCase();

  if (content === '[figurinha]' || mediaUrl.endsWith('.webp') || mediaUrl.includes('.webp?')) return 'sticker';

  if (message.media_url) {
    if (message.media_url.includes('/audios/')) return 'audio';
    if (message.media_url.includes('/images/')) return 'image';
    if (message.media_url.includes('/stickers/')) return 'sticker';
    if (message.media_url.includes('/videos/')) return 'video';
    if (message.media_url.includes('/documents/')) return 'document';
  }

  return 'text';
}

function isMediaPlaceholderText(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return MEDIA_PLACEHOLDER_SET.has(normalized);
}

function statusLabel(status: Ticket['status']): string {
  if (status === 'pendente') return 'Pendente';
  if (status === 'aguardando') return 'Aguardando';
  if (status === 'em_atendimento') return 'Em atendimento';
  if (status === 'resolvido') return 'Resolvido';
  return 'Encerrado';
}

function senderLabel(sender: ChatMessage['sender']): string {
  if (sender === 'agent') return 'Você';
  if (sender === 'client') return 'Cliente';
  return 'Sistema';
}

function messagePreviewLabel(message: ChatMessage): string {
  const text = String(message.content || '').trim();
  if (text && !isMediaPlaceholderText(text)) return text;

  const type = normalizeMessageType(message);
  if (type === 'image') return 'Imagem';
  if (type === 'audio') return 'Áudio';
  if (type === 'video') return 'Vídeo';
  if (type === 'sticker') return 'Figurinha';
  if (type === 'document') return 'Documento';
  return 'Mensagem';
}

function statusOptions(): Ticket['status'][] {
  return ['pendente', 'aguardando', 'em_atendimento', 'resolvido', 'encerrado'];
}

function parseSqliteDateToEpochMs(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;

  const normalized = raw.includes('T')
    ? raw
    : `${raw.replace(' ', 'T')}Z`;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortTicketsByNewest(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => Number(b.id) - Number(a.id));
}

function areMessagesEquivalent(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;

  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    if (!right) return false;

    if (
      Number(left.id) !== Number(right.id)
      || Number(left.reply_to_id || 0) !== Number(right.reply_to_id || 0)
      || String(left.updated_at || '') !== String(right.updated_at || '')
      || String(left.message_status || '') !== String(right.message_status || '')
      || String(left.message_type || '') !== String(right.message_type || '')
      || String(left.content || '') !== String(right.content || '')
      || String(left.media_url || '') !== String(right.media_url || '')
    ) {
      return false;
    }
  }

  return true;
}

const QUICK_MESSAGES_STORAGE_PREFIX = 'autozap.quickMessages.v1';

function sortQuickMessagesByNewest(items: QuickMessage[]): QuickMessage[] {
  return [...items].sort((a, b) => {
    const aTs = Date.parse(String(a.updated_at || a.created_at || '')) || 0;
    const bTs = Date.parse(String(b.updated_at || b.created_at || '')) || 0;
    if (aTs !== bTs) return bTs - aTs;
    return Number(b.id) - Number(a.id);
  });
}

function quickMessageTitleFromContent(content: string): string {
  const compact = String(content || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Mensagem rápida';
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

function normalizeDeliveryStatus(message: ChatMessage, forceReadByView = false): DeliveryStatusNormalized {
  if (message.sender !== 'agent') return null;
  const raw = String(message.message_status || '').trim().toLowerCase();
  if (raw === 'failed') return 'failed';
  if (forceReadByView) return 'read';
  if (raw === 'read') return 'read';
  if (raw === 'delivered') return 'delivered';
  if (raw === 'sent') {
    const createdAtMs = parseSqliteDateToEpochMs(message.created_at);
    if (createdAtMs > 0 && (Date.now() - createdAtMs) > 1500) {
      return 'delivered';
    }
    return 'sent';
  }

  const createdAtMs = parseSqliteDateToEpochMs(message.created_at);
  if (createdAtMs > 0 && (Date.now() - createdAtMs) > 1500) {
    return 'delivered';
  }
  return 'sent';
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizePhoneForApi(value: unknown): string {
  return String(value || '').split('@')[0].replace(/\D/g, '');
}

function resolveRealtimeSocketUrl(): string | null {
  const wsBase = resolveApiUrl('/ws');
  if (!wsBase) return null;

  let finalUrl = wsBase;
  if (finalUrl.startsWith('https://')) finalUrl = `wss://${finalUrl.slice('https://'.length)}`;
  else if (finalUrl.startsWith('http://')) finalUrl = `ws://${finalUrl.slice('http://'.length)}`;
  else if (!finalUrl.startsWith('ws://') && !finalUrl.startsWith('wss://')) return null;

  const token = getAuthToken();
  if (!token) return finalUrl;
  return `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
}

function MessageDeliveryIndicator({ status }: { status: DeliveryStatusNormalized }) {
  if (!status) return null;

  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={13} color="#d92d20" style={runtimeStyles.metaIcon} />;
  }

  const iconName = status === 'sent' ? 'checkmark' : 'checkmark-done';
  const iconColor = status === 'read' ? '#53bdeb' : '#8696a0';
  return <Ionicons name={iconName} size={14} color={iconColor} style={runtimeStyles.metaIcon} />;
}

function SelectorModal({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectorOption[];
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={runtimeStyles.selectorOverlay} onPress={onClose}>
        <Pressable style={runtimeStyles.selectorSheet} onPress={() => {}}>
          <Text style={runtimeStyles.selectorTitle}>{title}</Text>
          {options.map((option) => (
            <Pressable
              key={option.key}
              style={[
                runtimeStyles.selectorItem,
                option.active ? runtimeStyles.selectorItemActive : null,
                option.disabled ? runtimeStyles.selectorItemDisabled : null,
              ]}
              disabled={option.disabled}
              onPress={() => {
                option.onPress();
              }}
            >
              <Text style={[runtimeStyles.selectorItemText, option.active ? runtimeStyles.selectorItemTextActive : null]}>
                {option.label}
              </Text>
              {option.active ? <Ionicons name="checkmark" size={16} color={runtimePalette.primaryStrong} /> : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type SwipeReplyMessageProps = {
  item: ChatMessage;
  reply: ChatMessage | null;
  fromClient: boolean;
  isSystem: boolean;
  forceReadByView?: boolean;
  onReply: (message: ChatMessage) => void;
  renderContent: (message: ChatMessage) => React.ReactNode;
};

function SwipeReplyMessage({
  item,
  reply,
  fromClient,
  isSystem,
  forceReadByView = false,
  onReply,
  renderContent,
}: SwipeReplyMessageProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const triggeredRef = useRef(false);
  const lastTapAtRef = useRef(0);
  const deliveryStatus = normalizeDeliveryStatus(item, forceReadByView);

  const resetPosition = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 22,
      bounciness: 2,
    }).start(() => {
      triggeredRef.current = false;
    });
  }, [translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      if (isSystem) return false;
      return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 8;
    },
    onPanResponderMove: (_, gestureState) => {
      const clamped = Math.max(-88, Math.min(88, gestureState.dx));
      translateX.setValue(clamped);

      if (!triggeredRef.current && Math.abs(gestureState.dx) > 52) {
        triggeredRef.current = true;
        onReply(item);
      }
    },
    onPanResponderRelease: resetPosition,
    onPanResponderTerminate: resetPosition,
    onPanResponderTerminationRequest: () => true,
  }), [isSystem, item, onReply, resetPosition, translateX]);

  const handleBubblePress = useCallback(() => {
    if (isSystem) return;

    const now = Date.now();
    const elapsed = now - lastTapAtRef.current;
    lastTapAtRef.current = now;
    if (elapsed > 0 && elapsed < 280) {
      onReply(item);
    }
  }, [isSystem, item, onReply]);

  return (
    <View
      style={[
        runtimeStyles.messageRow,
        fromClient ? runtimeStyles.messageRowClient : runtimeStyles.messageRowAgent,
        isSystem ? runtimeStyles.messageRowSystem : null,
      ]}
    >
      <Animated.View
        style={runtimeStyles.messageAnimatedWrap}
        {...(!isSystem ? panResponder.panHandlers : {})}
      >
        <Pressable
          onPress={handleBubblePress}
          onLongPress={() => {
            if (!isSystem) onReply(item);
          }}
          delayLongPress={220}
        >
          <Animated.View
            style={[
              runtimeStyles.messageBubble,
              fromClient ? runtimeStyles.bubbleClient : runtimeStyles.bubbleAgent,
              isSystem ? runtimeStyles.bubbleSystem : null,
              { transform: [{ translateX }] },
            ]}
          >
            {reply ? (
              <View style={runtimeStyles.replyPreview}>
                <Text style={runtimeStyles.replyAuthor}>{senderLabel(reply.sender)}</Text>
                <Text numberOfLines={1} style={runtimeStyles.replyText}>{messagePreviewLabel(reply)}</Text>
              </View>
            ) : null}

            {renderContent(item)}
            <View style={[runtimeStyles.messageMetaRow, isSystem ? runtimeStyles.messageMetaSystem : null]}>
              <Text style={runtimeStyles.messageTime}>{formatTime(item.created_at)}</Text>
              {!fromClient && !isSystem ? <MessageDeliveryIndicator status={deliveryStatus} /> : null}
            </View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function ChatScreen({ route, navigation }: ChatScreenProps) {
  const { session, signOut } = useAppSession();
  const { colors: themeColors, isDark } = useAppTheme();
  const styles = useMemo(() => mergeThemedStyles(lightStyles, darkStyles, isDark), [isDark]);
  runtimeStyles = styles;
  runtimePalette = {
    primary: themeColors.primary,
    primaryStrong: themeColors.primaryStrong,
    muted: themeColors.muted,
  };
  const isFocused = useIsFocused();
  const [ticket, setTicket] = useState<Ticket>(route.params.ticket);
  const initialCachedMessages = chatMessagesCacheByTicket.get(Number(route.params.ticket.id)) || [];

  const [messages, setMessages] = useState<ChatMessage[]>(() => initialCachedMessages);
  const [loading, setLoading] = useState(() => initialCachedMessages.length === 0);
  const [connectionOnline, setConnectionOnline] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [contactTickets, setContactTickets] = useState<Ticket[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [showStatusSelector, setShowStatusSelector] = useState(false);
  const [showAssigneeSelector, setShowAssigneeSelector] = useState(false);
  const [showTicketHistory, setShowTicketHistory] = useState(false);
  const [loadingTicketHistory, setLoadingTicketHistory] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([]);
  const [quickMessagesVisible, setQuickMessagesVisible] = useState(false);
  const [quickMessagesLoading, setQuickMessagesLoading] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState(false);
  const [quickFormText, setQuickFormText] = useState('');
  const [editingQuickMessageId, setEditingQuickMessageId] = useState<number | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(true);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartPromiseRef = useRef<Promise<void> | null>(null);
  const realtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickMessagesModeRef = useRef<'remote' | 'local'>('remote');
  const quickMessagesMissingRef = useRef(false);
  const quickMessagesFallbackWarnedRef = useRef(false);

  const canSendText = useMemo(() => !sending && !!inputText.trim(), [inputText, sending]);
  const contactInitial = useMemo(() => {
    const basis = String(ticket.contact_name || ticket.phone || '').trim();
    return basis ? basis.charAt(0).toUpperCase() : '?';
  }, [ticket.contact_name, ticket.phone]);
  const assigneeLabel = useMemo(() => ticket.seller_name || 'Não atribuído', [ticket.seller_name]);
  const sortedContactTickets = useMemo(() => sortTicketsByNewest(contactTickets), [contactTickets]);
  const latestTicketId = useMemo(() => {
    if (sortedContactTickets.length > 0) return Number(sortedContactTickets[0].id);
    return Number(ticket.id);
  }, [sortedContactTickets, ticket.id]);
  const isHistoricalTicket = useMemo(() => Number(ticket.id) !== Number(latestTicketId), [latestTicketId, ticket.id]);
  const ticketHeaderLabel = useMemo(() => {
    if (isHistoricalTicket) return `Ticket #${ticket.id} (antigo)`;
    return `Ticket #${ticket.id} (atual)`;
  }, [isHistoricalTicket, ticket.id]);
  const oldTicketsCount = useMemo(() => {
    if (!sortedContactTickets.length) return 0;
    return Math.max(0, sortedContactTickets.length - 1);
  }, [sortedContactTickets.length]);

  const messageMap = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    for (const message of messages) map.set(message.id, message);
    return map;
  }, [messages]);

  const stopRecordTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scrollToLatest = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const forceScrollToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => {
      scrollToLatest(false);
    });
  }, [scrollToLatest]);

  useEffect(() => {
    initialScrollPendingRef.current = true;
    shouldStickToBottomRef.current = true;
  }, [scrollToLatest, ticket.id]);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const normalizedPhone = normalizePhoneForApi(ticket.phone);

    const loadProfilePicture = async (attempt: number) => {
      try {
        const response = await fetchProfilePicture(
          normalizedPhone || ticket.phone,
          attempt > 0 ? { refresh: true } : undefined
        );
        if (!active) return;

        const resolved = resolveProfilePictureUrl(
          normalizedPhone,
          response && response.url ? response.url : (ticket.avatar_url || null)
        );
        if (resolved) {
          setProfilePictureUrl(resolved);
          return;
        }

        setProfilePictureUrl(null);
        if (response && response.pending && attempt < 5) {
          retryTimer = setTimeout(() => {
            void loadProfilePicture(attempt + 1);
          }, 1200 * (attempt + 1));
        }
      } catch (_) {
        if (!active) return;
        setProfilePictureUrl(null);
      }
    };

    void loadProfilePicture(0);

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [ticket.avatar_url, ticket.phone]);

  useEffect(() => {
    let mounted = true;

    const loadAssignees = async () => {
      try {
        const list = await listAssignees();
        if (!mounted) return;
        setAssignees(Array.isArray(list) ? list : []);
      } catch (_) {
        if (!mounted) return;
        setAssignees([]);
      }
    };

    void loadAssignees();
    return () => {
      mounted = false;
    };
  }, []);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) {
      const cached = chatMessagesCacheByTicket.get(Number(ticket.id));
      if (!cached || cached.length === 0) {
        setLoading(true);
      }
    }

    try {
      const list = await getTicketMessages(ticket.id, 350);
      setMessages((current) => (areMessagesEquivalent(current, list) ? current : list));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        await signOut();
        return;
      }
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar mensagens.';
        Alert.alert('Erro', message);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [signOut, ticket.id]);

  useEffect(() => {
    const key = Number(ticket.id);
    if (!Number.isFinite(key) || key <= 0) return;
    chatMessagesCacheByTicket.set(key, messages);
  }, [messages, ticket.id]);

  const loadContactTicketHistory = useCallback(async (silent = true) => {
    if (!silent) setLoadingTicketHistory(true);

    try {
      const list = await listContactTickets(ticket.phone, 100);
      const safeList = Array.isArray(list) ? list : [];
      const sorted = sortTicketsByNewest(safeList);

      if (!sorted.find((item) => Number(item.id) === Number(ticket.id))) {
        sorted.unshift(ticket);
      }

      setContactTickets(sortTicketsByNewest(sorted));
      const selectedTicket = sorted.find((item) => Number(item.id) === Number(ticket.id));
      if (selectedTicket) {
        setTicket((current) => {
          if (Number(current.id) !== Number(selectedTicket.id)) return current;

          const sameStatus = String(current.status || '') === String(selectedTicket.status || '');
          const sameSellerId = Number(current.seller_id || 0) === Number(selectedTicket.seller_id || 0);
          const sameSellerName = String(current.seller_name || '') === String(selectedTicket.seller_name || '');
          const sameContactName = String(current.contact_name || '') === String(selectedTicket.contact_name || '');
          const samePhone = String(current.phone || '') === String(selectedTicket.phone || '');
          if (sameStatus && sameSellerId && sameSellerName && sameContactName && samePhone) {
            return current;
          }
          return { ...current, ...selectedTicket };
        });
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        await signOut();
        return;
      }
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar histórico de tickets.';
        Alert.alert('Erro', message);
      }
    } finally {
      if (!silent) setLoadingTicketHistory(false);
    }
  }, [signOut, ticket]);

  const queueRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimeoutRef.current) return;
    realtimeRefreshTimeoutRef.current = setTimeout(() => {
      realtimeRefreshTimeoutRef.current = null;
      void loadMessages(true);
    }, 120);
  }, [loadMessages]);

  const markViewedByAgent = useCallback(async () => {
    try {
      await markTicketReadByAgent(ticket.id);
    } catch (_) {}
  }, [ticket.id]);

  const quickMessagesStorageKey = useMemo(() => {
    if (!session) return `${QUICK_MESSAGES_STORAGE_PREFIX}:guest`;
    return `${QUICK_MESSAGES_STORAGE_PREFIX}:${session.userType}:${session.userId}`;
  }, [session]);

  const readLocalQuickMessages = useCallback(async (): Promise<QuickMessage[]> => {
    if (!session) return [];

    try {
      const raw = await AsyncStorage.getItem(quickMessagesStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const fallbackType = session.userType === 'admin' ? 'admin' : 'seller';
      const normalized: QuickMessage[] = [];
      for (const row of parsed) {
        const id = Number(row && row.id);
        const content = String((row && row.content) || '').trim();
        if (!Number.isFinite(id) || id <= 0 || !content) continue;
        const createdAt = String((row && row.created_at) || new Date().toISOString());
        const updatedAt = String((row && row.updated_at) || createdAt);
        normalized.push({
          id,
          user_id: Number((row && row.user_id) || session.userId),
          user_type: row && row.user_type === 'admin'
            ? 'admin'
            : row && row.user_type === 'seller'
              ? 'seller'
              : fallbackType,
          shortcut: null,
          title: String((row && row.title) || quickMessageTitleFromContent(content)),
          content,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }

      return sortQuickMessagesByNewest(normalized);
    } catch (_) {
      return [];
    }
  }, [quickMessagesStorageKey, session]);

  const writeLocalQuickMessages = useCallback(async (items: QuickMessage[]) => {
    try {
      await AsyncStorage.setItem(quickMessagesStorageKey, JSON.stringify(items));
    } catch (_) {}
  }, [quickMessagesStorageKey]);

  const clearQuickForm = useCallback(() => {
    setEditingQuickMessageId(null);
    setQuickFormText('');
  }, []);

  const switchQuickMessagesToLocal = useCallback(async (notify: boolean) => {
    quickMessagesModeRef.current = 'local';
    quickMessagesMissingRef.current = true;
    const localItems = await readLocalQuickMessages();
    setQuickMessages(localItems);

    if (notify && !quickMessagesFallbackWarnedRef.current) {
      quickMessagesFallbackWarnedRef.current = true;
      Alert.alert('Mensagens rápidas', 'Backend sem rota de mensagens rápidas. Usando modo local neste dispositivo.');
    }
  }, [readLocalQuickMessages]);

  const loadQuickMessages = useCallback(async (silent = true) => {
    if (!session) return;
    if (!silent) setQuickMessagesLoading(true);

    try {
      const rows = await listQuickMessages();
      setQuickMessages(sortQuickMessagesByNewest(Array.isArray(rows) ? rows : []));
      quickMessagesModeRef.current = 'remote';
      quickMessagesMissingRef.current = false;
      quickMessagesFallbackWarnedRef.current = false;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        await switchQuickMessagesToLocal(!silent);
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await signOut();
      } else if (!silent) {
        const message = error instanceof Error ? error.message : 'Falha ao carregar mensagens rápidas.';
        Alert.alert('Erro', message);
      }
    } finally {
      if (!silent) setQuickMessagesLoading(false);
    }
  }, [session, signOut, switchQuickMessagesToLocal]);

  const handleOpenQuickMessages = useCallback(() => {
    setQuickMessagesVisible(true);
    void loadQuickMessages(false);
  }, [loadQuickMessages]);

  const handleQuickInsert = useCallback((item: QuickMessage) => {
    const text = String(item.content || '').trim();
    if (!text) return;
    setInputText(text);
    setQuickMessagesVisible(false);
    clearQuickForm();
  }, [clearQuickForm]);

  const handleQuickEdit = useCallback((item: QuickMessage) => {
    setEditingQuickMessageId(Number(item.id));
    setQuickFormText(String(item.content || ''));
  }, []);

  const createQuickMessageLocal = useCallback(async (content: string) => {
    if (!session) return;
    const now = new Date().toISOString();
    let nextId = Date.now();
    for (const item of quickMessages) {
      const value = Number(item.id || 0);
      if (value >= nextId) nextId = value + 1;
    }

    const created: QuickMessage = {
      id: nextId,
      user_id: session.userId,
      user_type: session.userType,
      shortcut: null,
      title: quickMessageTitleFromContent(content),
      content,
      created_at: now,
      updated_at: now,
    };

    const nextRows = sortQuickMessagesByNewest([created, ...quickMessages.filter((item) => Number(item.id) !== nextId)]);
    setQuickMessages(nextRows);
    await writeLocalQuickMessages(nextRows);
  }, [quickMessages, session, writeLocalQuickMessages]);

  const updateQuickMessageLocal = useCallback(async (quickMessageId: number, content: string) => {
    const nextRows = sortQuickMessagesByNewest(
      quickMessages.map((item) => {
        if (Number(item.id) !== Number(quickMessageId)) return item;
        return {
          ...item,
          title: quickMessageTitleFromContent(content),
          content,
          updated_at: new Date().toISOString(),
        };
      })
    );
    setQuickMessages(nextRows);
    await writeLocalQuickMessages(nextRows);
  }, [quickMessages, writeLocalQuickMessages]);

  const deleteQuickMessageLocal = useCallback(async (quickMessageId: number) => {
    const nextRows = quickMessages.filter((item) => Number(item.id) !== Number(quickMessageId));
    setQuickMessages(nextRows);
    await writeLocalQuickMessages(nextRows);
  }, [quickMessages, writeLocalQuickMessages]);

  const handleQuickSave = useCallback(async () => {
    const content = String(quickFormText || '').trim();
    if (!content) {
      Alert.alert('Mensagens rápidas', 'Digite a mensagem antes de salvar.');
      return;
    }

    setQuickActionLoading(true);
    try {
      if (quickMessagesModeRef.current === 'local' || quickMessagesMissingRef.current) {
        if (editingQuickMessageId) {
          await updateQuickMessageLocal(editingQuickMessageId, content);
        } else {
          await createQuickMessageLocal(content);
        }
      } else if (editingQuickMessageId) {
        const updated = await updateQuickMessage(editingQuickMessageId, {
          title: quickMessageTitleFromContent(content),
          content,
          shortcut: null,
        });
        setQuickMessages((current) => sortQuickMessagesByNewest(
          current.map((item) => (Number(item.id) === Number(updated.id) ? updated : item))
        ));
      } else {
        const created = await createQuickMessage({
          title: quickMessageTitleFromContent(content),
          content,
          shortcut: null,
        });
        setQuickMessages((current) => sortQuickMessagesByNewest([created, ...current.filter((item) => Number(item.id) !== Number(created.id))]));
      }

      clearQuickForm();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        await switchQuickMessagesToLocal(true);
        if (editingQuickMessageId) {
          await updateQuickMessageLocal(editingQuickMessageId, content);
        } else {
          await createQuickMessageLocal(content);
        }
        clearQuickForm();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await signOut();
      } else {
        const message = error instanceof Error ? error.message : 'Falha ao salvar mensagem rápida.';
        Alert.alert('Erro', message);
      }
    } finally {
      setQuickActionLoading(false);
    }
  }, [
    clearQuickForm,
    createQuickMessageLocal,
    editingQuickMessageId,
    quickFormText,
    signOut,
    switchQuickMessagesToLocal,
    updateQuickMessageLocal,
  ]);

  const handleQuickDelete = useCallback((item: QuickMessage) => {
    Alert.alert('Excluir mensagem', 'Deseja remover esta mensagem rápida?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setQuickActionLoading(true);
            try {
              const targetId = Number(item.id);
              if (quickMessagesModeRef.current === 'local' || quickMessagesMissingRef.current) {
                await deleteQuickMessageLocal(targetId);
              } else {
                await deleteQuickMessage(targetId);
                setQuickMessages((current) => current.filter((row) => Number(row.id) !== targetId));
              }
              if (Number(editingQuickMessageId) === targetId) {
                clearQuickForm();
              }
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 404) {
                await switchQuickMessagesToLocal(true);
                await deleteQuickMessageLocal(Number(item.id));
                if (Number(editingQuickMessageId) === Number(item.id)) {
                  clearQuickForm();
                }
              } else if (error instanceof ApiRequestError && error.status === 401) {
                await signOut();
              } else {
                const message = error instanceof Error ? error.message : 'Falha ao excluir mensagem.';
                Alert.alert('Erro', message);
              }
            } finally {
              setQuickActionLoading(false);
            }
          })();
        },
      },
    ]);
  }, [clearQuickForm, deleteQuickMessageLocal, editingQuickMessageId, signOut, switchQuickMessagesToLocal]);

  const closeQuickMessagesPanel = useCallback(() => {
    setQuickMessagesVisible(false);
    clearQuickForm();
  }, [clearQuickForm]);

  const loadConnection = useCallback(async () => {
    try {
      const state = await getConnectionStatus();
      setConnectionOnline(!!state.connected);
    } catch (_) {
      setConnectionOnline(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadMessages(), loadConnection(), loadContactTicketHistory(false), loadQuickMessages(true)]);

    const messagesInterval = setInterval(() => {
      void loadMessages(true);
    }, 5000);

    const contactTicketsInterval = setInterval(() => {
      void loadContactTicketHistory(true);
    }, 8000);

    const connectionInterval = setInterval(() => {
      void loadConnection();
    }, 20000);

    const quickMessagesInterval = setInterval(() => {
      if (quickMessagesModeRef.current !== 'remote') return;
      void loadQuickMessages(true);
    }, 25000);

    return () => {
      clearInterval(messagesInterval);
      clearInterval(contactTicketsInterval);
      clearInterval(connectionInterval);
      clearInterval(quickMessagesInterval);
      if (realtimeRefreshTimeoutRef.current) {
        clearTimeout(realtimeRefreshTimeoutRef.current);
        realtimeRefreshTimeoutRef.current = null;
      }
      stopRecordTimer();
    };
  }, [loadConnection, loadContactTicketHistory, loadMessages, loadQuickMessages, stopRecordTimer]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      forceScrollToBottom();
      void loadMessages(true);
      void loadContactTicketHistory(true);
      void markViewedByAgent();
    });
    return unsubscribe;
  }, [forceScrollToBottom, loadContactTicketHistory, loadMessages, markViewedByAgent, navigation]);

  useEffect(() => {
    if (!isFocused) return;
    if (!messages.length) return;
    void markViewedByAgent();
  }, [isFocused, markViewedByAgent, messages.length]);

  useEffect(() => {
    if (!isHistoricalTicket) return;
    setReplyTo(null);
    setShowStatusSelector(false);
    setShowAssigneeSelector(false);
  }, [isHistoricalTicket]);

  useEffect(() => {
    const wsUrl = resolveRealtimeSocketUrl();
    if (!wsUrl) return;

    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1200);
    };

    const handleRealtimeMessage = (raw: string) => {
      let parsed: { type?: string; data?: { ticketId?: number | string } } | null = null;
      try {
        parsed = JSON.parse(String(raw || '')) as { type?: string; data?: { ticketId?: number | string } };
      } catch (_) {
        parsed = null;
      }
      if (!parsed || !parsed.type) return;

      const eventTicketId = Number(parsed.data && parsed.data.ticketId ? parsed.data.ticketId : 0);
      if (eventTicketId && eventTicketId !== Number(ticket.id)) return;

      if (parsed.type === 'message' || parsed.type === 'ticket') {
        queueRealtimeRefresh();
      }
    };

    const connect = () => {
      if (!active) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch (_) {
        scheduleReconnect();
        return;
      }

      ws.onmessage = (event) => {
        if (!active) return;
        handleRealtimeMessage(String((event && event.data) || ''));
      };
      ws.onerror = () => {
        // noop
      };
      ws.onclose = () => {
        if (!active) return;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
    };
  }, [queueRealtimeRefresh, ticket.id]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const nextHeight = Math.max(0, Number(event.endCoordinates?.height || 0));
      setKeyboardHeight(nextHeight);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleSendText = useCallback(async () => {
    if (isHistoricalTicket) {
      Alert.alert('Ticket antigo', 'Não é possível enviar mensagens em tickets antigos.');
      return;
    }
    if (!canSendText) return;

    const payload = {
      message: inputText.trim(),
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
    };

    setSending(true);
    try {
      await sendTextMessage(ticket.id, payload);
      setInputText('');
      setReplyTo(null);
      await loadMessages(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar mensagem.';
      Alert.alert('Erro', message);
    } finally {
      setSending(false);
    }
  }, [canSendText, inputText, isHistoricalTicket, loadMessages, replyTo, ticket.id]);

  const handleStatusChange = useCallback(async (status: Ticket['status']) => {
    if (isHistoricalTicket) return;
    if (updatingStatus || ticket.status === status) return;
    setUpdatingStatus(true);
    setShowStatusSelector(false);
    try {
      await updateTicketStatus(ticket.id, status);
      setTicket((current) => ({ ...current, status }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar status.';
      Alert.alert('Erro', message);
    } finally {
      setUpdatingStatus(false);
    }
  }, [isHistoricalTicket, ticket.id, ticket.status, updatingStatus]);

  const handleAssignSeller = useCallback(async (sellerId: number | null, sellerName: string | null) => {
    if (isHistoricalTicket) return;
    if (updatingAssignee) return;
    if ((ticket.seller_id || null) === sellerId) {
      setShowAssigneeSelector(false);
      return;
    }

    setUpdatingAssignee(true);
    setShowAssigneeSelector(false);
    try {
      await assignTicket(ticket.id, sellerId);
      setTicket((current) => ({
        ...current,
        seller_id: sellerId,
        seller_name: sellerId ? (sellerName || current.seller_name || null) : null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atribuir ticket.';
      Alert.alert('Erro', message);
    } finally {
      setUpdatingAssignee(false);
    }
  }, [isHistoricalTicket, ticket.id, ticket.seller_id, updatingAssignee]);

  const handlePickImage = useCallback(async (fromCamera: boolean) => {
    if (isHistoricalTicket) {
      Alert.alert('Ticket antigo', 'Não é possível enviar mídia em tickets antigos.');
      return;
    }
    try {
      if (fromCamera) {
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
          Alert.alert('Permissão necessária', 'Ative permissão de câmera para enviar fotos.');
          return;
        }
      } else {
        const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!mediaPermission.granted) {
          Alert.alert('Permissão necessária', 'Ative permissão de galeria para enviar imagens.');
          return;
        }
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            quality: 0.8,
            mediaTypes: ['images'],
          })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.8,
            mediaTypes: ['images'],
          });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const uri = String(asset.uri || '');
      if (!uri) return;

      setSending(true);
      await sendImageMessage(
        ticket.id,
        uri,
        asset.fileName || `image-${Date.now()}.jpg`,
        asset.mimeType || 'image/jpeg',
        replyTo ? { replyToId: replyTo.id } : undefined
      );
      setReplyTo(null);
      await loadMessages(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar imagem.';
      Alert.alert('Erro', message);
    } finally {
      setSending(false);
    }
  }, [isHistoricalTicket, loadMessages, replyTo, ticket.id]);

  const startRecording = useCallback(async () => {
    if (isHistoricalTicket) {
      Alert.alert('Ticket antigo', 'Não é possível enviar áudio em tickets antigos.');
      return;
    }
    if (recordingRef.current || recordingStartPromiseRef.current || sending) return;

    const startPromise = (async () => {
      const permission = await Audio.getPermissionsAsync();
      const granted = permission.granted || (await Audio.requestPermissionsAsync()).granted;
      if (!granted) {
        Alert.alert('Permissão necessária', 'Ative permissão de microfone para gravar áudio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const nextRecording = new Audio.Recording();
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await nextRecording.startAsync();

      recordingRef.current = nextRecording;
      setRecording(nextRecording);
      setRecordingSeconds(0);
      stopRecordTimer();
      timerRef.current = setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
    })().catch(() => {
      recordingRef.current = null;
      setRecording(null);
      stopRecordTimer();
      Alert.alert('Erro', 'Não foi possível iniciar a gravação.');
    }).finally(() => {
      recordingStartPromiseRef.current = null;
    });

    recordingStartPromiseRef.current = startPromise;
    await startPromise;
  }, [isHistoricalTicket, sending, stopRecordTimer]);

  const stopRecording = useCallback(async (send: boolean) => {
    if (recordingStartPromiseRef.current) {
      try {
        await recordingStartPromiseRef.current;
      } catch (_) {}
    }

    const current = recordingRef.current || recording;
    if (!current) return;

    recordingRef.current = null;
    stopRecordTimer();
    setRecording(null);

    try {
      let durationMs = recordingSeconds * 1000;
      try {
        const status = await current.getStatusAsync();
        if (status && typeof status === 'object' && 'durationMillis' in status) {
          const value = Number((status as { durationMillis?: number }).durationMillis || 0);
          durationMs = Math.max(durationMs, value);
        }
      } catch (_) {}

      await current.stopAndUnloadAsync();
      const uri = current.getURI();
      if (!send || !uri) {
        setRecordingSeconds(0);
        return;
      }

      if (durationMs < 120) {
        setRecordingSeconds(0);
        return;
      }

      setSending(true);
      await sendAudioMessage(
        ticket.id,
        uri,
        'audio/m4a',
        replyTo ? replyTo.id : undefined
      );
      setReplyTo(null);
      await loadMessages(true);
    } catch (_) {
      if (send) Alert.alert('Erro', 'Falha ao enviar áudio.');
    } finally {
      setRecordingSeconds(0);
      setSending(false);
      recordingRef.current = null;
      recordingStartPromiseRef.current = null;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch (_) {}
    }
  }, [loadMessages, recording, recordingSeconds, replyTo, stopRecordTimer, ticket.id]);

  useEffect(() => {
    return () => {
      stopRecordTimer();
      const current = recordingRef.current;
      recordingRef.current = null;
      if (current) {
        void current.stopAndUnloadAsync().catch(() => {});
      }
      try {
        void Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch (_) {}
    };
  }, [stopRecordTimer]);

  const renderMessageContent = useCallback((message: ChatMessage) => {
    const type = normalizeMessageType(message);

    if ((type === 'image' || type === 'sticker') && message.media_url) {
      const uri = resolveMediaUrl(message.media_url);
      return (
        <Pressable
          onPress={() => setPreviewImage(uri)}
          style={type === 'sticker' ? styles.messageStickerWrap : styles.messageMediaWrap}
        >
          <Image source={{ uri }} style={type === 'sticker' ? styles.messageSticker : styles.messageImage} />
        </Pressable>
      );
    }

    if (type === 'video' && message.media_url) {
      return (
        <View style={styles.messageMediaWrap}>
          <Video
            source={{ uri: resolveMediaUrl(message.media_url) }}
            style={styles.messageVideo}
            useNativeControls
            resizeMode={ResizeMode.COVER}
          />
        </View>
      );
    }

    if (type === 'audio' && message.media_url) {
      return <AudioMessagePlayer uri={resolveMediaUrl(message.media_url)} isOutgoing={message.sender === 'agent'} />;
    }

    if (type === 'document' && message.media_url) {
      return (
        <Text style={styles.documentLabel}>Documento: {resolveMediaUrl(message.media_url)}</Text>
      );
    }

    return <Text style={styles.messageText}>{message.content}</Text>;
  }, [styles]);

  const onMessagesScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    if (initialScrollPendingRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldStickToBottomRef.current = distanceFromBottom < 120;
  }, []);

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      if (a.id !== b.id) return a.id - b.id;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
  }, [messages]);
  const showBlockingMessagesLoader = loading && sortedMessages.length === 0;

  const statusSelectorOptions = useMemo<SelectorOption[]>(() => {
    return statusOptions().map((status) => ({
      key: status,
      label: statusLabel(status),
      active: ticket.status === status,
      disabled: updatingStatus,
      onPress: () => {
        void handleStatusChange(status);
      },
    }));
  }, [handleStatusChange, ticket.status, updatingStatus]);

  const assigneeSelectorOptions = useMemo<SelectorOption[]>(() => {
    const base: SelectorOption[] = [
      {
        key: 'unassigned',
        label: 'Não atribuído',
        active: !ticket.seller_id,
        disabled: updatingAssignee,
        onPress: () => {
          void handleAssignSeller(null, null);
        },
      },
    ];

    for (const assignee of assignees) {
      base.push({
        key: `seller_${assignee.id}`,
        label: assignee.name,
        active: Number(ticket.seller_id || 0) === Number(assignee.id),
        disabled: updatingAssignee,
        onPress: () => {
          void handleAssignSeller(assignee.id, assignee.name);
        },
      });
    }

    return base;
  }, [assignees, handleAssignSeller, ticket.seller_id, updatingAssignee]);

  const historyOptions = useMemo<SelectorOption[]>(() => {
    return sortedContactTickets.map((item) => {
      const seller = item.seller_name ? ` • ${item.seller_name}` : '';
      return {
        key: String(item.id),
        label: `#${item.id} • ${statusLabel(item.status)}${seller}`,
        active: Number(item.id) === Number(ticket.id),
        disabled: loadingTicketHistory,
        onPress: () => {
          if (Number(item.id) === Number(ticket.id)) {
            setShowTicketHistory(false);
            return;
          }
          setShowTicketHistory(false);
          setTicket(item);
          setReplyTo(null);
          setInputText('');
          setPreviewImage(null);
          initialScrollPendingRef.current = true;
          shouldStickToBottomRef.current = true;
        },
      };
    });
  }, [loadingTicketHistory, sortedContactTickets, ticket.id]);

  useEffect(() => {
    if (!messages.length) return;
    if (!initialScrollPendingRef.current) return;

    const timeout = setTimeout(() => {
      forceScrollToBottom();
      initialScrollPendingRef.current = false;
      shouldStickToBottomRef.current = true;
    }, 70);

    return () => {
      clearTimeout(timeout);
    };
  }, [forceScrollToBottom, messages.length]);

  if (!session) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
              <Text style={styles.backButtonText}>{'<'}</Text>
            </Pressable>

            <View style={styles.contactAvatarWrap}>
              {profilePictureUrl ? (
                <Image
                  source={{ uri: profilePictureUrl }}
                  style={styles.contactAvatarImage}
                  onError={() => {
                    setProfilePictureUrl(null);
                    const normalizedPhone = normalizePhoneForApi(ticket.phone);
                    if (!normalizedPhone) return;
                    void (async () => {
                      try {
                        const response = await fetchProfilePicture(normalizedPhone, { refresh: true });
                        const resolved = resolveProfilePictureUrl(normalizedPhone, response?.url || null);
                        if (resolved) {
                          setProfilePictureUrl(resolved);
                        }
                      } catch (_) {}
                    })();
                  }}
                />
              ) : (
                <View style={styles.contactAvatarFallback}>
                  <Text style={styles.contactAvatarInitial}>{contactInitial}</Text>
                </View>
              )}
            </View>

            <View style={styles.headerMain}>
              <Text numberOfLines={1} style={styles.headerTitle}>{ticket.contact_name || ticket.phone}</Text>
              <Text style={styles.headerSubtitle}>{ticket.phone}</Text>
            </View>

            <View style={styles.headerActions}>
              <Text style={[styles.connectionBadge, connectionOnline ? styles.onlineBadge : styles.offlineBadge]}>
                {connectionOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <View style={styles.dropdownGroup}>
              <Text style={styles.dropdownLabel}>Status</Text>
              {isHistoricalTicket ? (
                <View style={[styles.dropdownTrigger, styles.dropdownTriggerReadOnly]}>
                  <Text style={styles.dropdownValue}>{statusLabel(ticket.status)}</Text>
                  <Ionicons name="lock-closed-outline" size={14} color="#607086" />
                </View>
              ) : (
                <Pressable
                  style={[styles.dropdownTrigger, updatingStatus ? styles.dropdownTriggerDisabled : null]}
                  disabled={updatingStatus}
                  onPress={() => setShowStatusSelector(true)}
                >
                  <Text style={styles.dropdownValue}>{statusLabel(ticket.status)}</Text>
                  {updatingStatus ? (
                    <ActivityIndicator size="small" color={themeColors.primaryStrong} />
                  ) : (
                    <Ionicons name="chevron-down" size={16} color="#3a4b61" />
                  )}
                </Pressable>
              )}
            </View>

            <View style={styles.dropdownGroup}>
              <Text style={styles.dropdownLabel}>Responsável</Text>
              {isHistoricalTicket ? (
                <View style={[styles.dropdownTrigger, styles.dropdownTriggerReadOnly]}>
                  <Text numberOfLines={1} style={styles.dropdownValue}>{assigneeLabel}</Text>
                  <Ionicons name="lock-closed-outline" size={14} color="#607086" />
                </View>
              ) : (
                <Pressable
                  style={[styles.dropdownTrigger, updatingAssignee ? styles.dropdownTriggerDisabled : null]}
                  disabled={updatingAssignee || assigneeSelectorOptions.length === 0}
                  onPress={() => setShowAssigneeSelector(true)}
                >
                  <Text numberOfLines={1} style={styles.dropdownValue}>{assigneeLabel}</Text>
                  {updatingAssignee ? (
                    <ActivityIndicator size="small" color={themeColors.primaryStrong} />
                  ) : (
                    <Ionicons name="chevron-down" size={16} color="#3a4b61" />
                  )}
                </Pressable>
              )}
            </View>
          </View>
          <View style={styles.ticketHistoryRow}>
            <Text style={styles.ticketHistoryHint}>{ticketHeaderLabel}</Text>
            <Pressable
              style={styles.ticketHistoryButton}
              onPress={() => setShowTicketHistory(true)}
              disabled={loadingTicketHistory || historyOptions.length === 0}
            >
              {loadingTicketHistory ? (
                <ActivityIndicator size="small" color={themeColors.primaryStrong} />
              ) : (
                <>
                  <Ionicons name="time-outline" size={14} color={themeColors.primaryStrong} />
                  <Text style={styles.ticketHistoryButtonText}>
                    {oldTicketsCount > 0 ? `Tickets anteriores (${oldTicketsCount})` : 'Histórico'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          {showBlockingMessagesLoader ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={themeColors.primary} />
              <Text style={styles.loadingText}>Carregando mensagens...</Text>
            </View>
          ) : (
            <View style={styles.messagesListWrap}>
              <FlatList
                ref={listRef}
                data={sortedMessages}
                keyExtractor={(item) => String(item.id)}
                initialNumToRender={24}
                maxToRenderPerBatch={20}
                windowSize={13}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.messagesContent}
                onScroll={onMessagesScroll}
                scrollEventThrottle={16}
                bounces={false}
                overScrollMode="never"
                onContentSizeChange={() => {
                  if (shouldStickToBottomRef.current) {
                    scrollToLatest(true);
                  }
                }}
                renderItem={({ item }) => {
                  const reply = item.reply_to_id ? messageMap.get(item.reply_to_id) || null : null;
                  const fromClient = item.sender === 'client';
                  const isSystem = item.sender === 'system';

                  return (
                    <SwipeReplyMessage
                      item={item}
                      reply={reply}
                      fromClient={fromClient}
                      isSystem={isSystem}
                      forceReadByView={isFocused}
                      onReply={(message) => {
                        if (isHistoricalTicket) return;
                        setReplyTo(message);
                      }}
                      renderContent={renderMessageContent}
                    />
                  );
                }}
              />

              {loading ? (
                <View pointerEvents="none" style={styles.softLoadingWrap}>
                  <View style={styles.softLoadingChip}>
                    <ActivityIndicator size="small" color={themeColors.primary} />
                    <Text style={styles.softLoadingText}>Atualizando mensagens...</Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {replyTo && !isHistoricalTicket ? (
            <View style={styles.replyComposer}>
              <View style={styles.replyComposerText}>
                <Text style={styles.replyComposerTitle}>Respondendo {senderLabel(replyTo.sender)}</Text>
                <Text style={styles.replyComposerValue} numberOfLines={1}>{messagePreviewLabel(replyTo)}</Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} style={styles.replyComposerCloseButton}>
                <Ionicons name="close" size={18} color={themeColors.muted} />
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.composer, Platform.OS === 'android' && keyboardHeight > 0 ? { marginBottom: keyboardHeight } : null]}>
            {isHistoricalTicket ? (
              <View style={styles.readOnlyComposer}>
                <Ionicons name="lock-closed-outline" size={18} color="#415870" />
                <Text style={styles.readOnlyComposerText}>
                  Ticket antigo em modo leitura. Use o ticket mais recente para responder.
                </Text>
              </View>
            ) : recording ? (
              <View style={styles.recordComposer}>
                <View style={styles.recordingInfo}>
                  <Text style={styles.recordingLabel}>Gravando áudio</Text>
                  <Text style={styles.recordTimer}>{`${formatDuration(recordingSeconds)}`}</Text>
                </View>
                <Pressable onPress={() => void stopRecording(false)} style={styles.recordActionButtonCancel}>
                  <Ionicons name="close" size={20} color="#fff" />
                </Pressable>
                <Pressable onPress={() => void stopRecording(true)} style={styles.recordActionButtonSend}>
                  <Ionicons name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.inputShell}>
                  <Pressable onPress={() => void handlePickImage(false)} style={styles.inputIconButton}>
                    <Ionicons name="add-circle-outline" size={22} color="#5f7288" />
                  </Pressable>

                  <Pressable onPress={handleOpenQuickMessages} style={styles.inputIconButton}>
                    <Ionicons name="flash-outline" size={20} color="#5f7288" />
                  </Pressable>

                  <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    style={styles.input}
                    placeholder="Digite uma mensagem"
                    placeholderTextColor="#8092a6"
                    editable={!sending}
                    multiline
                  />

                  <Pressable onPress={() => void handlePickImage(true)} style={styles.inputIconButton}>
                    <Ionicons name="camera-outline" size={21} color="#5f7288" />
                  </Pressable>
                </View>

                {canSendText ? (
                  <Pressable
                    onPress={() => void handleSendText()}
                    disabled={sending}
                    style={[
                      styles.actionFab,
                      styles.sendFab,
                      sending ? styles.actionFabDisabled : null,
                    ]}
                  >
                    <Ionicons name="send" size={20} color="#fff" />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => void startRecording()}
                    disabled={sending}
                    style={[styles.actionFab, styles.micFab, sending ? styles.actionFabDisabled : null]}
                  >
                    <Ionicons name="mic" size={20} color="#fff" />
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
      <ImageViewing
        images={previewImage ? [{ uri: previewImage }] : []}
        imageIndex={0}
        visible={!!previewImage}
        onRequestClose={() => setPreviewImage(null)}
      />
      <Modal transparent visible={quickMessagesVisible} animationType="fade" onRequestClose={closeQuickMessagesPanel}>
        <Pressable style={styles.quickOverlay} onPress={closeQuickMessagesPanel}>
          <Pressable style={styles.quickSheet} onPress={() => {}}>
            <View style={styles.quickSheetHead}>
              <Text style={styles.quickSheetTitle}>Mensagens rápidas</Text>
              <Pressable style={styles.quickCloseButton} onPress={closeQuickMessagesPanel}>
                <Ionicons name="close" size={20} color="#5b7088" />
              </Pressable>
            </View>

            <View style={styles.quickForm}>
              {editingQuickMessageId ? (
                <Text style={styles.quickEditHint}>Editando mensagem</Text>
              ) : null}
              <TextInput
                value={quickFormText}
                onChangeText={setQuickFormText}
                style={styles.quickFormInput}
                placeholder="Digite a mensagem rápida"
                placeholderTextColor="#8092a6"
                multiline
                numberOfLines={3}
                maxLength={5000}
                editable={!quickActionLoading}
              />
              <Pressable
                style={[styles.quickSaveButton, quickActionLoading ? styles.quickSaveButtonDisabled : null]}
                disabled={quickActionLoading}
                onPress={() => void handleQuickSave()}
              >
                {quickActionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.quickSaveButtonText}>
                    {editingQuickMessageId ? 'Salvar edição' : 'Salvar mensagem'}
                  </Text>
                )}
              </Pressable>
            </View>

            <ScrollView style={styles.quickList} contentContainerStyle={styles.quickListContent}>
              {quickMessagesLoading ? (
                <View style={styles.quickEmptyWrap}>
                  <ActivityIndicator color={themeColors.primaryStrong} />
                  <Text style={styles.quickEmptyText}>Carregando mensagens...</Text>
                </View>
              ) : null}

              {!quickMessagesLoading && quickMessages.length === 0 ? (
                <View style={styles.quickEmptyWrap}>
                  <Text style={styles.quickEmptyText}>Nenhuma mensagem rápida cadastrada.</Text>
                </View>
              ) : null}

              {!quickMessagesLoading ? quickMessages.map((item) => (
                <View key={String(item.id)} style={styles.quickItemCard}>
                  <Pressable
                    onPress={() => handleQuickInsert(item)}
                    style={styles.quickItemPick}
                    disabled={quickActionLoading}
                  >
                    <Text numberOfLines={3} style={styles.quickItemText}>{item.content}</Text>
                  </Pressable>
                  <View style={styles.quickItemActions}>
                    <Pressable
                      style={styles.quickEditButton}
                      onPress={() => handleQuickEdit(item)}
                      disabled={quickActionLoading}
                    >
                      <Text style={styles.quickEditButtonText}>Editar</Text>
                    </Pressable>
                    <Pressable
                      style={styles.quickDeleteButton}
                      onPress={() => handleQuickDelete(item)}
                      disabled={quickActionLoading}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <SelectorModal
        visible={showStatusSelector}
        title="Alterar status do ticket"
        options={statusSelectorOptions}
        onClose={() => setShowStatusSelector(false)}
      />
      <SelectorModal
        visible={showAssigneeSelector}
        title="Atribuir responsável"
        options={assigneeSelectorOptions}
        onClose={() => setShowAssigneeSelector(false)}
      />
      <SelectorModal
        visible={showTicketHistory}
        title="Histórico de tickets do cliente"
        options={historyOptions}
        onClose={() => setShowTicketHistory(false)}
      />
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  container: { flex: 1, backgroundColor: lightColors.background },
  header: {
    borderBottomWidth: 1,
    borderColor: lightColors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f0fe',
  },
  backButtonText: {
    color: lightColors.primaryStrong,
    fontWeight: '800',
    fontSize: 16,
  },
  contactAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#e6edf7',
  },
  contactAvatarImage: {
    width: '100%',
    height: '100%',
  },
  contactAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8e3f5',
  },
  contactAvatarInitial: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3c4a5f',
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: lightColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: lightColors.muted,
    fontSize: 12,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  connectionBadge: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  onlineBadge: {
    color: '#1256a4',
    backgroundColor: '#e4efff',
  },
  offlineBadge: {
    color: '#9a3412',
    backgroundColor: '#ffedd5',
  },
  statusRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: 1,
    borderColor: '#dce6f5',
    backgroundColor: '#f8fbff',
  },
  ticketHistoryRow: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderColor: '#dce6f5',
    backgroundColor: '#f8fbff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketHistoryHint: {
    flex: 1,
    minWidth: 0,
    color: '#5d6e82',
    fontSize: 12,
    fontWeight: '700',
  },
  ticketHistoryButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c8daf5',
    backgroundColor: '#eef5ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketHistoryButtonText: {
    color: lightColors.primaryStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  dropdownGroup: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dropdownLabel: {
    color: '#607086',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dropdownTrigger: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: '#cfdcf0',
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dropdownTriggerDisabled: {
    opacity: 0.75,
  },
  dropdownTriggerReadOnly: {
    backgroundColor: '#f0f5fb',
  },
  dropdownValue: {
    flex: 1,
    minWidth: 0,
    color: '#223248',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  messagesListWrap: {
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
  messagesContent: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    paddingBottom: 14,
    gap: 6,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
  },
  messageAnimatedWrap: {
    maxWidth: '86%',
  },
  messageRowClient: {
    justifyContent: 'flex-start',
    paddingRight: 42,
    paddingLeft: 2,
  },
  messageRowAgent: {
    justifyContent: 'flex-end',
    paddingLeft: 42,
    paddingRight: 2,
  },
  messageRowSystem: {
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  messageBubble: {
    maxWidth: '100%',
    minWidth: 74,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 4,
    overflow: 'hidden',
  },
  bubbleClient: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 4,
  },
  bubbleAgent: {
    backgroundColor: '#d9fdd3',
    borderTopRightRadius: 4,
  },
  bubbleSystem: {
    backgroundColor: '#eef4ff',
  },
  messageText: {
    color: '#111b21',
    fontSize: 15,
    lineHeight: 21,
    flexShrink: 1,
  },
  messageMetaRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 1,
  },
  messageMetaSystem: {
    alignSelf: 'center',
  },
  messageTime: {
    color: '#667781',
    fontSize: 11,
    lineHeight: 13,
  },
  metaIcon: {
    marginBottom: -1,
    marginLeft: 1,
  },
  messageMediaWrap: {
    width: 250,
    maxWidth: '100%',
    alignSelf: 'center',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e8eef7',
  },
  messageStickerWrap: {
    alignSelf: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
  messageImage: {
    width: '100%',
    height: 250,
    borderRadius: 10,
  },
  messageSticker: {
    width: 160,
    height: 160,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  messageVideo: {
    width: '100%',
    height: 230,
    borderRadius: 10,
    backgroundColor: '#000',
  },
  documentLabel: {
    color: lightColors.primaryStrong,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  replyPreview: {
    borderLeftWidth: 3,
    borderLeftColor: '#34b7f1',
    backgroundColor: 'rgba(17,24,39,0.06)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  replyAuthor: {
    color: '#005c4b',
    fontWeight: '700',
    fontSize: 12,
  },
  replyText: {
    color: '#485b70',
    fontSize: 12,
  },
  replyComposer: {
    borderTopWidth: 1,
    borderColor: '#d6e2f2',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  replyComposerText: {
    flex: 1,
    minWidth: 0,
  },
  replyComposerTitle: {
    fontSize: 12,
    color: lightColors.primaryStrong,
    fontWeight: '700',
  },
  replyComposerValue: {
    fontSize: 12,
    color: '#4d5a64',
  },
  replyComposerCloseButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    borderTopWidth: 1,
    borderColor: '#d6e2f2',
    backgroundColor: '#eff3f8',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  readOnlyComposer: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccd9ea',
    backgroundColor: '#f3f7fc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  readOnlyComposerText: {
    flex: 1,
    minWidth: 0,
    color: '#415870',
    fontSize: 12,
    fontWeight: '600',
  },
  inputShell: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#cad7ea',
    borderRadius: 24,
    paddingLeft: 6,
    paddingRight: 6,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  inputIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 140,
    paddingHorizontal: 6,
    paddingVertical: 9,
    backgroundColor: '#fff',
    color: lightColors.text,
    fontSize: 15,
  },
  actionFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  actionFabDisabled: {
    opacity: 0.55,
  },
  micFab: {
    backgroundColor: '#2b6fdb',
  },
  sendFab: {
    backgroundColor: lightColors.primaryStrong,
  },
  recordComposer: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#d7dee8',
    backgroundColor: '#fff',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingInfo: {
    flex: 1,
    minWidth: 0,
  },
  recordingLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0b57d0',
  },
  recordTimer: {
    color: '#6b7280',
    fontWeight: '600',
    fontSize: 12,
  },
  recordActionButtonCancel: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d92d20',
  },
  recordActionButtonSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.primaryStrong,
  },
  selectorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  selectorSheet: {
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#dbe7f6',
  },
  selectorTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1f2f46',
    marginBottom: 2,
  },
  selectorItem: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e3ecf8',
    backgroundColor: '#f9fbff',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectorItemActive: {
    borderColor: '#b8d2ff',
    backgroundColor: '#eaf2ff',
  },
  selectorItemDisabled: {
    opacity: 0.6,
  },
  selectorItemText: {
    color: '#2f3f55',
    fontSize: 13,
    fontWeight: '600',
  },
  selectorItemTextActive: {
    color: lightColors.primaryStrong,
    fontWeight: '700',
  },
  quickOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  quickSheet: {
    maxHeight: '74%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbe6f5',
    backgroundColor: '#fff',
    padding: 12,
    gap: 10,
  },
  quickSheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickSheetTitle: {
    color: '#1f2f46',
    fontSize: 18,
    fontWeight: '800',
  },
  quickCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d3e0f2',
    backgroundColor: '#f4f8ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickForm: {
    borderWidth: 1,
    borderColor: '#d6e3f4',
    borderRadius: 12,
    backgroundColor: '#f8fbff',
    padding: 10,
    gap: 8,
  },
  quickEditHint: {
    color: '#446182',
    fontSize: 12,
    fontWeight: '700',
  },
  quickFormInput: {
    borderWidth: 1,
    borderColor: '#c8d8ee',
    borderRadius: 10,
    backgroundColor: '#fff',
    color: lightColors.text,
    minHeight: 56,
    maxHeight: 140,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 20,
  },
  quickSaveButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(11,87,208,0.42)',
    backgroundColor: lightColors.primaryStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSaveButtonDisabled: {
    opacity: 0.65,
  },
  quickSaveButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  quickList: {
    maxHeight: 360,
  },
  quickListContent: {
    gap: 8,
    paddingBottom: 8,
  },
  quickEmptyWrap: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cad9ed',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickEmptyText: {
    color: '#617892',
    fontSize: 13,
    textAlign: 'center',
  },
  quickItemCard: {
    borderWidth: 1,
    borderColor: '#d9e6f7',
    borderRadius: 12,
    backgroundColor: '#f9fcff',
    padding: 10,
    gap: 8,
  },
  quickItemPick: {
    borderRadius: 8,
    paddingVertical: 2,
  },
  quickItemText: {
    color: '#27445f',
    fontSize: 14,
    lineHeight: 19,
  },
  quickItemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  quickEditButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c8d8ee',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickEditButtonText: {
    color: '#21466f',
    fontWeight: '700',
    fontSize: 12,
  },
  quickDeleteButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#d92d20',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const darkStyles = StyleSheet.create({
  safeArea: { backgroundColor: '#0b141a' },
  container: { backgroundColor: '#0b141a' },
  header: {
    backgroundColor: '#111b21',
    borderColor: '#223244',
  },
  backButton: {
    backgroundColor: '#14293c',
  },
  backButtonText: {
    color: '#c5daff',
  },
  contactAvatarWrap: {
    backgroundColor: '#1c3246',
  },
  contactAvatarFallback: {
    backgroundColor: '#243d53',
  },
  contactAvatarInitial: {
    color: '#c6dbf5',
  },
  headerTitle: {
    color: '#e9edef',
  },
  headerSubtitle: {
    color: '#a1b5cb',
  },
  onlineBadge: {
    color: '#73c1ff',
    backgroundColor: '#16334f',
  },
  offlineBadge: {
    color: '#ffaf8f',
    backgroundColor: '#462821',
  },
  statusRow: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  ticketHistoryRow: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  ticketHistoryHint: {
    color: '#a1b5cb',
  },
  ticketHistoryButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  ticketHistoryButtonText: {
    color: '#c5daff',
  },
  dropdownLabel: {
    color: '#8da6c0',
  },
  dropdownTrigger: {
    borderColor: '#34506f',
    backgroundColor: '#102636',
  },
  dropdownTriggerReadOnly: {
    backgroundColor: '#1b3042',
  },
  dropdownValue: {
    color: '#e9edef',
  },
  loadingText: {
    color: '#a1b5cb',
  },
  softLoadingChip: {
    borderColor: '#29435c',
    backgroundColor: 'rgba(17,27,33,0.94)',
  },
  softLoadingText: {
    color: '#9dc5ff',
  },
  bubbleClient: {
    backgroundColor: '#202c33',
  },
  bubbleAgent: {
    backgroundColor: '#005c4b',
  },
  bubbleSystem: {
    backgroundColor: '#1c2a3a',
  },
  messageText: {
    color: '#e9edef',
  },
  messageTime: {
    color: '#93a7bc',
  },
  messageMediaWrap: {
    backgroundColor: '#192834',
  },
  documentLabel: {
    color: '#9dc5ff',
  },
  replyPreview: {
    backgroundColor: 'rgba(233,237,239,0.08)',
    borderLeftColor: '#53bdeb',
  },
  replyAuthor: {
    color: '#8fe4d1',
  },
  replyText: {
    color: '#c0d0de',
  },
  replyComposer: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  replyComposerTitle: {
    color: '#9dc5ff',
  },
  replyComposerValue: {
    color: '#c0d0de',
  },
  composer: {
    borderColor: '#223244',
    backgroundColor: '#111b21',
  },
  readOnlyComposer: {
    borderColor: '#29435c',
    backgroundColor: '#162839',
  },
  readOnlyComposerText: {
    color: '#c0d0de',
  },
  inputShell: {
    borderColor: '#29435c',
    backgroundColor: '#102636',
  },
  input: {
    backgroundColor: '#102636',
    color: '#e9edef',
  },
  micFab: {
    backgroundColor: '#1f77ff',
  },
  sendFab: {
    backgroundColor: '#1f77ff',
  },
  recordComposer: {
    borderColor: '#29435c',
    backgroundColor: '#102636',
  },
  recordingLabel: {
    color: '#8fb6ff',
  },
  recordTimer: {
    color: '#a1b5cb',
  },
  selectorSheet: {
    backgroundColor: '#111b21',
    borderColor: '#29435c',
  },
  selectorTitle: {
    color: '#e9edef',
  },
  selectorItem: {
    borderColor: '#29435c',
    backgroundColor: '#102636',
  },
  selectorItemActive: {
    borderColor: '#3c5d82',
    backgroundColor: '#16334f',
  },
  selectorItemText: {
    color: '#d6e3f0',
  },
  selectorItemTextActive: {
    color: '#8fb6ff',
  },
  quickSheet: {
    borderColor: '#29435c',
    backgroundColor: '#111b21',
  },
  quickSheetTitle: {
    color: '#e9edef',
  },
  quickCloseButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  quickForm: {
    borderColor: '#29435c',
    backgroundColor: '#102636',
  },
  quickEditHint: {
    color: '#9eb4ca',
  },
  quickFormInput: {
    borderColor: '#34506f',
    backgroundColor: '#0b2438',
    color: '#e9edef',
  },
  quickEmptyWrap: {
    borderColor: '#34506f',
  },
  quickEmptyText: {
    color: '#a1b5cb',
  },
  quickItemCard: {
    borderColor: '#29435c',
    backgroundColor: '#102636',
  },
  quickItemText: {
    color: '#d6e3f0',
  },
  quickEditButton: {
    borderColor: '#34506f',
    backgroundColor: '#14293c',
  },
  quickEditButtonText: {
    color: '#c5daff',
  },
});

runtimeStyles = lightStyles;
