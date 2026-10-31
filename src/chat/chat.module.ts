import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [MatchesModule],
  providers: [ChatGateway],
})
export class ChatModule {}
