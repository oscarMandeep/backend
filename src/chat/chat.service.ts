import { Injectable } from '@nestjs/common';
import { toMessageDto } from '../matches/matches.service';
import type { MessageDto } from '../matches/dto/message.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saves the message and bumps the match's last-activity time in one transaction. */
  createMessage(
    senderId: string,
    matchId: string,
    body: string,
  ): Promise<MessageDto> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { matchId, senderId, body },
      });
      await tx.match.update({
        where: { id: matchId },
        data: { lastMsgAt: message.createdAt },
      });
      return toMessageDto(message);
    });
  }

  /**
   * Marks everything the OTHER person sent up to `lastMessageId` as read.
   * Returns false when that message is not part of this match.
   */
  async markRead(
    readerId: string,
    matchId: string,
    lastMessageId: string,
  ): Promise<boolean> {
    const last = await this.prisma.message.findFirst({
      where: { id: lastMessageId, matchId },
      select: { createdAt: true },
    });
    if (!last) return false;
    await this.prisma.message.updateMany({
      where: {
        matchId,
        senderId: { not: readerId },
        readAt: null,
        createdAt: { lte: last.createdAt },
      },
      data: { readAt: new Date() },
    });
    return true;
  }
}
