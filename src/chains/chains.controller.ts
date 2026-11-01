import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ChainsService } from './chains.service';
import { ChainDto, RespondChainDto } from './dto/chain.dto';

@ApiTags('chains')
@ApiCookieAuth()
@Controller('chains')
export class ChainsController {
  constructor(private readonly chains: ChainsService) {}

  @Get()
  @ApiOkResponse({ type: [ChainDto] })
  listChains(@CurrentUser() user: AuthUser): Promise<ChainDto[]> {
    return this.chains.list(user.id);
  }

  @Post(':id/respond')
  @HttpCode(200)
  @ApiOkResponse({ type: ChainDto })
  respondToChain(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RespondChainDto,
  ): Promise<ChainDto> {
    return this.chains.respond(user.id, id, dto.accept);
  }
}
