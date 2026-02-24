import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMobileBrowser } from '@/src/frontend/lib/runtime';
import type { ChatMessage } from '@/src/frontend/types/chat';
import type { ToastType } from '@/src/frontend/hooks/useToast';
import styles from '@/src/frontend/components/chat/chat.module.css';

type MessageComposerProps = {
  disabled: boolean;
  replyTo: ChatMessage | null;
  onClearReply: () => void;
  onSendText: (message: string) => Promise<void>;
  onSendImage: (file: File, caption: string) => Promise<void>;
  onSendAudio: (blob: Blob, mimeType: string) => Promise<void>;
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

export function MessageComposer({
  disabled,
  replyTo,
  onClearReply,
  onSendText,
  onSendImage,
  onSendAudio,
  onToast,
}: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);

  const isMobile = useMemo(() => isMobileBrowser(), []);
  const canSendText = !disabled && !isSending && !!message.trim();

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const attachWrapRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!attachWrapRef.current) return;
      if (attachWrapRef.current.contains(event.target as Node)) return;
      setMediaMenuOpen(false);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    return () => {
      clearHoldTimer();
      completeTouchSession();
      stopRecording(false, false);
      stopRecordTracks();
      clearRecordTimer();
      setMediaMenuOpen(false);
    };
  }, [
    clearHoldTimer,
    clearRecordTimer,
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

          <textarea
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
