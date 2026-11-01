import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreditsService } from '../credits/credits.service';
import { Events, type SessionEvent } from '../common/events';
import { validationError } from '../common/utils/validation-error';
import {
  MatchStatus,
  Mode,
  Prisma,
  SessionStatus,
} from '../generated/prisma/client';
import { toSkillRef, toUserCard } from '../matching/mappers';
import { matchUserInclude } from '../matching/matching.service';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../prisma/prisma.service';
import { creditCost } from './credits';
import type {
  CancelSessionDto,
  CreateSessionDto,
  SessionDto,
} from './dto/session.dto';

const MIN = 60_000;
const NO_SHOW_GRACE_MIN = 10; // wait this long after the start before reporting a no-show
const RESOLUTION_WAIT_MIN = 30; // a CONFIRMED session unresolved this long after its end gets a prompt
const REMINDER_WINDOW_MIN = 60;
const MAX_DURATION_MIN = 180;
const MAX_DAYS_AHEAD = 90;

const sessionInclude = {
  teacher: { include: matchUserInclude },
  learner: { include: matchUserInclude },
  skill: true,
  reviews: true,
} satisfies Prisma.SessionInclude;

type SessionRow = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

const endOf = (s: { startsAt: Date; durationMin: number }) =>
  s.startsAt.getTime() + s.durationMin * MIN;

const conflict = (code: string, message: string) =>
  new ConflictException({ code, message });

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly credits: CreditsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────

  async list(
    userId: string,
    scope: 'upcoming' | 'past' = 'upcoming',
    now = new Date(),
  ): Promise<SessionDto[]> {
    const rows = await this.prisma.session.findMany({
      where: { OR: [{ teacherId: userId }, { learnerId: userId }] },
      include: sessionInclude,
      orderBy: { startsAt: 'desc' },
      take: 200,
    });
    const isUpcoming = (s: SessionRow) =>
      (s.status === SessionStatus.PROPOSED ||
        s.status === SessionStatus.CONFIRMED) &&
      endOf(s) >= now.getTime();
    const chosen =
      scope === 'upcoming'
        ? rows
            .filter(isUpcoming)
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        : rows.filter((s) => !isUpcoming(s));
    return chosen.map((s) => this.toDto(s, userId));
  }

  /** One session as one participant sees it (used by sockets too). */
  async getFor(sessionId: string, viewerId: string): Promise<SessionDto> {
    return this.toDto(
      await this.requireParticipant(sessionId, viewerId),
      viewerId,
    );
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async propose(
    userId: string,
    dto: CreateSessionDto,
    now = new Date(),
  ): Promise<SessionDto> {
    const startsAt = new Date(dto.startsAt);
    const details: Record<string, string[]> = {};
    if (startsAt.getTime() <= now.getTime())
      details.startsAt = ['startsAt must be in the future'];
    if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * MIN) {
      details.startsAt = ['startsAt is too far ahead'];
    }
    if (dto.durationMin % 15 !== 0 || dto.durationMin > MAX_DURATION_MIN) {
      details.durationMin = ['durationMin must be a multiple of 15, up to 180'];
    }
    if (dto.mode === Mode.IN_PERSON && !dto.location) {
      details.location = ['location is required for in-person sessions'];
    }
    if (Object.keys(details).length) throw validationError(details);

    const check = await this.matches.membership(userId, dto.matchId);
    if (!check.ok) throw this.membershipError(check.code);
    const { match } = check;
    if (match.status !== MatchStatus.ACTIVE) {
      throw conflict('MATCH_CLOSED', 'This match is closed.');
    }
    if (dto.teacherId !== match.userAId && dto.teacherId !== match.userBId) {
      throw validationError({
        teacherId: ['the teacher must be one of the two people in the match'],
      });
    }
    const learnerId =
      dto.teacherId === match.userAId ? match.userBId : match.userAId;

    const teaches = await this.prisma.userSkillHave.findUnique({
      where: {
        userId_skillId: { userId: dto.teacherId, skillId: dto.skillId },
      },
      select: { id: true },
    });
    if (!teaches)
      throw validationError({
        skillId: ['the teacher does not teach this skill'],
      });

    const endsAt = new Date(startsAt.getTime() + dto.durationMin * MIN);
    const created = await this.prisma.$transaction(async (tx) => {
      // The database stops two sessions overlapping in the SAME role (exclusion
      // constraints) but cannot see that someone teaching at 6 pm is also learning
      // at 6 pm. Check that here, one person at a time (advisory locks, always taken
      // in the same order so two proposals can never deadlock). The constraints
      // remain the backstop for everything else.
      for (const id of [match.userAId, match.userBId].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`user:${id}`}, 0))`;
      }
      const clash = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sessions
        WHERE status IN ('PROPOSED', 'CONFIRMED')
          AND (teacher_id IN (${match.userAId}, ${match.userBId})
               OR learner_id IN (${match.userAId}, ${match.userBId}))
          AND slot && tsrange(${startsAt.toISOString()}::timestamp, ${endsAt.toISOString()}::timestamp)
        LIMIT 1`;
      if (clash.length > 0) {
        throw conflict(
          'SLOT_TAKEN',
          'One of you already has a session at that time.',
        );
      }
      return tx.session.create({
        data: {
          matchId: dto.matchId,
          teacherId: dto.teacherId,
          learnerId,
          skillId: dto.skillId,
          startsAt,
          durationMin: dto.durationMin,
          mode: dto.mode,
          location: dto.mode === Mode.IN_PERSON ? dto.location : null,
          status: SessionStatus.PROPOSED,
          proposedById: userId,
        },
        select: { id: true },
      });
    });
    await this.emit(Events.SessionProposed, created.id);
    return this.getFor(created.id, userId);
  }

  async confirm(
    userId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<SessionDto> {
    const s = await this.requireParticipant(sessionId, userId);
    if (s.status !== SessionStatus.PROPOSED) {
      throw conflict(
        'SESSION_NOT_PROPOSED',
        'Only a proposed session can be confirmed.',
      );
    }
    if (s.proposedById === userId) {
      throw new ForbiddenException({
        code: 'CANNOT_CONFIRM_OWN_PROPOSAL',
        message: 'The other person has to confirm your proposal.',
      });
    }
    if (s.startsAt.getTime() <= now.getTime()) {
      throw conflict('SESSION_IN_PAST', 'This time has already passed.');
    }
    const learner = await this.prisma.user.findUniqueOrThrow({
      where: { id: s.learnerId },
      select: { credits: true },
    });
    if (learner.credits < creditCost(s.durationMin)) {
      throw conflict(
        'INSUFFICIENT_CREDITS',
        'The learner does not have enough credits.',
      );
    }

    const updated = await this.prisma.session.updateMany({
      where: { id: sessionId, status: SessionStatus.PROPOSED },
      data: {
        status: SessionStatus.CONFIRMED,
        meetingUrl:
          s.mode === Mode.ONLINE
            ? `https://meet.jit.si/skillswap-${sessionId}`
            : null,
      },
    });
    if (updated.count === 0)
      throw conflict(
        'SESSION_NOT_PROPOSED',
        'Only a proposed session can be confirmed.',
      );
    await this.emit(Events.SessionUpdated, sessionId);
    return this.getFor(sessionId, userId);
  }

  /** The reason is accepted for the API contract; with no column to keep it in, it is logged. */
  async cancel(
    userId: string,
    sessionId: string,
    dto: CancelSessionDto = {},
  ): Promise<SessionDto> {
    await this.requireParticipant(sessionId, userId);
    const updated = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        status: { in: [SessionStatus.PROPOSED, SessionStatus.CONFIRMED] },
      },
      data: { status: SessionStatus.CANCELLED },
    });
    if (updated.count === 0) {
      throw conflict(
        'SESSION_NOT_CANCELLABLE',
        'This session can no longer be cancelled.',
      );
    }
    if (dto.reason)
      this.logger.log(
        `session ${sessionId} cancelled by ${userId}: ${dto.reason}`,
      );
    await this.emit(Events.SessionUpdated, sessionId);
    return this.getFor(sessionId, userId);
  }

  async complete(
    userId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<SessionDto> {
    const s = await this.requireParticipant(sessionId, userId);
    if (s.status !== SessionStatus.CONFIRMED) {
      throw conflict(
        'SESSION_NOT_CONFIRMED',
        'This session is not waiting to be completed.',
      );
    }
    if (s.startsAt.getTime() > now.getTime()) {
      throw conflict(
        'SESSION_NOT_STARTED',
        'This session has not started yet.',
      );
    }
    await this.credits.settleSession(sessionId);
    await this.emit(Events.SessionUpdated, sessionId);
    await this.emit(Events.SessionCompleted, sessionId);
    return this.getFor(sessionId, userId);
  }

  /** The caller reports that the OTHER person did not show up. */
  async noShow(
    userId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<SessionDto> {
    const s = await this.requireParticipant(sessionId, userId);
    if (s.status !== SessionStatus.CONFIRMED) {
      throw conflict(
        'SESSION_NOT_CONFIRMED',
        'Only a confirmed session can have a no-show.',
      );
    }
    if (now.getTime() < s.startsAt.getTime() + NO_SHOW_GRACE_MIN * MIN) {
      throw conflict(
        'SESSION_NOT_STARTED',
        'Wait a few minutes after the start time.',
      );
    }
    const absentId = userId === s.teacherId ? s.learnerId : s.teacherId;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.session.updateMany({
        where: { id: sessionId, status: SessionStatus.CONFIRMED },
        data: { status: SessionStatus.NO_SHOW },
      });
      if (claimed.count === 0) {
        throw conflict(
          'SESSION_NOT_CONFIRMED',
          'Only a confirmed session can have a no-show.',
        );
      }
      await tx.user.update({
        where: { id: absentId },
        data: { noShowCount: { increment: 1 } },
      });
    });
    await this.emit(Events.SessionUpdated, sessionId);
    return this.getFor(sessionId, userId);
  }

  // ── cron work (idempotent: safe to run twice, or late) ──────────────────

  /** Confirmed sessions starting within the hour: tell both people, once. */
  async sendReminders(now = new Date()): Promise<number> {
    const due = await this.prisma.session.findMany({
      where: {
        status: SessionStatus.CONFIRMED,
        reminderSentAt: null,
        startsAt: {
          gte: now,
          lte: new Date(now.getTime() + REMINDER_WINDOW_MIN * MIN),
        },
      },
      select: { id: true },
    });
    let sent = 0;
    for (const { id } of due) {
      const claimed = await this.prisma.session.updateMany({
        where: { id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 1) {
        sent++;
        await this.emit(Events.SessionReminder, id);
        await this.emit(Events.SessionUpdated, id);
      }
    }
    return sent;
  }

  /** Confirmed sessions long over but never completed: ask both people what happened, once. */
  async promptUnresolved(now = new Date()): Promise<number> {
    const candidates = await this.prisma.session.findMany({
      where: {
        status: SessionStatus.CONFIRMED,
        resolutionPromptSentAt: null,
        startsAt: { lt: new Date(now.getTime() - RESOLUTION_WAIT_MIN * MIN) },
      },
      select: { id: true, startsAt: true, durationMin: true },
    });
    let prompted = 0;
    for (const s of candidates) {
      if (endOf(s) + RESOLUTION_WAIT_MIN * MIN > now.getTime()) continue;
      const claimed = await this.prisma.session.updateMany({
        where: {
          id: s.id,
          status: SessionStatus.CONFIRMED,
          resolutionPromptSentAt: null,
        },
        data: { resolutionPromptSentAt: now },
      });
      if (claimed.count === 1) {
        prompted++;
        await this.emit(Events.SessionNeedsResolution, s.id);
        await this.emit(Events.SessionUpdated, s.id);
      }
    }
    return prompted;
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /** Loads a session and checks the caller is its teacher or learner (404 / 403). */
  private async requireParticipant(
    sessionId: string,
    userId: string,
  ): Promise<SessionRow> {
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: sessionInclude,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found.',
      });
    }
    if (row.teacherId !== userId && row.learnerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You are not part of this session.',
      });
    }
    return row;
  }

  private membershipError(code: 'MATCH_NOT_FOUND' | 'FORBIDDEN') {
    return code === 'MATCH_NOT_FOUND'
      ? new NotFoundException({ code, message: 'Match not found.' })
      : new ForbiddenException({
          code,
          message: 'You are not part of this match.',
        });
  }

  private async emit(event: string, sessionId: string): Promise<void> {
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { teacherId: true, learnerId: true },
    });
    if (!s) return;
    const payload: SessionEvent = {
      sessionId,
      userIds: [s.teacherId, s.learnerId],
    };
    this.events.emit(event, payload);
  }

  private toDto(s: SessionRow, viewerId: string): SessionDto {
    const mine = s.reviews.find((r) => r.reviewerId === viewerId);
    return {
      id: s.id,
      matchId: s.matchId,
      teacher: toUserCard(s.teacher),
      learner: toUserCard(s.learner),
      skill: toSkillRef(s.skill),
      startsAt: s.startsAt.toISOString(),
      durationMin: s.durationMin,
      mode: s.mode,
      meetingUrl: s.meetingUrl,
      location: s.location,
      status: s.status,
      proposedById: s.proposedById,
      myReview: mine
        ? {
            id: mine.id,
            sessionId: mine.sessionId,
            rating: mine.rating,
            comment: mine.comment,
            createdAt: mine.createdAt.toISOString(),
          }
        : null,
    };
  }
}
