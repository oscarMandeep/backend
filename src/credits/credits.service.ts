import { ConflictException, Injectable } from '@nestjs/common';
import { SessionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { creditCost } from '../sessions/credits';
import type { CreditTxDto, WalletDto } from './dto/wallet.dto';

export interface Settlement {
  teacherId: string;
  learnerId: string;
  credits: number;
}

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Completes a CONFIRMED session and moves the credits, all in ONE transaction,
   * and at most once no matter how many requests arrive:
   *  1. the status change is a conditional update, so only one request can win it;
   *  2. the learner is debited with `credits >= cost` in the WHERE, so the balance
   *     can never go negative (the database CHECK is the last line of defence);
   *  3. a unique index on (user, session, reason) rejects a duplicate ledger row.
   * If anything fails, everything rolls back and the session stays CONFIRMED.
   */
  settleSession(sessionId: string): Promise<Settlement> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.session.updateMany({
        where: { id: sessionId, status: SessionStatus.CONFIRMED },
        data: { status: SessionStatus.COMPLETED },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'SESSION_NOT_CONFIRMED',
          message: 'This session is not waiting to be completed.',
        });
      }

      const session = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: { teacherId: true, learnerId: true, durationMin: true },
      });
      const credits = creditCost(session.durationMin);

      const debited = await tx.user.updateMany({
        where: { id: session.learnerId, credits: { gte: credits } },
        data: {
          credits: { decrement: credits },
          sessionsDone: { increment: 1 },
        },
      });
      if (debited.count === 0) {
        throw new ConflictException({
          code: 'INSUFFICIENT_CREDITS',
          message: 'The learner does not have enough credits.',
        });
      }
      await tx.user.update({
        where: { id: session.teacherId },
        data: {
          credits: { increment: credits },
          sessionsDone: { increment: 1 },
        },
      });
      await tx.creditTx.createMany({
        data: [
          {
            userId: session.teacherId,
            amount: credits,
            reason: 'TAUGHT_SESSION',
            sessionId,
          },
          {
            userId: session.learnerId,
            amount: -credits,
            reason: 'LEARNED_SESSION',
            sessionId,
          },
        ],
      });
      return {
        teacherId: session.teacherId,
        learnerId: session.learnerId,
        credits,
      };
    });
  }

  async balanceOf(userId: string): Promise<number> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    });
    return user.credits;
  }

  async wallet(
    userId: string,
    cursor: string | undefined,
    limit = 20,
  ): Promise<WalletDto> {
    const [balance, rows] = await Promise.all([
      this.balanceOf(userId),
      this.prisma.creditTx.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    const page = rows.slice(0, limit);
    const items: CreditTxDto[] = page.map((r) => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      sessionId: r.sessionId,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      balance,
      ledger: {
        items,
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      },
    };
  }
}
