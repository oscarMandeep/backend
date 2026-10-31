import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Env } from '../config/env.schema';
import { Events, type MatchCreatedEvent } from '../common/events';
import { MatchesService } from '../matches/matches.service';
import {
  ServerEvents,
  userRoom,
  type AppServer,
  type AppSocket,
} from './socket.events';

@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: AppServer;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly matches: MatchesService,
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
  }

  async handleConnection(socket: AppSocket): Promise<void> {
    await socket.join(userRoom(socket.data.userId));
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
}
