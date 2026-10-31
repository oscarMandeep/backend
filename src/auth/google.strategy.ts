import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import type { Env } from '../config/env.schema';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      // Placeholders keep the API bootable without Google keys; GoogleAuthGuard
      // answers 503 until real values are set.
      clientID:
        config.get('GOOGLE_CLIENT_ID', { infer: true }) || 'not-configured',
      clientSecret:
        config.get('GOOGLE_CLIENT_SECRET', { infer: true }) || 'not-configured',
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleProfile {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Your Google account has no email address.',
      });
    }
    return {
      googleId: profile.id,
      email: email.toLowerCase(),
      name: profile.displayName || email.split('@')[0],
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };
  }
}
