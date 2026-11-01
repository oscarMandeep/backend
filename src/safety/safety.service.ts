import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BlockUserDto, ReportUserDto } from './dto/safety.dto';

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Blocks someone. Safe to repeat. Their match with you (if any) becomes BLOCKED, which
   * also closes the chat. Discover, swipes and swap chains already skip blocked pairs.
   */
  async block(blockerId: string, dto: BlockUserDto): Promise<void> {
    await this.requireOtherUser(blockerId, dto.userId);
    const [userAId, userBId] = [blockerId, dto.userId].sort();

    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId: dto.userId } },
        create: {
          blockerId,
          blockedId: dto.userId,
          reason: dto.reason || null,
        },
        update: {},
      }),
      this.prisma.match.updateMany({
        where: { userAId, userBId, status: { not: MatchStatus.BLOCKED } },
        data: { status: MatchStatus.BLOCKED },
      }),
    ]);
  }

  /** Removes MY block. The match comes back only if nobody else still blocks the pair. */
  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    const stillBlocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId, blockedId },
          { blockerId: blockedId, blockedId: blockerId },
        ],
      },
      select: { id: true },
    });
    if (stillBlocked) return;
    const [userAId, userBId] = [blockerId, blockedId].sort();
    await this.prisma.match.updateMany({
      where: { userAId, userBId, status: MatchStatus.BLOCKED },
      data: { status: MatchStatus.ACTIVE },
    });
  }

  async report(reporterId: string, dto: ReportUserDto): Promise<void> {
    await this.requireOtherUser(reporterId, dto.userId);
    await this.prisma.report.create({
      data: {
        reporterId,
        reportedId: dto.userId,
        reason: dto.reason,
        details: dto.details || null,
      },
    });
  }

  private async requireOtherUser(me: string, otherId: string): Promise<void> {
    if (me === otherId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'You cannot do that to yourself.',
      });
    }
    const exists = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }
  }
}
