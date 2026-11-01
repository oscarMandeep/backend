import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ChainsService } from './chains/chains.service';

/**
 * One-off "look for swap chains now" (`pnpm chains:find`), instead of waiting for the
 * 30-minute cron. Handy right after seeding to see the demo chain.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const { users, created } = await app
    .get(ChainsService)
    .findForEligibleUsers(200);
  console.log(`checked ${users} user(s), proposed ${created} new chain(s)`);
  await app.close();
}
void main();
