import type { Ticket } from './chat';

export type RootStackParamList = {
  Login: undefined;
  SetupAdmin: undefined;
  Tickets: undefined;
  Chat: { ticket: Ticket };
  Admin: undefined;
};
