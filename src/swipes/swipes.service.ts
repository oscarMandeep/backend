import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, SwipeAction } from '../generated/prisma/client';
import { MatchingService } from '../matching/matching.service';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SwipeDto, SwipeResponseDto } from './dto/swipe.dto';

const notAValidCandidate = () =>
  new BadRequestException({
    code: 'NOT_A_VALID_CANDIDATE',
    message: 'You cannot swipe on this person.',
  });

@Injectable()
export class SwipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly matches: MatchesService,
  ) {}

  async swipe(userId: string, dto: SwipeDto): Promise<SwipeResponseDto> {
    if (dto.targetId === userId) throw notAValidCandidate();

    const [me, target] = await Promise.all([
      this.matching.loadUser(userId),
      this.matching.loadUser(dto.targetId),
    ]);
    if (!me?.onboarded) {
      throw new ConflictException({
        code: 'ONBOARDING_REQUIRED',
        message: 'Finish onboarding to swipe.',
      });
    }
    if (!target?.onboarded) throw notAValidCandidate();

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: target.id },
          { blockerId: target.id, blockedId: userId },
        ],
      },
      select: { id: true },
    });
    if (blocked) throw notAValidCandidate();

    // The score is always computed here, never taken from the client.
    const mine = await this.matching.scorePair(me, target);
    if (!mine) throw notAValidCandidate();

    const wantsMatch = dto.action !== SwipeAction.PASS;
    const theirs = wantsMatch
      ? await this.matching.scorePair(target, me)
      : null;
    const [userAId, userBId] = [userId, target.id].sort();

    const outcome = await this.prisma.$transaction(async (tx) => {
      // One request per pair at a time. Without this, two people liking each other
      // at the same instant can each miss the other's swipe and no match is made.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userAId}:${userBId}`}, 0))`;

      const already = await tx.swipe.findUnique({
        where: { swiperId_swipedId: { swiperId: userId, swipedId: target.id } },
        select: { id: true },
      });
      if (already) {
        throw new ConflictException({
          code: 'ALREADY_SWIPED',
          message: 'You already swiped on this person.',
        });
      }
      await tx.swipe.create({
        data: {
          swiperId: userId,
          swipedId: target.id,
          action: dto.action,
          score: mine.score,
        },
      });
      if (!wantsMatch) return { matched: false as const };

      const reverse = await tx.swipe.findUnique({
        where: { swiperId_swipedId: { swiperId: target.id, swipedId: userId } },
        select: { action: true },
      });
      if (!reverse || reverse.action === SwipeAction.PASS)
        return { matched: false as const };

      const existing = await tx.match.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
        select: { id: true },
      });
      if (existing)
        return { matched: true as const, matchId: existing.id, created: false };

      const created = await tx.match.create({
        data: {
          userAId,
          userBId,
          type: mine.type,
          // Both directions are scored; the match keeps the average.
          score: theirs
            ? Math.round((mine.score + theirs.score) / 2)
            : mine.score,
          breakdown: { ...mine.parts } satisfies Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { matched: true as const, matchId: created.id, created: true };
    });

    if (!outcome.matched) return { matched: false };
    if (outcome.created) {
      this.matches.announce({ matchId: outcome.matchId, userAId, userBId });
    }
    return { matched: true, matchId: outcome.matchId };
  }

  /** Undo is only for the most recent swipe, and only if it was a PASS. */
  async undoLast(userId: string): Promise<void> {
    const last = await this.prisma.swipe.findFirst({
      where: { swiperId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, action: true },
    });
    if (!last || last.action !== SwipeAction.PASS) {
      throw new ConflictException({
        code: 'NOTHING_TO_UNDO',
        message: 'Only your last pass can be undone.',
      });
    }
    await this.prisma.swipe.delete({ where: { id: last.id } });
  }
}
