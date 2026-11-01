import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [MatchesModule, SessionsModule],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
