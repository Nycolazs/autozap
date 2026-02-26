import { requestJson } from '@/src/frontend/lib/http';
import type {
  Assignee,
  AuthSession,
  ChatMessage,
  ConnectionStatus,
  DueTicketReminder,
  QuickMessage,
  ProfilePictureResponse,
  TicketReminder,
  Ticket,
  UserType,
} from '@/src/frontend/types/chat';

type SendTextPayload = {
  message: string;
  reply_to_id?: number;
};

type TicketListOptions = {
  userType: UserType;
  userId: number;
  includeClosed: boolean;
  limit?: number;
  offset?: number;
};

function pickFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return null;
}

function normalizeProfilePictureResponse(payload: unknown): ProfilePictureResponse {
  const source = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};

  const nestedData =
    source.data && typeof source.data === 'object'
      ? source.data as Record<string, unknown>
      : {};

  const url = pickFirstString([
    source.url,
    source.avatar_url,
    source.avatarUrl,
    source.profile_picture_url,
    source.profilePictureUrl,
    source.profile_pic_url,
    source.profilePicUrl,
    nestedData.url,
    nestedData.avatar_url,
    nestedData.avatarUrl,
    nestedData.profile_picture_url,
    nestedData.profilePictureUrl,
  ]);

  const fromCacheRaw = source.fromCache ?? source.from_cache ?? nestedData.fromCache ?? nestedData.from_cache;
  const pendingRaw = source.pending ?? nestedData.pending;
  const sourceRaw = source.source ?? source.avatar_source ?? nestedData.source ?? nestedData.avatar_source;
  const reasonRaw = source.reason ?? source.error_reason ?? nestedData.reason ?? nestedData.error_reason;

  return {
    url,
    fromCache: fromCacheRaw == null ? undefined : !!fromCacheRaw,
    pending: pendingRaw == null ? undefined : !!pendingRaw,
    source: sourceRaw == null ? undefined : String(sourceRaw || '').trim() || null,
    reason: reasonRaw == null ? undefined : String(reasonRaw || '').trim() || null,
  };
}

export function getAuthSession(): Promise<AuthSession> {
  return requestJson<AuthSession>('/auth/session', { method: 'GET' });
}

export function getConnectionStatus(): Promise<ConnectionStatus> {
  return requestJson<ConnectionStatus>('/connection-status', { method: 'GET' });
}

export async function listTickets(options: TicketListOptions): Promise<Ticket[]> {
  const limit = Number(options.limit || 200);
  const offset = Number(options.offset || 0);

  if (options.userType === 'admin') {
    const all = await requestJson<Ticket[]>(
      `/admin/tickets?includeAll=1&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      { method: 'GET' }
    );

    if (options.includeClosed) return all;
    return all.filter((ticket) => ticket.status !== 'resolvido' && ticket.status !== 'encerrado');
  }

  return requestJson<Ticket[]>(
    `/tickets/seller/${encodeURIComponent(options.userId)}?includeClosed=${options.includeClosed ? '1' : '0'}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    { method: 'GET' }
  );
}

export function getTicketMessages(ticketId: number, limit = 250): Promise<ChatMessage[]> {
  return requestJson<ChatMessage[]>(
    `/tickets/${encodeURIComponent(ticketId)}/messages?limit=${encodeURIComponent(limit)}`,
    { method: 'GET' }
  );
}

export function getTicketById(ticketId: number): Promise<Ticket> {
  return requestJson<Ticket>(
    `/tickets/${encodeURIComponent(ticketId)}`,
    { method: 'GET' }
  );
}

export function listContactTickets(phone: string, limit = 100): Promise<Ticket[]> {
  const normalized = String(phone || '').split('@')[0].replace(/\D/g, '');
  return requestJson<Ticket[]>(
    `/contacts/${encodeURIComponent(normalized)}/tickets?limit=${encodeURIComponent(limit)}`,
    { method: 'GET' }
  );
}

export function sendTextMessage(ticketId: number, payload: SendTextPayload): Promise<{ success: true }> {
  return requestJson<{ success: true }>(
    `/tickets/${encodeURIComponent(ticketId)}/send`,
    {
      method: 'POST',
      body: payload,
    }
  );
}

export function sendAudioMessage(
  ticketId: number,
  audioBlob: Blob,
  mimeType: string,
  replyToId?: number
): Promise<{ success: true }> {
  const formData = new FormData();
  const extension = mimeType.includes('ogg')
    ? '.ogg'
    : mimeType.includes('webm')
      ? '.webm'
      : mimeType.includes('mp3') || mimeType.includes('mpeg')
        ? '.mp3'
        : '.m4a';
  formData.append('audio', audioBlob, `recorded-audio${extension}`);
  if (replyToId) formData.append('reply_to_id', String(replyToId));

  return requestJson<{ success: true }>(
    `/tickets/${encodeURIComponent(ticketId)}/send-audio`,
    {
      method: 'POST',
      body: formData,
    }
  );
}

export function sendImageMessage(
  ticketId: number,
  imageFile: File,
  options?: {
    caption?: string;
    replyToId?: number;
  }
): Promise<{ success: true }> {
  const formData = new FormData();
  formData.append('image', imageFile, imageFile.name || `image-${Date.now()}.jpg`);

  const caption = String(options?.caption || '').trim();
  if (caption) formData.append('caption', caption);
  if (options?.replyToId) formData.append('reply_to_id', String(options.replyToId));

  return requestJson<{ success: true }>(
    `/tickets/${encodeURIComponent(ticketId)}/send-image`,
    {
      method: 'POST',
      body: formData,
    }
  );
}

export function updateTicketStatus(ticketId: number, status: Ticket['status']): Promise<{ success: true }> {
  return requestJson<{ success: true }>(
    `/tickets/${encodeURIComponent(ticketId)}/status`,
    {
      method: 'PATCH',
      body: { status },
    }
  );
}

export function markTicketReadByAgent(ticketId: number): Promise<{ success: true; updated?: number; lastReadMessageId?: number }> {
  return requestJson<{ success: true; updated?: number; lastReadMessageId?: number }>(
    `/tickets/${encodeURIComponent(ticketId)}/mark-read-by-agent`,
    { method: 'POST' }
  );
}

export function listAssignees(): Promise<Assignee[]> {
  return requestJson<Assignee[]>('/assignees', { method: 'GET' });
}

export function assignTicket(ticketId: number, sellerId: number | null): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(
    `/tickets/${encodeURIComponent(ticketId)}/assign`,
    {
      method: 'POST',
      body: { sellerId },
    }
  );
}

export function listTicketReminders(ticketId: number): Promise<TicketReminder[]> {
  return requestJson<TicketReminder[]>(
    `/tickets/${encodeURIComponent(ticketId)}/reminders`,
    { method: 'GET' }
  );
}

export function createTicketReminder(
  ticketId: number,
  payload: { scheduled_at: string; note?: string | null; message?: string | null }
): Promise<TicketReminder> {
  return requestJson<TicketReminder>(
    `/tickets/${encodeURIComponent(ticketId)}/reminders`,
    {
      method: 'POST',
      body: payload,
    }
  );
}

export function updateReminder(
  reminderId: number,
  payload: {
    scheduled_at?: string;
    note?: string | null;
    message?: string | null;
    status?: 'scheduled' | 'canceled' | 'done' | 'resolvido';
  }
): Promise<TicketReminder> {
  return requestJson<TicketReminder>(
    `/reminders/${encodeURIComponent(reminderId)}`,
    {
      method: 'PATCH',
      body: payload,
    }
  );
}

export function listDueReminders(): Promise<DueTicketReminder[]> {
  return requestJson<DueTicketReminder[]>(
    '/reminders/due',
    { method: 'GET' }
  );
}

export function listQuickMessages(): Promise<QuickMessage[]> {
  return requestJson<QuickMessage[]>(
    '/quick-messages',
    { method: 'GET' }
  );
}

export function createQuickMessage(payload: {
  title: string;
  content: string;
  shortcut?: string | null;
}): Promise<QuickMessage> {
  return requestJson<QuickMessage>(
    '/quick-messages',
    {
      method: 'POST',
      body: payload,
    }
  );
}

export function updateQuickMessage(
  quickMessageId: number,
  payload: {
    title?: string;
    content?: string;
    shortcut?: string | null;
  }
): Promise<QuickMessage> {
  return requestJson<QuickMessage>(
    `/quick-messages/${encodeURIComponent(quickMessageId)}`,
    {
      method: 'PATCH',
      body: payload,
    }
  );
}

export function deleteQuickMessage(quickMessageId: number): Promise<{ success: true }> {
  return requestJson<{ success: true }>(
    `/quick-messages/${encodeURIComponent(quickMessageId)}`,
    { method: 'DELETE' }
  );
}

export async function fetchProfilePicture(
  phone: string,
  options?: { refresh?: boolean }
): Promise<ProfilePictureResponse> {
  const normalized = String(phone || '').split('@')[0].replace(/\D/g, '');
  const refreshSuffix = options && options.refresh ? '?refresh=1' : '';
  const payload = await requestJson<unknown>(
    `/profile-picture/${encodeURIComponent(normalized)}${refreshSuffix}`,
    { method: 'GET' }
  );
  return normalizeProfilePictureResponse(payload);
}

export function logout(): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/auth/logout', { method: 'POST' });
}
