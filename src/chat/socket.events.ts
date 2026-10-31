/**
 * Socket.io contract (docs/04-api-contract.md §5).
 * There is no shared package: the frontend keeps an identical copy of this file
 * (frontend/src/lib/socket/events.ts). Change both together.
 */
import type { Server, Socket } from 'socket.io';
import type { MatchType } from '../generated/prisma/client';
import type { SkillRefDto } from '../skills/dto/skill-ref.dto';
import type { UserCardDto } from '../users/dto/user-card.dto';

export const ClientEvents = {
  MatchJoin: 'match:join',
  MatchLeave: 'match:leave',
  ChatSend: 'chat:send',
  ChatTyping: 'chat:typing',
  ChatRead: 'chat:read',
} as const;

export const ServerEvents = {
  ChatMessage: 'chat:message',
  ChatTyping: 'chat:typing',
  ChatRead: 'chat:read',
  MatchNew: 'match:new',
  SessionUpdate: 'session:update',
  ChainProposed: 'chain:proposed',
  ChainUpdate: 'chain:update',
  Presence: 'presence',
  Error: 'error',
} as const;

export interface MatchNewPayload {
  matchId: string;
  score: number;
  type: MatchType;
  otherUser: UserCardDto;
  learnSkill: SkillRefDto;
  teachSkill: SkillRefDto | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

/** server -> client */
export interface ServerToClientEvents {
  [ServerEvents.MatchNew]: (payload: MatchNewPayload) => void;
  [ServerEvents.Error]: (payload: ErrorPayload) => void;
}

/** client -> server (chat events arrive in Phase 8) */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}

export interface SocketData {
  userId: string;
}

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** Every user is in their own room, so anything can be pushed to them by id. */
export const userRoom = (userId: string): string => `user:${userId}`;
export const matchRoom = (matchId: string): string => `match:${matchId}`;
