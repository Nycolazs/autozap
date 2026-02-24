import { requestJson } from './client';
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
} from '../types/admin';

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

export function listAdminTickets(): Promise<AdminTicket[]> {
  return requestJson<AdminTicket[]>('/admin/tickets?includeAll=1', { method: 'GET' });
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
