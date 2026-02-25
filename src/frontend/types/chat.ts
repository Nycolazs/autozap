export type UserType = 'admin' | 'seller';

export type TicketStatus =
  | 'pendente'
  | 'aguardando'
  | 'em_atendimento'
  | 'resolvido'
  | 'encerrado';

export type MessageSender = 'agent' | 'client' | 'system';

export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'document'
  | 'system';

export interface AuthSession {
  authenticated: boolean;
  userId: number;
  userName: string;
  userType: UserType;
}

export interface ConnectionStatus {
  connected: boolean;
  connectionState: string;
  message: string;
}

export interface Assignee {
  id: number;
  name: string;
}

export interface Ticket {
  id: number;
  phone: string;
  contact_name: string | null;
  seller_id?: number | null;
  seller_name?: string | null;
  avatar_url?: string | null;
  status: TicketStatus;
  updated_at: string;
  created_at?: string;
}

export interface ChatMessage {
  id: number;
  ticket_id: number;
  sender: MessageSender;
  sender_name: string | null;
  content: string;
  message_type: MessageType | null;
  media_url: string | null;
  whatsapp_message_id?: string | null;
  message_status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
  message_status_updated_at?: string | null;
  reply_to_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProfilePictureResponse {
  url: string | null;
  fromCache?: boolean;
  pending?: boolean;
  source?: string | null;
}

export interface TicketReminder {
  id: number;
  ticket_id: number;
  seller_id: number;
  note: string | null;
  message: string | null;
  scheduled_at: string;
  status: 'scheduled' | 'canceled' | 'done' | 'resolvido';
  notified_at?: string | null;
  created_by_user_id?: number | null;
  created_by_type?: string | null;
  created_at: string;
  updated_at: string;
}
