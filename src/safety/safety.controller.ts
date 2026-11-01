import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { BlockUserDto, ReportUserDto } from './dto/safety.dto';
import { SafetyService } from './safety.service';

@ApiTags('safety')
@ApiCookieAuth()
@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('blocks')
  @HttpCode(204)
  @ApiNoContentResponse()
  blockUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: BlockUserDto,
  ): Promise<void> {
    return this.safety.block(user.id, dto);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  @ApiNoContentResponse()
  unblockUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.safety.unblock(user.id, userId);
  }

  @Post('reports')
  @ApiCreatedResponse({ description: 'The report was recorded' })
  async reportUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReportUserDto,
  ): Promise<void> {
    await this.safety.report(user.id, dto);
  }
}
