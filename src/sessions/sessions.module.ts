import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { MatchesModule } from '../matches/matches.module';
import { SessionsController } from './sessions.controller';
import { SessionsCron } from './sessions.cron';
import { SessionsService } from './sessions.service';
import { SlotsService } from './slots.service';

@Module({
  imports: [MatchesModule, CreditsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SlotsService, SessionsCron],
  exports: [SessionsService, SlotsService],
})
export class SessionsModule {}
