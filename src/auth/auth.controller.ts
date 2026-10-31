import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { Env } from '../config/env.schema';
import {
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
} from './auth.cookies';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { SocketTokenResponse } from './dto/socket-token.dto';
import { GoogleAuthGuard } from './google-auth.guard';
import type { GoogleProfile } from './google.strategy';
import { SOCKET_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get isProd(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** Passport redirects the browser to Google; the handler body never runs. */
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  google(): void {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const profile = req.user as GoogleProfile;
    const { userId, onboarded } = await this.auth.loginWithGoogle(profile);
    setAuthCookies(res, await this.tokens.issuePair(userId), this.isProd);
    // Relative on purpose: the callback arrives through the web proxy, so the
    // browser resolves this against the web origin.
    res.redirect(onboarded ? '/discover' : '/onboarding');
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Both cookies rotated' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE];
    if (!raw) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Please log in.',
      });
    }
    try {
      const { pair } = await this.tokens.rotate(raw);
      setAuthCookies(res, pair, this.isProd);
    } catch (err) {
      clearAuthCookies(res, this.isProd);
      throw err;
    }
  }

  @ApiCookieAuth()
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE];
    if (raw) await this.tokens.revoke(raw);
    clearAuthCookies(res, this.isProd);
  }

  @ApiCookieAuth()
  @Get('socket-token')
  @ApiOkResponse({ type: SocketTokenResponse })
  async socketToken(
    @CurrentUser() user: AuthUser,
  ): Promise<SocketTokenResponse> {
    return {
      token: await this.tokens.signSocketToken(user.id),
      expiresIn: SOCKET_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * DEVELOPMENT ONLY: log in as a seeded user without Google.
   * Answers 404 in every other environment, so it does not exist in production.
   */
  @Public()
  @Post('dev-login')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Development only' })
  async devLogin(
    @Body() dto: DevLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) !== 'development') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    }
    const { userId } = await this.auth.loginAsExisting(dto.email);
    setAuthCookies(res, await this.tokens.issuePair(userId), false);
  }
}
