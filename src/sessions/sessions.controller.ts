import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CancelSessionDto,
  CreateSessionDto,
  ListSessionsQuery,
  SessionDto,
  SlotDto,
  SlotsQuery,
} from './dto/session.dto';
import { SessionsService } from './sessions.service';
import { SlotsService } from './slots.service';

@ApiTags('sessions')
@ApiCookieAuth()
@Controller()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly slots: SlotsService,
  ) {}

  @Get('sessions')
  @ApiOkResponse({ type: [SessionDto] })
  listSessions(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSessionsQuery,
  ): Promise<SessionDto[]> {
    return this.sessions.list(user.id, query.scope);
  }

  @Post('sessions')
  @ApiCreatedResponse({ type: SessionDto })
  createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionDto> {
    return this.sessions.propose(user.id, dto);
  }

  @Post('sessions/:id/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  confirmSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<SessionDto> {
    return this.sessions.confirm(user.id, id);
  }

  @Post('sessions/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  cancelSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelSessionDto,
  ): Promise<SessionDto> {
    return this.sessions.cancel(user.id, id, dto);
  }

  @Post('sessions/:id/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  completeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<SessionDto> {
    return this.sessions.complete(user.id, id);
  }

  @Post('sessions/:id/no-show')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  reportNoShow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<SessionDto> {
    return this.sessions.noShow(user.id, id);
  }

  @Get('matches/:id/slots')
  @ApiOkResponse({ type: [SlotDto] })
  getMatchSlots(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: SlotsQuery,
  ): Promise<SlotDto[]> {
    return this.slots.suggest(user.id, id, query.days, query.durationMin);
  }
}
