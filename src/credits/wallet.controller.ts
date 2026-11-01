import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CreditsService } from './credits.service';
import { WalletDto, WalletQuery } from './dto/wallet.dto';

@ApiTags('wallet')
@ApiCookieAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @ApiOkResponse({ type: WalletDto })
  getWallet(
    @CurrentUser() user: AuthUser,
    @Query() query: WalletQuery,
  ): Promise<WalletDto> {
    return this.credits.wallet(user.id, query.cursor, query.limit);
  }
}
