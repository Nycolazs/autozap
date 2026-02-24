export type AdminSectionKey = 'users' | 'tickets' | 'blacklist' | 'hours' | 'await' | 'ranking';

export interface AdminUser {
  id: string;
  name: string;
  isAdmin: boolean;
  isSeller: boolean;
  sellerActive: boolean;
  created_at: string | null;
}

export interface AdminTicket {
  id: number;
  phone: string;
  contact_name: string | null;
  seller_id: number | null;
  seller_name: string | null;
  status: string;
  updated_at: string;
}

export interface Assignee {
  id: number;
  name: string;
}

export interface BlacklistEntry {
  id?: number;
  phone: string;
  reason: string | null;
  created_at?: string;
}

export interface BusinessHour {
  day: number;
  open_time: string | null;
  close_time: string | null;
  enabled: boolean;
}

export interface BusinessException {
  id: number;
  date: string;
  closed: boolean;
  open_time: string | null;
  close_time: string | null;
  reason: string | null;
}

export interface BusinessMessage {
  message: string;
  enabled: boolean;
}

export interface AwaitConfig {
  minutes: number;
}

export interface RankingSeller {
  seller_id: number;
  seller_name: string;
  tickets_resolved: number;
}

export interface RankingResponse {
  ranking: RankingSeller[];
  period?: {
    startDate: string;
    endDate: string;
  };
}
