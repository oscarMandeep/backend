import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AvailabilitySlotDto, MeDto } from './dto/me.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateSkillsDto } from './dto/update-skills.dto';
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

  @Patch()
  @ApiOkResponse({ type: MeDto })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMeDto,
  ): Promise<MeDto> {
    return this.users.updateMe(user.id, dto);
  }

  @Put('skills')
  @ApiOkResponse({ type: MeDto })
  updateMySkills(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSkillsDto,
  ): Promise<MeDto> {
    return this.users.updateMySkills(user.id, dto);
  }

  @Put('availability')
  @ApiOkResponse({ type: [AvailabilitySlotDto] })
  updateMyAvailability(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<AvailabilitySlotDto[]> {
    return this.users.updateMyAvailability(user.id, dto);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: MeDto })
  completeOnboarding(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.completeOnboarding(user.id);
  }
}
