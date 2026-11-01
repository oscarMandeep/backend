import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type UserUpdatedEvent } from '../common/events';
import { SessionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReviewDto, ReviewDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** A participant rates the other participant of a COMPLETED session, once. */
  async create(reviewerId: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const session = await this.prisma.session.findUnique({
      where: { id: dto.sessionId },
      select: { teacherId: true, learnerId: true, status: true },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found.',
      });
    }
    if (session.teacherId !== reviewerId && session.learnerId !== reviewerId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You were not part of this session.',
      });
    }
    if (session.status !== SessionStatus.COMPLETED) {
      throw new ConflictException({
        code: 'SESSION_NOT_COMPLETED',
        message: 'You can review a session once it is completed.',
      });
    }
    const revieweeId =
      reviewerId === session.teacherId ? session.learnerId : session.teacherId;

    try {
      const { review, reviewee } = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.review.create({
            data: {
              sessionId: dto.sessionId,
              reviewerId,
              revieweeId,
              rating: dto.rating,
              comment: dto.comment || null,
            },
          });
          // Recomputed from the reviews themselves, so the number can never drift.
          const stats = await tx.review.aggregate({
            where: { revieweeId },
            _avg: { rating: true },
            _count: { _all: true },
          });
          const user = await tx.user.update({
            where: { id: revieweeId },
            data: {
              ratingAvg: Math.round((stats._avg.rating ?? 0) * 100) / 100,
              ratingCount: stats._count._all,
            },
            select: { username: true },
          });
          return { review: created, reviewee: user };
        },
      );

      const event: UserUpdatedEvent = {
        userId: revieweeId,
        username: reviewee.username,
      };
      this.events.emit(Events.UserUpdated, event);
      return {
        id: review.id,
        sessionId: review.sessionId,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'You already reviewed this session.',
        });
      }
      throw err;
    }
  }
}
