import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionStatus } from '../generated/prisma/client';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SlotDto } from './dto/session.dto';
import { findCommonSlots } from './slots';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MAX_SESSION_MIN = 180;

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
  ) {}

  /** Times both people are free, in the next `days` days, minus sessions they already have. */
  async suggest(
    userId: string,
    matchId: string,
    days = 14,
    durationMin = 60,
    now = new Date(),
  ): Promise<SlotDto[]> {
    const check = await this.matches.membership(userId, matchId);
    if (!check.ok) {
      throw check.code === 'MATCH_NOT_FOUND'
        ? new NotFoundException({
            code: check.code,
            message: 'Match not found.',
          })
        : new ForbiddenException({
            code: check.code,
            message: 'You are not part of this match.',
          });
    }
    const { userAId, userBId } = check.match;
    const [a, b] = await Promise.all(
      [userAId, userBId].map((id) =>
        this.prisma.user.findUniqueOrThrow({
          where: { id },
          select: { timezone: true, slots: true },
        }),
      ),
    );

    const from = new Date(now.getTime() - MAX_SESSION_MIN * MIN); // catch a session that began before now
    const existing = await this.prisma.session.findMany({
      where: {
        status: { in: [SessionStatus.PROPOSED, SessionStatus.CONFIRMED] },
        startsAt: { gte: from, lte: new Date(now.getTime() + days * DAY) },
        OR: [
          { teacherId: { in: [userAId, userBId] } },
          { learnerId: { in: [userAId, userBId] } },
        ],
      },
      select: { startsAt: true, durationMin: true },
    });

    return findCommonSlots({
      a: { timeZone: a.timezone, slots: a.slots },
      b: { timeZone: b.timezone, slots: b.slots },
      busy: existing.map((s) => ({
        start: s.startsAt.getTime(),
        end: s.startsAt.getTime() + s.durationMin * MIN,
      })),
      now: now.getTime(),
      days,
      durationMin,
    }).map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    }));
  }
}
