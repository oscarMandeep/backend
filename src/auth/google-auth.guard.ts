import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Env } from '../config/env.schema';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (
      !this.config.get('GOOGLE_CLIENT_ID', { infer: true }) ||
      !this.config.get('GOOGLE_CLIENT_SECRET', { infer: true })
    ) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google login is not configured on this server.',
      });
    }
    return super.canActivate(context);
  }
}
