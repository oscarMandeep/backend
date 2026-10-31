import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  ListMatchesQuery,
  MatchDetailDto,
  PaginatedMatchesDto,
} from './dto/match.dto';
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
}
