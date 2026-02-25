import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, resolveMediaObjectUrl, resolveMediaUrl } from '@/src/frontend/lib/runtime';
import { AudioMessagePlayer } from '@/src/frontend/components/chat/AudioMessagePlayer';
import type { ChatMessage } from '@/src/frontend/types/chat';
import styles from '@/src/frontend/components/chat/chat.module.css';

type MessageListProps = {
  ticketSelected: boolean;
  messages: ChatMessage[];
  onReply: (message: ChatMessage) => void;
};

type ImagePreview = {
  src: string;
  caption: string;
};

type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | null;

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;

function normalizeStoredMessageType(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'image') return 'image';
  if (normalized === 'audio') return 'audio';
  if (normalized === 'video') return 'video';
  if (normalized === 'sticker') return 'sticker';
  if (normalized === 'document') return 'document';
  if (normalized === 'system') return 'system';
  if (normalized === 'text') return 'text';
  return null;
}

function inferMediaTypeFromContent(rawValue: string): string | null {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized === '[imagem]'
    || normalized === '[image]'
    || normalized === '🖼️ imagem'
  ) {
    return 'image';
  }

  if (
    normalized === '[figurinha]'
    || normalized === '[sticker]'
    || normalized === '🧩 figurinha'
  ) {
    return 'sticker';
  }

  if (
    normalized === '[áudio]'
    || normalized === '[audio]'
    || normalized === '🎵 áudio'
    || normalized === '🎤 áudio'
  ) {
    return 'audio';
  }

  if (
    normalized === '[vídeo]'
    || normalized === '[video]'
    || normalized === '🎬 vídeo'
  ) {
    return 'video';
  }

  if (
    normalized === '[documento]'
    || normalized.startsWith('[documento:')
    || normalized === '📄 documento'
  ) {
    return 'document';
  }

  return null;
}

function inferMediaTypeFromUrl(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  if (!value) return null;

  const lower = value.toLowerCase();
  if (lower.includes('/audios/')) return 'audio';
  if (lower.includes('/images/')) return 'image';
  if (lower.includes('/stickers/')) return 'sticker';
  if (lower.includes('/videos/')) return 'video';
  if (lower.includes('/documents/')) return 'document';
  if (/\.webp(?:\?|$)/i.test(lower)) return 'sticker';

  try {
    const parsed = new URL(value, 'http://localhost');
    const type = String(parsed.searchParams.get('type') || '').trim().toLowerCase();
    if (type === 'image') return 'image';
    if (type === 'audio') return 'audio';
    if (type === 'video') return 'video';
    if (type === 'sticker') return 'sticker';
    if (type === 'document') return 'document';
  } catch (_) {}

  return null;
}

function normalizeMessageType(message: ChatMessage): string {
  const storedType = normalizeStoredMessageType(message.message_type);
  if (storedType) return storedType;

  const content = String(message.content || '').trim().toLowerCase();
  const typeFromUrl = inferMediaTypeFromUrl(message.media_url || '');
  if (typeFromUrl) return typeFromUrl;

  const typeFromContent = inferMediaTypeFromContent(content);
  if (typeFromContent) return typeFromContent;

  return 'text';
}

function isMediaPlaceholderText(rawValue: string): boolean {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return false;

  return new Set([
    '[imagem]',
    '[image]',
    '[figurinha]',
    '[sticker]',
    '[áudio]',
    '[audio]',
    '[vídeo]',
    '[video]',
    '[documento]',
    '[document]',
    '🖼️ imagem',
    '🧩 figurinha',
    '🎵 áudio',
    '🎤 áudio',
    '🎬 vídeo',
    '📄 documento',
  ]).has(normalized);
}

function hasExplicitCaption(message: ChatMessage): boolean {
  const value = String(message.content || '').trim();
  if (!value) return false;
  return !isMediaPlaceholderText(value);
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('button, a, input, textarea, select, audio, video');
}

type ResolvedMediaImageProps = {
  mediaPath: string;
  className: string;
  alt: string;
  caption: string;
  onOpenImage: (src: string, caption: string) => void;
};

function ResolvedMediaImage({ mediaPath, className, alt, caption, onOpenImage }: ResolvedMediaImageProps) {
  const [src, setSrc] = useState(() => resolveMediaUrl(mediaPath));

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const direct = resolveMediaUrl(mediaPath);
    setSrc(direct);

    (async () => {
      const resolved = await resolveMediaObjectUrl(mediaPath, { forceAuthFetch: true });
      if (cancelled) {
        if (/^blob:/i.test(resolved)) {
          try { URL.revokeObjectURL(resolved); } catch (_) {}
        }
        return;
      }
      setSrc(resolved || direct);
      if (/^blob:/i.test(resolved)) {
        objectUrl = resolved;
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      }
    };
  }, [mediaPath]);

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onClick={() => onOpenImage(src, caption)}
    />
  );
}

function renderMessageContent(
  message: ChatMessage,
  messageType: string,
  onOpenImage: (src: string, caption: string) => void
) {
  if ((messageType === 'image' || messageType === 'sticker') && message.media_url) {
    const explicitCaption = hasExplicitCaption(message) ? String(message.content || '').trim() : '';

    return (
      <>
        <ResolvedMediaImage
          mediaPath={message.media_url}
          className={messageType === 'sticker' ? styles.messageSticker : styles.messageImage}
          alt={messageType === 'sticker' ? 'Figurinha' : 'Imagem enviada'}
          caption={explicitCaption}
          onOpenImage={onOpenImage}
        />
        {explicitCaption ? (
          <div className={styles.messageText}>{explicitCaption}</div>
        ) : null}
      </>
    );
  }

  if (messageType === 'video' && message.media_url) {
    return (
      <video className={styles.messageVideo} controls preload="metadata" src={resolveMediaUrl(message.media_url)}>
        Seu navegador não suporta vídeo HTML5.
      </video>
    );
  }

  if (messageType === 'audio' && message.media_url) {
    return (
      <AudioMessagePlayer
        src={resolveMediaUrl(message.media_url)}
        isOutgoing={message.sender === 'agent'}
      />
    );
  }

  if (messageType === 'document' && message.media_url) {
    const url = resolveMediaUrl(message.media_url);
    return (
      <a className={styles.messageDocument} href={url} target="_blank" rel="noreferrer">
        Abrir documento
      </a>
    );
  }

  return <div className={styles.messageText}>{message.content}</div>;
}

function bubbleClass(sender: ChatMessage['sender']): string {
  if (sender === 'agent') return styles.bubbleAgent;
  if (sender === 'client') return styles.bubbleClient;
  return styles.bubbleSystem;
}

function rowClass(sender: ChatMessage['sender']): string {
  if (sender === 'agent') return styles.messageAgent;
  if (sender === 'client') return styles.messageClient;
  return styles.messageSystem;
}

function normalizeDeliveryStatusValue(rawValue: unknown): DeliveryStatus {
  if (rawValue == null) return null;

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    if (rawValue < 0) return 'failed';
    if (rawValue <= 1) return 'sent';
    if (rawValue === 2) return 'delivered';
    return 'read';
  }

  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'failed' || normalized === 'error') return 'failed';
  if (normalized === 'read' || normalized === 'played') return 'read';
  if (normalized === 'delivered' || normalized === 'delivery') return 'delivered';
  if (normalized === 'sent' || normalized === 'server_ack' || normalized === 'pending') return 'sent';

  if (/^-?\d+$/.test(normalized)) {
    return normalizeDeliveryStatusValue(Number(normalized));
  }

  const ackMatch = normalized.match(/ack[^0-9-]*(-?\d+)/i);
  if (ackMatch && ackMatch[1]) {
    return normalizeDeliveryStatusValue(Number(ackMatch[1]));
  }

  if (normalized.includes('fail') || normalized.includes('erro')) return 'failed';
  if (normalized.includes('read') || normalized.includes('play')) return 'read';
  if (normalized.includes('deliver') || normalized.includes('receiv')) return 'delivered';
  if (normalized.includes('sent') || normalized.includes('server')) return 'sent';

  return null;
}

function normalizeDeliveryStatus(message: ChatMessage): DeliveryStatus {
  if (message.sender !== 'agent') return null;
  const source = message as unknown as Record<string, unknown>;

  const candidateValues = [
    source.message_status,
    source.messageStatus,
    source.delivery_status,
    source.deliveryStatus,
    source.status,
    source.whatsapp_status,
    source.ack,
  ];

  for (const value of candidateValues) {
    const normalized = normalizeDeliveryStatusValue(value);
    if (normalized) return normalized;
  }

  const rawPayload = source.whatsapp_message;
  if (typeof rawPayload === 'string' && rawPayload.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
      const normalizedFromPayload = normalizeDeliveryStatusValue(parsed.status ?? parsed.ack);
      if (normalizedFromPayload) return normalizedFromPayload;
    } catch (_) {}
  }

  return 'sent';
}

function deliveryStatusLabel(status: Exclude<DeliveryStatus, null>): string {
  if (status === 'failed') return 'Falhou';
  if (status === 'read') return 'Lido';
  if (status === 'delivered') return 'Entregue';
  return 'Enviado';
}

function DeliveryStatusIcon({ status }: { status: Exclude<DeliveryStatus, null> }) {
  if (status === 'failed') {
    return <span className={styles.messageStatusFailedIcon}>!</span>;
  }

  if (status === 'sent') {
    return (
      <svg className={styles.messageStatusSvg} viewBox="0 0 12 10" aria-hidden="true">
        <path className={styles.messageStatusStroke} d="M1.1 5.4L3.9 8L9.6 2.2" />
      </svg>
    );
  }

  return (
    <svg className={styles.messageStatusSvg} viewBox="0 0 16 10" aria-hidden="true">
      <path className={styles.messageStatusStroke} d="M1.1 5.4L3.9 8L9.6 2.2" />
      <path className={styles.messageStatusStroke} d="M6.6 5.4L9.4 8L15.1 2.2" />
    </svg>
  );
}

function getLastMessageKey(messages: ChatMessage[]): string {
  if (!messages.length) return '';
  const last = messages[messages.length - 1];
  return `${last.id}:${String(last.updated_at || last.created_at || '')}`;
}

export function MessageList({ ticketSelected, messages, onReply }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageKeyRef = useRef('');
  const initialScrollDoneRef = useRef(false);

  const messageMap = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    for (const message of messages) {
      map.set(message.id, message);
    }
    return map;
  }, [messages]);

  const [preview, setPreview] = useState<ImagePreview | null>(null);

  const handleMessagesScroll = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!ticketSelected) {
      shouldStickToBottomRef.current = true;
      initialScrollDoneRef.current = false;
      lastMessageKeyRef.current = '';
    }
  }, [ticketSelected]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const nextKey = getLastMessageKey(messages);
    const changed = nextKey !== lastMessageKeyRef.current;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    const shouldAutoScroll = !initialScrollDoneRef.current || shouldStickToBottomRef.current || nearBottom;

    if (shouldAutoScroll && (changed || !initialScrollDoneRef.current)) {
      viewport.scrollTop = viewport.scrollHeight;
      shouldStickToBottomRef.current = true;
    }

    lastMessageKeyRef.current = nextKey;
    initialScrollDoneRef.current = true;
  }, [messages]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  if (!ticketSelected) {
    return (
      <div className={styles.messagesWrap}>
        <div className={styles.emptyChat}>
          Escolha um ticket para visualizar e responder mensagens.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={styles.messagesWrap}
      onScroll={handleMessagesScroll}
    >
      <div className={styles.messagesList}>
        {!messages.length ? (
          <div className={styles.emptyChat}>Ainda não há mensagens nesta conversa.</div>
        ) : null}

        {messages.map((message) => {
          const reply = message.reply_to_id ? messageMap.get(message.reply_to_id) : null;
          const messageType = normalizeMessageType(message);
          const deliveryStatus = normalizeDeliveryStatus(message);
          const isMediaBubble =
            messageType === 'image'
            || messageType === 'sticker'
            || messageType === 'audio'
            || messageType === 'video'
            || messageType === 'document';

          return (
            <div
              key={message.id}
              className={`${styles.messageRow} ${rowClass(message.sender)}`}
            >
              <article
                className={`${styles.messageBubble} ${bubbleClass(message.sender)} ${isMediaBubble ? styles.messageBubbleMedia : ''}`}
                onDoubleClick={(event) => {
                  if (message.sender === 'system') return;
                  if (isInteractiveTarget(event.target)) return;
                  onReply(message);
                }}
              >
                {reply ? (
                  <div className={styles.replyPreviewInBubble}>
                    <div className={styles.replyAuthor}>{reply.sender === 'agent' ? 'Você' : 'Cliente'}</div>
                    <div className={styles.replyText}>{messagePreviewLabel(reply)}</div>
                  </div>
                ) : null}

                {renderMessageContent(
                  message,
                  messageType,
                  (src, caption) => setPreview({ src, caption })
                )}

                <footer className={styles.messageFooter}>
                  <span className={styles.messageTime}>{formatTime(message.created_at)}</span>
                  {deliveryStatus ? (
                    <span
                      className={`${styles.messageStatus} ${deliveryStatus === 'read' ? styles.messageStatusRead : ''} ${deliveryStatus === 'failed' ? styles.messageStatusFailed : ''}`}
                      aria-label={`Status: ${deliveryStatusLabel(deliveryStatus)}`}
                      title={`Status: ${deliveryStatusLabel(deliveryStatus)}`}
                    >
                      <DeliveryStatusIcon status={deliveryStatus} />
                    </span>
                  ) : null}
                </footer>
              </article>
            </div>
          );
        })}
      </div>

      {preview ? (
        <div className={styles.mediaViewerOverlay} onClick={() => setPreview(null)}>
          <div className={styles.mediaViewerContent} onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={styles.mediaViewerClose}
              aria-label="Fechar imagem"
              onClick={() => setPreview(null)}
            >
              ×
            </button>
            <img className={styles.mediaViewerImage} src={preview.src} alt="Imagem em destaque" />
            {preview.caption ? (
              <div className={styles.mediaViewerCaption}>{preview.caption}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
