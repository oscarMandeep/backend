import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type MatchCreatedEvent } from '../common/events';
import { MatchStatus, Prisma } from '../generated/prisma/client';
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
import type { MessageDto, PaginatedMessagesDto } from './dto/message.dto';

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

export type MembershipError = 'MATCH_NOT_FOUND' | 'FORBIDDEN';
export type Membership =
  | {
      ok: true;
      match: {
        id: string;
        userAId: string;
        userBId: string;
        status: MatchStatus;
      };
    }
  | { ok: false; code: MembershipError };

const membershipError = (code: MembershipError) =>
  code === 'MATCH_NOT_FOUND'
    ? new NotFoundException({ code, message: 'Match not found.' })
    : new ForbiddenException({
        code,
        message: 'You are not part of this match.',
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

  /**
   * Is this user part of this match? One light query, shared by REST and sockets.
   * Callers decide how to report the failure (HTTP error vs socket ack code).
   */
  async membership(userId: string, matchId: string): Promise<Membership> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, userAId: true, userBId: true, status: true },
    });
    if (!match) return { ok: false, code: 'MATCH_NOT_FOUND' };
    if (match.userAId !== userId && match.userBId !== userId)
      return { ok: false, code: 'FORBIDDEN' };
    return { ok: true, match };
  }

  /** Throws 404 if the match does not exist, 403 if the user is not part of it. */
  async requireMember(userId: string, matchId: string): Promise<MatchRow> {
    const check = await this.membership(userId, matchId);
    if (!check.ok) throw membershipError(check.code);
    return this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: matchInclude,
    });
  }

  /** Chat history, newest first. */
  async listMessages(
    userId: string,
    matchId: string,
    cursor: string | undefined,
    limit = 30,
  ): Promise<PaginatedMessagesDto> {
    const check = await this.membership(userId, matchId);
    if (!check.ok) throw membershipError(check.code);

    const rows = await this.prisma.message.findMany({
      where: { matchId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toMessageDto),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** Hides the match for both people and closes the chat. Safe to repeat. */
  async archive(userId: string, matchId: string): Promise<void> {
    const check = await this.membership(userId, matchId);
    if (!check.ok) throw membershipError(check.code);
    await this.prisma.match.updateMany({
      where: { id: matchId, status: MatchStatus.ACTIVE },
      data: { status: MatchStatus.ARCHIVED },
    });
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
