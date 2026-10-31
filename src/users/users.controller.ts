import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { MeDto } from './dto/me.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiCookieAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.getMe(user.id);
  }
}
