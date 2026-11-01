import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type SkillCreatedEvent,
  type UserUpdatedEvent,
} from '../common/events';
import { PrismaService } from '../prisma/prisma.service';
import { RevalidateService } from './revalidate.service';
import { tagsForNewSkill, tagsForUser } from './tags';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidate: RevalidateService,
  ) {}

  @OnEvent(Events.UserUpdated)
  async onUserUpdated(event: UserUpdatedEvent): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: {
          username: true,
          city: true,
          haves: { select: { skill: { select: { slug: true } } } },
          wants: { select: { skill: { select: { slug: true } } } },
        },
      });
      if (!user) return;
      this.revalidate.queue(
        tagsForUser({
          username: user.username,
          city: user.city,
          haveSlugs: user.haves.map((h) => h.skill.slug),
          wantSlugs: user.wants.map((w) => w.skill.slug),
        }),
      );
    } catch (err) {
      this.logger.error(`user.updated handler failed: ${String(err)}`);
    }
  }

  @OnEvent(Events.SkillCreated)
  onSkillCreated(event: SkillCreatedEvent): void {
    this.revalidate.queue(tagsForNewSkill(event.slug));
  }
}
