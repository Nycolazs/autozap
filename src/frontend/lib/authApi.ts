import { requestJson } from '@/src/frontend/lib/http';

export interface HasAdminResponse {
  hasAdmin: boolean;
  adminCount: number;
}

export interface LoginResponse {
  success: boolean;
  userId: number;
  userType: 'admin' | 'seller';
  userName: string;
  accessToken: string;
}

export function getHasAdmin(): Promise<HasAdminResponse> {
  return requestJson<HasAdminResponse>('/auth/has-admin', { method: 'GET' });
}

export function login(payload: { username: string; password: string }): Promise<LoginResponse> {
  return requestJson<LoginResponse>('/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export function setupAdmin(payload: { username: string; password: string }): Promise<{ success: true }> {
  return requestJson<{ success: true }>('/auth/setup-admin', {
    method: 'POST',
    body: payload,
  });
}
