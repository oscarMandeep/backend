import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionsService } from './sessions.service';

/**
 * Every 30 minutes: Neon sleeps when idle, so jobs must not run more often
 * (docs/02 §5). Both jobs are idempotent, so a late or doubled run is harmless.
 */
@Injectable()
export class SessionsCron {
  private readonly logger = new Logger(SessionsCron.name);

  constructor(private readonly sessions: SessionsService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sessionReminders(): Promise<void> {
    const n = await this.sessions.sendReminders();
    if (n) this.logger.log(`sent ${n} session reminder(s)`);
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async noShowCheck(): Promise<void> {
    const n = await this.sessions.promptUnresolved();
    if (n) this.logger.log(`prompted ${n} unresolved session(s)`);
  }
}
