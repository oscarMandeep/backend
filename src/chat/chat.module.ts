import { Module } from '@nestjs/common';
import { ChainsModule } from '../chains/chains.module';
import { MatchesModule } from '../matches/matches.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [MatchesModule, SessionsModule, ChainsModule],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
