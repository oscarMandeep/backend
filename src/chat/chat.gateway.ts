import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Events,
  type MatchCreatedEvent,
  type SessionEvent,
} from '../common/events';
import { RateLimiter } from '../common/utils/rate-limiter';
import type { Env } from '../config/env.schema';
import { MatchStatus } from '../generated/prisma/client';
import { MatchesService } from '../matches/matches.service';
import { SessionsService } from '../sessions/sessions.service';
import { ChatService } from './chat.service';
import {
  ChatReadDto,
  ChatSendDto,
  ChatTypingDto,
  MatchRefDto,
} from './dto/socket-payloads.dto';
import {
  Ack,
  ClientEvents,
  matchRoom,
  ServerEvents,
  userRoom,
  type AppServer,
  type AppSocket,
} from './socket.events';

const MESSAGES_PER_MINUTE = 30;
const MATCH_ROOM_PREFIX = 'match:';

/** Validates an untrusted socket payload; null when it does not match the DTO. */
async function parse<T extends object>(
  cls: new () => T,
  payload: unknown,
): Promise<T | null> {
  if (typeof payload !== 'object' || payload === null) return null;
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length === 0 ? instance : null;
}

const INVALID: Ack = { ok: false, code: 'VALIDATION_FAILED' };

@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly sendLimiter = new RateLimiter(MESSAGES_PER_MINUTE, 60_000);

  @WebSocketServer()
  server!: AppServer;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly matches: MatchesService,
    private readonly chat: ChatService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Runs once per connection BEFORE it is accepted. Rejecting here makes the
   * client receive `connect_error` with message UNAUTHENTICATED.
   */
  afterInit(server: AppServer): void {
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
    setInterval(() => this.sendLimiter.prune(), 5 * 60_000).unref();
  }

  async handleConnection(socket: AppSocket): Promise<void> {
    await socket.join(userRoom(socket.data.userId));
    // Still in its rooms here, which is what lets us tell the other person we left.
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith(MATCH_ROOM_PREFIX))
          void this.announceOffline(socket, room);
      }
    });
  }

  /** Tokens live 60 s and are only checked here, at the handshake. */
  private async authenticate(socket: AppSocket): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown };
    if (typeof auth.token !== 'string') throw new Error('missing token');
    const payload = await this.jwt.verifyAsync<{ sub: string }>(auth.token, {
      secret: this.config.get('SOCKET_JWT_SECRET', { infer: true }),
    });
    socket.data.userId = payload.sub;
  }

  // ── client -> server ────────────────────────────────────────────────────

  @SubscribeMessage(ClientEvents.MatchJoin)
  onMatchJoin(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    return this.safely(async () => {
      const dto = await parse(MatchRefDto, payload);
      if (!dto) return INVALID;
      const check = await this.matches.membership(
        socket.data.userId,
        dto.matchId,
      );
      if (!check.ok) return { ok: false, code: check.code };
      if (check.match.status !== MatchStatus.ACTIVE) {
        return { ok: false, code: 'MATCH_CLOSED' };
      }

      const room = matchRoom(dto.matchId);
      await socket.join(room);
      await this.announceOnline(socket, room);
      return { ok: true };
    });
  }

  @SubscribeMessage(ClientEvents.MatchLeave)
  onMatchLeave(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    return this.safely(async () => {
      const dto = await parse(MatchRefDto, payload);
      if (!dto) return INVALID;
      const room = matchRoom(dto.matchId);
      await socket.leave(room);
      await this.announceOffline(socket, room);
      return { ok: true };
    });
  }

  @SubscribeMessage(ClientEvents.ChatSend)
  onChatSend(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: unknown,
  ) {
    return this.safely(async () => {
      const dto = await parse(ChatSendDto, payload);
      if (!dto) return INVALID;
      const userId = socket.data.userId;

      const check = await this.matches.membership(userId, dto.matchId);
      if (!check.ok) return { ok: false as const, code: check.code };
      if (check.match.status !== MatchStatus.ACTIVE) {
        return { ok: false as const, code: 'MATCH_CLOSED' };
      }
      if (!this.sendLimiter.consume(userId)) {
        return { ok: false as const, code: 'RATE_LIMITED' };
      }

      const message = await this.chat.createMessage(
        userId,
        dto.matchId,
        dto.body,
      );
      // The sender uses clientId to swap its optimistic bubble for the saved message.
      this.server
        .to(matchRoom(dto.matchId))
        .emit(ServerEvents.ChatMessage, { ...message, clientId: dto.clientId });
      return { ok: true as const, message };
    });
  }

  /** Fire-and-forget: no ack. Only relayed for sockets that joined the room. */
  @SubscribeMessage(ClientEvents.ChatTyping)
  async onChatTyping(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const dto = await parse(ChatTypingDto, payload);
    if (!dto) return;
    const room = matchRoom(dto.matchId);
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit(ServerEvents.ChatTyping, {
      matchId: dto.matchId,
      userId: socket.data.userId,
      typing: dto.typing,
    });
  }

  @SubscribeMessage(ClientEvents.ChatRead)
  onChatRead(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    return this.safely(async () => {
      const dto = await parse(ChatReadDto, payload);
      if (!dto) return INVALID;
      const userId = socket.data.userId;

      const check = await this.matches.membership(userId, dto.matchId);
      if (!check.ok) return { ok: false, code: check.code };
      const found = await this.chat.markRead(
        userId,
        dto.matchId,
        dto.lastMessageId,
      );
      if (!found) return { ok: false, code: 'MESSAGE_NOT_FOUND' };

      this.server.to(matchRoom(dto.matchId)).emit(ServerEvents.ChatRead, {
        matchId: dto.matchId,
        userId,
        lastMessageId: dto.lastMessageId,
      });
      return { ok: true };
    });
  }

  // ── server -> client ────────────────────────────────────────────────────

  /** A match was created: each of the two people gets the mirror-image payload. */
  @OnEvent(Events.MatchCreated)
  async onMatchCreated(event: MatchCreatedEvent): Promise<void> {
    try {
      for (const userId of [event.userAId, event.userBId]) {
        const payload = await this.matches.buildMatchNew(event.matchId, userId);
        this.server.to(userRoom(userId)).emit(ServerEvents.MatchNew, payload);
      }
    } catch (err) {
      this.logger.error(
        `match:new failed for ${event.matchId}: ${String(err)}`,
      );
    }
  }

  /** A session changed: each participant gets it as THEY see it (their own review, etc.). */
  @OnEvent(Events.SessionProposed)
  onSessionProposed(event: SessionEvent): Promise<void> {
    return this.pushSession(event);
  }

  @OnEvent(Events.SessionUpdated)
  onSessionUpdated(event: SessionEvent): Promise<void> {
    return this.pushSession(event);
  }

  private async pushSession(event: SessionEvent): Promise<void> {
    try {
      for (const userId of event.userIds) {
        const payload = await this.sessions.getFor(event.sessionId, userId);
        this.server
          .to(userRoom(userId))
          .emit(ServerEvents.SessionUpdate, payload);
      }
    } catch (err) {
      this.logger.error(
        `session:update failed for ${event.sessionId}: ${String(err)}`,
      );
    }
  }

  // ── presence: "online" means "has this chat open", and tabs count as one person ──

  /** Tells the room I am here, and tells me who else already is. */
  private async announceOnline(socket: AppSocket, room: string): Promise<void> {
    const me = socket.data.userId;
    const others = new Set(
      (await this.server.in(room).fetchSockets())
        .map((s) => s.data.userId)
        .filter((id) => id !== me),
    );
    for (const userId of others) {
      socket.emit(ServerEvents.Presence, { userId, online: true });
    }
    socket.to(room).emit(ServerEvents.Presence, { userId: me, online: true });
  }

  /** Only reports "offline" when this was the user's last tab in the room. */
  private async announceOffline(
    socket: AppSocket,
    room: string,
  ): Promise<void> {
    const me = socket.data.userId;
    const stillThere = (await this.server.in(room).fetchSockets()).some(
      (s) => s.id !== socket.id && s.data.userId === me,
    );
    if (!stillThere) {
      socket
        .to(room)
        .emit(ServerEvents.Presence, { userId: me, online: false });
    }
  }

  /** A handler that fails must still answer its ack, never leave the client hanging. */
  private async safely<T extends Ack | { ok: boolean }>(
    fn: () => Promise<T>,
  ): Promise<T | Ack> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(String(err));
      return { ok: false, code: 'INTERNAL_ERROR' };
    }
  }
}
