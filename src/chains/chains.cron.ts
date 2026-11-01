import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChainsService } from './chains.service';

/** Every 30 minutes (Neon sleeps when idle). Both jobs are idempotent. */
@Injectable()
export class ChainsCron {
  private readonly logger = new Logger(ChainsCron.name);

  constructor(private readonly chains: ChainsService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async findChains(): Promise<void> {
    const { users, created } = await this.chains.findForEligibleUsers();
    if (created)
      this.logger.log(
        `proposed ${created} chain(s) after checking ${users} user(s)`,
      );
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireChains(): Promise<void> {
    const n = await this.chains.expireOverdue();
    if (n) this.logger.log(`expired ${n} chain proposal(s)`);
  }
}
