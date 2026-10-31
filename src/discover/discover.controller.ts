import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { DeckCardDto } from './dto/deck-card.dto';
import { DiscoverQuery } from './dto/discover-query.dto';
import { DiscoverService } from './discover.service';

@ApiTags('discover')
@ApiCookieAuth()
@Controller('discover')
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  @Get()
  @ApiOkResponse({ type: [DeckCardDto] })
  getDiscover(
    @CurrentUser() user: AuthUser,
    @Query() query: DiscoverQuery,
  ): Promise<DeckCardDto[]> {
    return this.discover.getDeck(user.id, query);
  }
}
