import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  ListMatchesQuery,
  MatchDetailDto,
  PaginatedMatchesDto,
} from './dto/match.dto';
import { ListMessagesQuery, PaginatedMessagesDto } from './dto/message.dto';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@ApiCookieAuth()
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedMatchesDto })
  listMatches(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMatchesQuery,
  ): Promise<PaginatedMatchesDto> {
    return this.matches.list(user.id, query.cursor, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ type: MatchDetailDto })
  getMatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<MatchDetailDto> {
    return this.matches.detail(user.id, id);
  }

  @Get(':id/messages')
  @ApiOkResponse({ type: PaginatedMessagesDto })
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListMessagesQuery,
  ): Promise<PaginatedMessagesDto> {
    return this.matches.listMessages(user.id, id, query.cursor, query.limit);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'The match is hidden and the chat closed',
  })
  archiveMatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.matches.archive(user.id, id);
  }
}
