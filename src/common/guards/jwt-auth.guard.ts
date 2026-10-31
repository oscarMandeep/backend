import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../../auth/auth.cookies';
import { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Global guard: every route needs a valid `ss_at` cookie unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Socket gateways authenticate themselves at the handshake (Phase 7).
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[ACCESS_COOKIE];
    if (!token) throw this.unauthenticated();

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      req.user = { id: payload.sub };
      return true;
    } catch {
      throw this.unauthenticated();
    }
  }

  private unauthenticated(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'You need to log in.',
    });
  }
}
