import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, resolveMediaUrl } from '@/src/frontend/lib/runtime';
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

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;

function normalizeMessageType(message: ChatMessage): string {
  if (message.message_type) return message.message_type;

  const content = String(message.content || '').trim().toLowerCase();
  const mediaUrl = String(message.media_url || '').toLowerCase();

  if (content === '[figurinha]' || mediaUrl.endsWith('.webp') || mediaUrl.includes('.webp?')) {
    return 'sticker';
  }

  if (message.media_url) {
    if (message.media_url.includes('/audios/')) return 'audio';
    if (message.media_url.includes('/images/')) return 'image';
    if (message.media_url.includes('/stickers/')) return 'sticker';
    if (message.media_url.includes('/videos/')) return 'video';
    if (message.media_url.includes('/documents/')) return 'document';
  }
  return 'text';
}

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

function renderMessageContent(
  message: ChatMessage,
  messageType: string,
  onOpenImage: (src: string, caption: string) => void
) {
  if ((messageType === 'image' || messageType === 'sticker') && message.media_url) {
    const src = resolveMediaUrl(message.media_url);
    const explicitCaption = hasExplicitCaption(message) ? String(message.content || '').trim() : '';

    return (
      <>
        <img
          className={messageType === 'sticker' ? styles.messageSticker : styles.messageImage}
          src={src}
          alt={messageType === 'sticker' ? 'Figurinha' : 'Imagem enviada'}
          loading="lazy"
          onClick={() => onOpenImage(src, explicitCaption)}
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
