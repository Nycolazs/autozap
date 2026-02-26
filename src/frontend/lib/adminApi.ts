import { ApiRequestError, requestJson } from '@/src/frontend/lib/http';
import type {
  AdminTicket,
  AdminUser,
  Assignee,
  AwaitConfig,
  BlacklistEntry,
  BusinessException,
  BusinessHour,
  BusinessMessage,
  RankingResponse,
  WelcomeMessage,
} from '@/src/frontend/types/admin';

export function listUsers(): Promise<AdminUser[]> {
  return requestJson<AdminUser[]>('/users', { method: 'GET' });
}

export function createSeller(payload: { name: string; password: string }): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/sellers', {
    method: 'POST',
    body: payload,
  });
}

export function updateSeller(id: number, payload: { name?: string; active?: boolean; password?: string }): Promise<{ success: true }> {
  return requestJson<{ success: true }>(`/sellers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function makeSellerAdmin(sellerId: number): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/sellers/${encodeURIComponent(sellerId)}/make-admin`, {
    method: 'POST',
  });
}

export function removeSellerRoleFromAdmin(name: string): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/users/${encodeURIComponent(name)}/remove-seller`, {
    method: 'POST',
  });
}

export function revertUserToSeller(name: string): Promise<{ success: true; message?: string; sessionDestroyed?: boolean }> {
  return requestJson<{ success: true; message?: string; sessionDestroyed?: boolean }>(`/users/${encodeURIComponent(name)}/revert-to-seller`, {
    method: 'POST',
  });
}

export function removeSellerOnly(sellerId: number): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/users/${encodeURIComponent(sellerId)}/remove-seller-only`, {
    method: 'POST',
  });
}

export function changeAdminPassword(userId: number, newPassword: string): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/users/${encodeURIComponent(userId)}/change-password`, {
    method: 'POST',
    body: { newPassword },
  });
}

export function changeSellerPassword(sellerId: number, newPassword: string): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/sellers/${encodeURIComponent(sellerId)}/change-password`, {
    method: 'POST',
    body: { newPassword },
  });
}

type ListAdminTicketsOptions = {
  sellerId?: number | null;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
};

const WELCOME_ENDPOINTS = ['/welcome-message', '/admin/welcome-message'] as const;
const DEFAULT_WELCOME_MESSAGE = '👋 Olá! Seja bem-vindo(a)! Um de nossos atendentes já vai responder você. Por favor, aguarde um momento.';

function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

function normalizeTicketStatus(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  if (normalized === 'em_atendimento' || normalized === 'ematendimento') return 'em_atendimento';
  if (normalized === 'pendente') return 'pendente';
  if (normalized === 'aguardando') return 'aguardando';
  if (normalized === 'resolvido') return 'resolvido';
  if (normalized === 'encerrado') return 'encerrado';
  return normalized;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeAdminTicket(input: unknown): AdminTicket | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;

  const id = Number(row.id ?? row.ticket_id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const sellerId = parseNullableNumber(row.seller_id ?? row.sellerId ?? row.assigned_to ?? row.assignedTo);
  const contactNameRaw = row.contact_name ?? row.contactName ?? null;
  const sellerNameRaw = row.seller_name ?? row.sellerName ?? row.assigned_to_name ?? null;
  const updatedAtRaw = row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt ?? new Date().toISOString();

  return {
    id,
    phone: String(row.phone || ''),
    contact_name: contactNameRaw == null ? null : String(contactNameRaw),
    seller_id: sellerId,
    seller_name: sellerNameRaw == null ? null : String(sellerNameRaw),
    status: normalizeTicketStatus(row.status),
    updated_at: String(updatedAtRaw),
  };
}

export async function listAdminTickets(options: ListAdminTicketsOptions = {}): Promise<AdminTicket[]> {
  const qs = new URLSearchParams();
  qs.set('includeAll', '1');
  if (typeof options.limit === 'number') qs.set('limit', String(options.limit));
  if (typeof options.offset === 'number') qs.set('offset', String(options.offset));
  if (options.sellerId === null) qs.set('sellerId', '__unassigned__');
  if (typeof options.sellerId === 'number' && Number.isFinite(options.sellerId)) {
    qs.set('sellerId', String(options.sellerId));
  }
  if (options.status) qs.set('status', options.status);
  if (options.startDate) {
    qs.set('startDate', options.startDate);
    qs.set('fromDate', options.startDate);
  }
  if (options.endDate) {
    qs.set('endDate', options.endDate);
    qs.set('toDate', options.endDate);
  }
  const response = await requestJson<unknown>(`/admin/tickets?${qs.toString()}`, { method: 'GET' });
  if (!Array.isArray(response)) return [];
  return response
    .map((item) => normalizeAdminTicket(item))
    .filter((item): item is AdminTicket => item != null);
}

export function listAssignees(): Promise<Assignee[]> {
  return requestJson<Assignee[]>('/assignees', { method: 'GET' });
}

export function assignTicket(ticketId: number, sellerId: number | null): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>(`/tickets/${encodeURIComponent(ticketId)}/assign`, {
    method: 'POST',
    body: { sellerId },
  });
}

export function listBlacklist(): Promise<BlacklistEntry[]> {
  return requestJson<BlacklistEntry[]>('/blacklist', { method: 'GET' });
}

export function addBlacklist(payload: { phone: string; reason?: string }): Promise<{ message: string }> {
  return requestJson<{ message: string }>('/blacklist', {
    method: 'POST',
    body: payload,
  });
}

export function removeBlacklist(phone: string): Promise<{ message: string }> {
  return requestJson<{ message: string }>(`/blacklist/${encodeURIComponent(phone)}`, {
    method: 'DELETE',
  });
}

export function getBusinessHours(): Promise<BusinessHour[]> {
  return requestJson<BusinessHour[]>('/business-hours', { method: 'GET' });
}

export function saveBusinessHours(payload: BusinessHour[]): Promise<{ success: true; message?: string }> {
  return requestJson<{ success: true; message?: string }>('/business-hours', {
    method: 'PUT',
    body: payload,
  });
}

export function listBusinessExceptions(): Promise<BusinessException[]> {
  return requestJson<BusinessException[]>('/business-exceptions', { method: 'GET' });
}

export function addBusinessException(payload: {
  date: string;
  closed: boolean;
  open_time?: string | null;
  close_time?: string | null;
  reason?: string | null;
}): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/business-exceptions', {
    method: 'POST',
    body: payload,
  });
}

export function removeBusinessException(id: number): Promise<{ success: true }> {
  return requestJson<{ success: true }>(`/business-exceptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function getBusinessMessage(): Promise<BusinessMessage> {
  return requestJson<BusinessMessage>('/business-message', { method: 'GET' });
}

export function saveBusinessMessage(payload: { message: string; enabled: boolean }): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/business-message', {
    method: 'PUT',
    body: payload,
  });
}

export async function getWelcomeMessage(): Promise<WelcomeMessage> {
  for (let index = 0; index < WELCOME_ENDPOINTS.length; index += 1) {
    const endpoint = WELCOME_ENDPOINTS[index];
    try {
      return await requestJson<WelcomeMessage>(endpoint, { method: 'GET' });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  return {
    message: DEFAULT_WELCOME_MESSAGE,
    enabled: true,
  };
}

export async function saveWelcomeMessage(payload: { message: string; enabled: boolean }): Promise<{ success: true }> {
  for (let index = 0; index < WELCOME_ENDPOINTS.length; index += 1) {
    const endpoint = WELCOME_ENDPOINTS[index];
    try {
      return await requestJson<{ success: true }>(endpoint, {
        method: 'PUT',
        body: payload,
      });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw new Error('Configuração de boas-vindas indisponível no backend atual.');
}

export function getAwaitConfig(): Promise<AwaitConfig> {
  return requestJson<AwaitConfig>('/admin/await-config', { method: 'GET' });
}

export function saveAwaitConfig(minutes: number): Promise<{ success: true; minutes: number }> {
  return requestJson<{ success: true; minutes: number }>('/admin/await-config', {
    method: 'PUT',
    body: { minutes },
  });
}

export function getRanking(startDate: string, endDate: string): Promise<RankingResponse> {
  const qs = `startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  return requestJson<RankingResponse>(`/admin/ranking-sellers?${qs}`, { method: 'GET' });
}
