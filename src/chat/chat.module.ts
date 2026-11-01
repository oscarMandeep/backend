import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [MatchesModule],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
