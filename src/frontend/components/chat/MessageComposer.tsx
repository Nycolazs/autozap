import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMobileBrowser } from '@/src/frontend/lib/runtime';
import type { ChatMessage, QuickMessage } from '@/src/frontend/types/chat';
import type { ToastType } from '@/src/frontend/hooks/useToast';
import styles from '@/src/frontend/components/chat/chat.module.css';

type MessageComposerProps = {
  disabled: boolean;
  replyTo: ChatMessage | null;
  onClearReply: () => void;
  onSendText: (message: string) => Promise<void>;
  onSendImage: (file: File, caption: string) => Promise<void>;
  onSendAudio: (blob: Blob, mimeType: string) => Promise<void>;
  quickMessages: QuickMessage[];
  quickMessagesLoading?: boolean;
  onCreateQuickMessage: (payload: { title: string; content: string; shortcut?: string | null }) => Promise<void>;
  onUpdateQuickMessage: (
    quickMessageId: number,
    payload: { title?: string; content?: string; shortcut?: string | null }
  ) => Promise<void>;
  onDeleteQuickMessage: (quickMessageId: number) => Promise<void>;
  onToast: (message: string, type?: ToastType) => void;
};

const HOLD_DELAY_MS = 120;
const SWIPE_CANCEL_THRESHOLD_PX = 86;
const SWIPE_CLAMP_PX = 132;

function isMediaPlaceholderText(rawValue: string): boolean {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return false;

  return new Set([
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
  ]).has(normalized);
}

function normalizeMessageType(message: ChatMessage): string {
  if (message.message_type) return message.message_type;

  const mediaUrl = String(message.media_url || '').toLowerCase();
  if (mediaUrl.includes('/audios/')) return 'audio';
  if (mediaUrl.includes('/images/')) return 'image';
  if (mediaUrl.includes('/stickers/')) return 'sticker';
  if (mediaUrl.includes('/videos/')) return 'video';
  if (mediaUrl.includes('/documents/')) return 'document';
  return 'text';
}

function replyPreviewLabel(message: ChatMessage): string {
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

function pickBestRecorderMimeType(): string {
  if (typeof window === 'undefined') return '';
  if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';

  const preferred = [
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ];

  for (const candidate of preferred) {
    try {
      if (window.MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch (_) {}
  }
  return '';
}

function findTouchById(touches: TouchList, id: number | null): Touch | null {
  if (id == null) return touches.length ? touches[0] : null;
  for (let i = 0; i < touches.length; i += 1) {
    if (touches[i].identifier === id) return touches[i];
  }
  return null;
}

function normalizeQuickShortcut(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24).toLowerCase();
  return normalized || null;
}

export function MessageComposer({
  disabled,
  replyTo,
  onClearReply,
  onSendText,
  onSendImage,
  onSendAudio,
  quickMessages,
  quickMessagesLoading = false,
  onCreateQuickMessage,
  onUpdateQuickMessage,
  onDeleteQuickMessage,
  onToast,
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickFormTitle, setQuickFormTitle] = useState('');
  const [quickFormShortcut, setQuickFormShortcut] = useState('');
  const [quickFormContent, setQuickFormContent] = useState('');
  const [quickActionLoading, setQuickActionLoading] = useState(false);
  const [editingQuickMessageId, setEditingQuickMessageId] = useState<number | null>(null);
  const [editQuickTitle, setEditQuickTitle] = useState('');
  const [editQuickShortcut, setEditQuickShortcut] = useState('');
  const [editQuickContent, setEditQuickContent] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);

  const isMobile = useMemo(() => isMobileBrowser(), []);
  const canSendText = !disabled && !isSending && !!message.trim();

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const attachWrapRef = useRef<HTMLDivElement | null>(null);
  const quickWrapRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<number | null>(null);
  const shouldSendRef = useRef(false);
  const canceledFeedbackRef = useRef(false);

  const holdTimerRef = useRef<number | null>(null);
  const touchSessionRef = useRef(false);
  const activeTouchIdRef = useRef<number | null>(null);
  const touchStartXRef = useRef(0);
  const cancelArmedRef = useRef(false);
  cancelArmedRef.current = cancelArmed;

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current != null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const stopRecordTracks = useCallback(() => {
    if (!recordStreamRef.current) return;
    for (const track of recordStreamRef.current.getTracks()) {
      try {
        track.stop();
      } catch (_) {}
    }
    recordStreamRef.current = null;
  }, []);

  const resetRecordingUi = useCallback(() => {
    clearRecordTimer();
    setDurationSec(0);
    setSwipeOffset(0);
    setCancelArmed(false);
    setIsRecording(false);
  }, [clearRecordTimer]);

  const detachGlobalTouchListeners = useCallback(() => {
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchCancel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeTouchSession = useCallback(() => {
    touchSessionRef.current = false;
    activeTouchIdRef.current = null;
    clearHoldTimer();
    detachGlobalTouchListeners();
    setSwipeOffset(0);
    setCancelArmed(false);
  }, [clearHoldTimer, detachGlobalTouchListeners]);

  const stopRecording = useCallback((shouldSend: boolean, showCancelFeedback = false) => {
    shouldSendRef.current = shouldSend;
    canceledFeedbackRef.current = showCancelFeedback && !shouldSend;

    const recorder = recorderRef.current;
    if (!recorder) {
      if (!shouldSend && showCancelFeedback) {
        onToast('Gravação cancelada.', 'info');
      }
      resetRecordingUi();
      return;
    }

    if (recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }

    stopRecordTracks();
    recorderRef.current = null;
    resetRecordingUi();
  }, [onToast, resetRecordingUi, stopRecordTracks]);

  const startRecording = useCallback(async () => {
    if (disabled || isSending || isRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onToast('Seu navegador não suporta gravação de áudio.', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorderMimeType = pickBestRecorderMimeType();
      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream);

      recordStreamRef.current = stream;
      recorderRef.current = recorder;
      recordChunksRef.current = [];
      recordStartRef.current = Date.now();
      shouldSendRef.current = false;
      canceledFeedbackRef.current = false;
      setDurationSec(0);
      setIsRecording(true);

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const finishedRecorder = recorderRef.current;
        const chunks = [...recordChunksRef.current];
        const duration = (Date.now() - recordStartRef.current) / 1000;
        const sendThisRecording = shouldSendRef.current;
        const shouldShowCanceled = canceledFeedbackRef.current;
        const mimeType = String((finishedRecorder && finishedRecorder.mimeType) || recorderMimeType || 'audio/webm');

        recorderRef.current = null;
        recordChunksRef.current = [];
        shouldSendRef.current = false;
        canceledFeedbackRef.current = false;
        stopRecordTracks();
        resetRecordingUi();

        if (!sendThisRecording) {
          if (shouldShowCanceled) onToast('Gravação cancelada.', 'info');
          return;
        }

        if (duration < 1) {
          onToast('Áudio muito curto. Grave por pelo menos 1 segundo.', 'warning');
          return;
        }

        try {
          setIsSending(true);
          const blob = new Blob(chunks, { type: mimeType });
          await onSendAudio(blob, mimeType);
        } catch (_) {
          onToast('Falha ao enviar áudio.', 'error');
        } finally {
          setIsSending(false);
        }
      };

      recorder.start();

      clearRecordTimer();
      recordTimerRef.current = window.setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - recordStartRef.current) / 1000));
        setDurationSec(elapsed);
      }, 200);
    } catch (error) {
      resetRecordingUi();
      stopRecordTracks();
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        onToast('Permissão de microfone negada. Ative o microfone nas permissões do app.', 'error');
        return;
      }
      onToast('Não foi possível acessar o microfone.', 'error');
    }
  }, [
    clearRecordTimer,
    disabled,
    isRecording,
    isSending,
    onSendAudio,
    onToast,
    resetRecordingUi,
    stopRecordTracks,
  ]);

  const finalizeTouch = useCallback((canceledBySystem: boolean) => {
    const shouldCancel = canceledBySystem || cancelArmedRef.current;
    completeTouchSession();
    if (!isRecording) return;
    stopRecording(!shouldCancel, shouldCancel);
  }, [completeTouchSession, isRecording, stopRecording]);

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!touchSessionRef.current) return;
    const touch = findTouchById(event.touches, activeTouchIdRef.current);
    if (!touch) return;

    const deltaX = touch.clientX - touchStartXRef.current;

    if (!isRecording) {
      if (Math.abs(deltaX) > 18) {
        clearHoldTimer();
      }
      return;
    }

    event.preventDefault();
    const clamped = Math.max(-SWIPE_CLAMP_PX, Math.min(0, deltaX));
    setSwipeOffset(clamped);
    setCancelArmed(Math.abs(clamped) >= SWIPE_CANCEL_THRESHOLD_PX);
  }, [clearHoldTimer, isRecording]);

  const handleTouchEnd = useCallback((event: TouchEvent) => {
    if (!touchSessionRef.current) return;
    event.preventDefault();
    finalizeTouch(false);
  }, [finalizeTouch]);

  const handleTouchCancel = useCallback((event: TouchEvent) => {
    if (!touchSessionRef.current) return;
    event.preventDefault();
    finalizeTouch(true);
  }, [finalizeTouch]);

  const handleRecordTouchStart = useCallback((event: React.TouchEvent<HTMLButtonElement>) => {
    if (!isMobile || disabled || isSending || touchSessionRef.current) return;
    if (event.cancelable) event.preventDefault();

    const touch = event.touches[0];
    if (!touch) return;

    touchSessionRef.current = true;
    activeTouchIdRef.current = touch.identifier;
    touchStartXRef.current = touch.clientX;
    setSwipeOffset(0);
    setCancelArmed(false);

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      if (!touchSessionRef.current) return;
      startRecording();
    }, HOLD_DELAY_MS);

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: false });
  }, [
    clearHoldTimer,
    disabled,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    isMobile,
    isSending,
    startRecording,
  ]);

  const handleRecordClick = useCallback(() => {
    if (isMobile || disabled || isSending) return;
    if (isRecording) return;
    startRecording();
  }, [disabled, isMobile, isRecording, isSending, startRecording]);

  const sendText = useCallback(async () => {
    const value = message.trim();
    if (!value || disabled || isSending) return;

    try {
      setIsSending(true);
      await onSendText(value);
      setMessage('');
    } catch (_) {
      onToast('Falha ao enviar mensagem.', 'error');
    } finally {
      setIsSending(false);
    }
  }, [disabled, isSending, message, onSendText, onToast]);

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendText();
  }, [sendText]);

  const handleImageChosen = useCallback(async (file: File | null) => {
    if (!file || disabled || isSending) return;

    try {
      setIsSending(true);
      await onSendImage(file, message.trim());
      setMessage('');
      setMediaMenuOpen(false);
    } catch (_) {
      onToast('Falha ao enviar imagem.', 'error');
    } finally {
      setIsSending(false);
    }
  }, [disabled, isSending, message, onSendImage, onToast]);

  const filteredQuickMessages = useMemo(() => {
    const needle = String(quickSearch || '').trim().toLowerCase();
    if (!needle) return quickMessages;

    return quickMessages.filter((item) => {
      const title = String(item.title || '').toLowerCase();
      const content = String(item.content || '').toLowerCase();
      const shortcut = String(item.shortcut || '').toLowerCase();
      return title.includes(needle) || content.includes(needle) || shortcut.includes(needle);
    });
  }, [quickMessages, quickSearch]);

  const clearQuickEditState = useCallback(() => {
    setEditingQuickMessageId(null);
    setEditQuickTitle('');
    setEditQuickShortcut('');
    setEditQuickContent('');
  }, []);

  const startQuickEdit = useCallback((item: QuickMessage) => {
    setEditingQuickMessageId(Number(item.id));
    setEditQuickTitle(String(item.title || ''));
    setEditQuickShortcut(String(item.shortcut || ''));
    setEditQuickContent(String(item.content || ''));
  }, []);

  const handleQuickInsert = useCallback((item: QuickMessage) => {
    const text = String(item.content || '').trim();
    if (!text) {
      onToast('A mensagem rápida está vazia.', 'warning');
      return;
    }
    setMessage(text);
    setQuickPanelOpen(false);
    window.setTimeout(() => {
      if (composerInputRef.current) composerInputRef.current.focus();
    }, 0);
  }, [onToast]);

  const handleQuickSend = useCallback(async (item: QuickMessage) => {
    const text = String(item.content || '').trim();
    if (!text) {
      onToast('A mensagem rápida está vazia.', 'warning');
      return;
    }
    if (disabled || isSending) return;

    try {
      setIsSending(true);
      await onSendText(text);
      setMessage('');
      setQuickPanelOpen(false);
    } catch (_) {
      onToast('Falha ao enviar mensagem rápida.', 'error');
    } finally {
      setIsSending(false);
    }
  }, [disabled, isSending, onSendText, onToast]);

  const handleCreateQuick = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (quickActionLoading) return;

    const title = String(quickFormTitle || '').trim();
    const content = String(quickFormContent || '').trim();
    const shortcut = normalizeQuickShortcut(quickFormShortcut);
    if (!title || !content) {
      onToast('Preencha título e mensagem da resposta rápida.', 'warning');
      return;
    }

    try {
      setQuickActionLoading(true);
      await onCreateQuickMessage({ title, content, shortcut });
      setQuickFormTitle('');
      setQuickFormShortcut('');
      setQuickFormContent('');
    } catch (_) {
      // Toast tratado no container
    } finally {
      setQuickActionLoading(false);
    }
  }, [
    onCreateQuickMessage,
    onToast,
    quickActionLoading,
    quickFormContent,
    quickFormShortcut,
    quickFormTitle,
  ]);

  const handleUpdateQuick = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingQuickMessageId || quickActionLoading) return;

    const title = String(editQuickTitle || '').trim();
    const content = String(editQuickContent || '').trim();
    const shortcut = normalizeQuickShortcut(editQuickShortcut);
    if (!title || !content) {
      onToast('Preencha título e mensagem da resposta rápida.', 'warning');
      return;
    }

    try {
      setQuickActionLoading(true);
      await onUpdateQuickMessage(editingQuickMessageId, { title, content, shortcut });
      clearQuickEditState();
    } catch (_) {
      // Toast tratado no container
    } finally {
      setQuickActionLoading(false);
    }
  }, [
    clearQuickEditState,
    editQuickContent,
    editQuickShortcut,
    editQuickTitle,
    editingQuickMessageId,
    onToast,
    onUpdateQuickMessage,
    quickActionLoading,
  ]);

  const handleDeleteQuick = useCallback(async (quickMessageId: number) => {
    if (quickActionLoading) return;
    const confirmed = window.confirm('Remover esta mensagem rápida?');
    if (!confirmed) return;

    try {
      setQuickActionLoading(true);
      await onDeleteQuickMessage(quickMessageId);
      if (Number(editingQuickMessageId) === Number(quickMessageId)) {
        clearQuickEditState();
      }
    } catch (_) {
      // Toast tratado no container
    } finally {
      setQuickActionLoading(false);
    }
  }, [clearQuickEditState, editingQuickMessageId, onDeleteQuickMessage, quickActionLoading]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;

      if (attachWrapRef.current && !attachWrapRef.current.contains(target)) {
        setMediaMenuOpen(false);
      }

      if (quickWrapRef.current && !quickWrapRef.current.contains(target)) {
        setQuickPanelOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!disabled) return;
    setMediaMenuOpen(false);
    setQuickPanelOpen(false);
  }, [disabled]);

  useEffect(() => {
    return () => {
      clearHoldTimer();
      completeTouchSession();
      stopRecording(false, false);
      stopRecordTracks();
      clearRecordTimer();
      setMediaMenuOpen(false);
      setQuickPanelOpen(false);
      clearQuickEditState();
    };
  }, [
    clearHoldTimer,
    clearRecordTimer,
    clearQuickEditState,
    completeTouchSession,
    stopRecordTracks,
    stopRecording,
  ]);

  const recordingLabel = useMemo(() => {
    const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const ss = String(durationSec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }, [durationSec]);

  return (
    <div className={styles.composerArea}>
      {replyTo ? (
        <div className={styles.replyComposer}>
          <div className={styles.replyComposerText}>
            <div className={styles.replyComposerTitle}>Respondendo</div>
            <div className={styles.replyComposerValue}>{replyPreviewLabel(replyTo)}</div>
          </div>
          <button type="button" className={styles.clearReply} onClick={onClearReply} aria-label="Cancelar resposta">
            ×
          </button>
        </div>
      ) : null}

      {!isMobile && isRecording ? (
        <div className={styles.recordComposer}>
          <div className={styles.recordingInfo}>
            <div className={styles.recordingLabel}>Gravando áudio</div>
            <div className={styles.recordTimer}>{recordingLabel}</div>
          </div>
          <button
            type="button"
            className={styles.recordActionButtonCancel}
            onClick={() => stopRecording(false, true)}
            disabled={disabled || isSending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.recordActionButtonSend}
            onClick={() => stopRecording(true, false)}
            disabled={disabled || isSending}
          >
            Enviar
          </button>
        </div>
      ) : (
        <div className={styles.composerRow}>
          <div ref={attachWrapRef} className={styles.attachWrap}>
            <button
              type="button"
              className={styles.roundButton}
              disabled={disabled || isSending}
              onClick={() => {
                if (isMobile) {
                  setMediaMenuOpen((prev) => !prev);
                  return;
                }
                galleryInputRef.current?.click();
              }}
              aria-label="Anexar foto"
              title="Enviar foto"
            >
              📷
            </button>

            {isMobile && mediaMenuOpen ? (
              <div className={styles.mediaMenu}>
                <button
                  type="button"
                  className={styles.mediaMenuButton}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  🖼️ Escolher da galeria
                </button>
                <button
                  type="button"
                  className={styles.mediaMenuButton}
                  onClick={() => cameraInputRef.current?.click()}
                >
                  📸 Tirar foto
                </button>
              </div>
            ) : null}

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                void handleImageChosen(file);
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                void handleImageChosen(file);
                event.currentTarget.value = '';
              }}
            />
          </div>

          <div ref={quickWrapRef} className={styles.quickWrap}>
            <button
              type="button"
              className={`${styles.roundButton} ${quickPanelOpen ? styles.roundButtonActive : ''}`}
              disabled={disabled || isSending}
              onClick={() => {
                setQuickPanelOpen((prev) => !prev);
                setMediaMenuOpen(false);
              }}
              aria-label="Mensagens rápidas"
              title="Mensagens rápidas"
            >
              ⚡
            </button>

            {quickPanelOpen ? (
              <div className={styles.quickPanel} role="dialog" aria-label="Mensagens rápidas">
                <div className={styles.quickPanelHead}>
                  <strong className={styles.quickPanelTitle}>Mensagens rápidas</strong>
                  <button
                    type="button"
                    className={styles.quickPanelClose}
                    onClick={() => setQuickPanelOpen(false)}
                    aria-label="Fechar painel"
                  >
                    ×
                  </button>
                </div>

                <input
                  className={styles.quickSearch}
                  placeholder="Buscar por título, atalho ou texto"
                  value={quickSearch}
                  onChange={(event) => setQuickSearch(event.target.value)}
                />

                <form className={styles.quickForm} onSubmit={handleCreateQuick}>
                  <input
                    className={styles.quickInput}
                    placeholder="Título da mensagem"
                    value={quickFormTitle}
                    onChange={(event) => setQuickFormTitle(event.target.value)}
                    maxLength={120}
                  />
                  <input
                    className={styles.quickInput}
                    placeholder="Atalho opcional (ex: saudacao)"
                    value={quickFormShortcut}
                    onChange={(event) => setQuickFormShortcut(event.target.value)}
                    maxLength={24}
                  />
                  <textarea
                    className={styles.quickTextarea}
                    placeholder="Texto da mensagem rápida"
                    value={quickFormContent}
                    onChange={(event) => setQuickFormContent(event.target.value)}
                    maxLength={5000}
                  />
                  <button type="submit" className={styles.quickPrimaryButton} disabled={quickActionLoading}>
                    Salvar mensagem rápida
                  </button>
                </form>

                <div className={styles.quickList}>
                  {quickMessagesLoading ? (
                    <div className={styles.quickEmpty}>Carregando mensagens rápidas...</div>
                  ) : null}

                  {!quickMessagesLoading && filteredQuickMessages.length === 0 ? (
                    <div className={styles.quickEmpty}>Nenhuma mensagem rápida encontrada.</div>
                  ) : null}

                  {!quickMessagesLoading ? filteredQuickMessages.map((item) => (
                    <article key={item.id} className={styles.quickItem}>
                      {Number(editingQuickMessageId) === Number(item.id) ? (
                        <form className={styles.quickEditForm} onSubmit={handleUpdateQuick}>
                          <input
                            className={styles.quickInput}
                            value={editQuickTitle}
                            onChange={(event) => setEditQuickTitle(event.target.value)}
                            maxLength={120}
                          />
                          <input
                            className={styles.quickInput}
                            value={editQuickShortcut}
                            onChange={(event) => setEditQuickShortcut(event.target.value)}
                            placeholder="Atalho opcional"
                            maxLength={24}
                          />
                          <textarea
                            className={styles.quickTextarea}
                            value={editQuickContent}
                            onChange={(event) => setEditQuickContent(event.target.value)}
                            maxLength={5000}
                          />
                          <div className={styles.quickItemActions}>
                            <button type="submit" className={styles.quickPrimaryButton} disabled={quickActionLoading}>
                              Salvar
                            </button>
                            <button
                              type="button"
                              className={styles.quickGhostButton}
                              onClick={clearQuickEditState}
                              disabled={quickActionLoading}
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className={styles.quickItemHead}>
                            <strong className={styles.quickItemTitle}>{item.title}</strong>
                            {item.shortcut ? <span className={styles.quickShortcut}>/{item.shortcut}</span> : null}
                          </div>
                          <p className={styles.quickItemContent}>{item.content}</p>
                          <div className={styles.quickItemActions}>
                            <button
                              type="button"
                              className={styles.quickPrimaryButton}
                              onClick={() => handleQuickInsert(item)}
                              disabled={quickActionLoading}
                            >
                              Inserir
                            </button>
                            <button
                              type="button"
                              className={styles.quickGhostButton}
                              onClick={() => void handleQuickSend(item)}
                              disabled={disabled || isSending || quickActionLoading}
                            >
                              Enviar
                            </button>
                            <button
                              type="button"
                              className={styles.quickGhostButton}
                              onClick={() => startQuickEdit(item)}
                              disabled={quickActionLoading}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className={styles.quickDangerButton}
                              onClick={() => void handleDeleteQuick(item.id)}
                              disabled={quickActionLoading}
                            >
                              Excluir
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  )) : null}
                </div>
              </div>
            ) : null}
          </div>

          <textarea
            ref={composerInputRef}
            className={styles.composerInput}
            placeholder={disabled ? 'Conversa bloqueada para envio.' : 'Digite uma mensagem'}
            value={message}
            disabled={disabled || isSending}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
          />

          <button
            type="button"
            className={`${styles.roundButton} ${isRecording ? styles.roundButtonRecordActive : ''}`}
            disabled={disabled || isSending}
            style={isRecording ? { transform: `translateX(${swipeOffset}px)` } : undefined}
            onTouchStart={handleRecordTouchStart}
            onClick={handleRecordClick}
            aria-label="Gravar áudio"
            title={isMobile ? 'Segure para gravar áudio' : 'Clique para gravar áudio'}
          >
            🎤
          </button>

          <button
            type="button"
            className={styles.sendButton}
            disabled={!canSendText}
            onClick={() => void sendText()}
          >
            <span className={styles.sendButtonText}>Enviar</span>
            <span aria-hidden="true">➤</span>
          </button>
        </div>
      )}

      {isMobile && isRecording ? (
        <div className={`${styles.recordingHint} ${cancelArmed ? styles.recordingHintCancel : ''}`}>
          Gravando {recordingLabel} • {cancelArmed ? 'Solte para cancelar' : 'Arraste para a esquerda para cancelar'}
        </div>
      ) : null}
    </div>
  );
}
