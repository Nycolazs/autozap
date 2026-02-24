import { requestJson } from '@/src/frontend/lib/http';
import type {
  Assignee,
  AuthSession,
  ChatMessage,
  ConnectionStatus,
  ProfilePictureResponse,
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

export function fetchProfilePicture(phone: string): Promise<ProfilePictureResponse> {
  const normalized = String(phone || '').split('@')[0].replace(/\D/g, '');
  return requestJson<ProfilePictureResponse>(
    `/profile-picture/${encodeURIComponent(normalized)}`,
    { method: 'GET' }
  );
}

export function logout(): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/auth/logout', { method: 'POST' });
}
