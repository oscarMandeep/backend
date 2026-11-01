import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { MatchingModule } from '../matching/matching.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChainsController } from './chains.controller';
import { ChainsCron } from './chains.cron';
import { ChainsService } from './chains.service';

@Module({
  imports: [MatchingModule, MatchesModule, SessionsModule],
  controllers: [ChainsController],
  providers: [ChainsService, ChainsCron],
  exports: [ChainsService],
})
export class ChainsModule {}
