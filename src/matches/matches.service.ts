import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type MatchCreatedEvent } from '../common/events';
import { Prisma } from '../generated/prisma/client';
import { toSkillRef, toUserCard } from '../matching/mappers';
import {
  matchUserInclude,
  MatchingService,
  type MatchUser,
} from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MatchNewPayload } from '../chat/socket.events';
import type {
  MatchDetailDto,
  MatchSummaryDto,
  PaginatedMatchesDto,
} from './dto/match.dto';
import type { MessageDto } from './dto/message.dto';

const matchInclude = {
  userA: { include: matchUserInclude },
  userB: { include: matchUserInclude },
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.MatchInclude;

type MatchRow = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

export const toMessageDto = (m: {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}): MessageDto => ({
  id: m.id,
  matchId: m.matchId,
  senderId: m.senderId,
  body: m.body,
  readAt: m.readAt?.toISOString() ?? null,
  createdAt: m.createdAt.toISOString(),
});

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly events: EventEmitter2,
  ) {}

  /** Tell the rest of the app (the socket gateway) that a match exists. Call after commit. */
  announce(event: MatchCreatedEvent): void {
    this.events.emit(Events.MatchCreated, event);
  }

  async list(
    userId: string,
    cursor: string | undefined,
    limit = 20,
  ): Promise<PaginatedMatchesDto> {
    const rows = await this.prisma.match.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: matchInclude,
      orderBy: [
        { lastMsgAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const unread = await this.unreadCounts(
      userId,
      page.map((m) => m.id),
    );

    return {
      items: page.map((m) => this.toSummary(m, userId, unread.get(m.id) ?? 0)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async detail(userId: string, matchId: string): Promise<MatchDetailDto> {
    const match = await this.requireMember(userId, matchId);
    const me = match.userAId === userId ? match.userA : match.userB;
    const other = match.userAId === userId ? match.userB : match.userA;
    const unread = await this.unreadCounts(userId, [match.id]);
    const view = await this.matching.describePair(me, other);

    return {
      ...this.toSummary(match, userId, unread.get(match.id) ?? 0),
      // Fresh numbers when the pair still qualifies, else what was stored at match time.
      breakdown:
        view.result?.parts ??
        (match.breakdown as unknown as MatchDetailDto['breakdown']),
      learnSkill: toSkillRef(view.learnSkill),
      teachSkill: view.teachSkill ? toSkillRef(view.teachSkill) : null,
    };
  }

  /** The `match:new` payload for one of the two users (each sees the mirror image). */
  async buildMatchNew(
    matchId: string,
    viewerId: string,
  ): Promise<MatchNewPayload> {
    const match = await this.requireMember(viewerId, matchId);
    const me = match.userAId === viewerId ? match.userA : match.userB;
    const other = match.userAId === viewerId ? match.userB : match.userA;
    const view = await this.matching.describePair(me, other);
    return {
      matchId: match.id,
      score: view.result?.score ?? match.score,
      type: match.type,
      otherUser: toUserCard(other),
      learnSkill: toSkillRef(view.learnSkill),
      teachSkill: view.teachSkill ? toSkillRef(view.teachSkill) : null,
    };
  }

  /** Throws 404 if the match does not exist, 403 if the user is not part of it. */
  async requireMember(userId: string, matchId: string): Promise<MatchRow> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: matchInclude,
    });
    if (!match) {
      throw new NotFoundException({
        code: 'MATCH_NOT_FOUND',
        message: 'Match not found.',
      });
    }
    if (match.userAId !== userId && match.userBId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You are not part of this match.',
      });
    }
    return match;
  }

  private toSummary(
    m: MatchRow,
    userId: string,
    unreadCount: number,
  ): MatchSummaryDto {
    const other: MatchUser = m.userAId === userId ? m.userB : m.userA;
    return {
      id: m.id,
      type: m.type,
      score: m.score,
      otherUser: toUserCard(other),
      lastMessage: m.messages[0] ? toMessageDto(m.messages[0]) : null,
      unreadCount,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async unreadCounts(
    userId: string,
    matchIds: string[],
  ): Promise<Map<string, number>> {
    if (matchIds.length === 0) return new Map();
    const rows = await this.prisma.message.groupBy({
      by: ['matchId'],
      where: {
        matchId: { in: matchIds },
        senderId: { not: userId },
        readAt: null,
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.matchId, r._count._all]));
  }
}
