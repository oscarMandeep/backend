import type { CookieOptions, Response } from 'express';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_MS,
  type TokenPair,
} from './tokens.service';

export const ACCESS_COOKIE = 'ss_at';
export const REFRESH_COOKIE = 'ss_rt';

function baseOptions(isProd: boolean): CookieOptions {
  return { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };
}

export function setAuthCookies(
  res: Response,
  pair: TokenPair,
  isProd: boolean,
): void {
  res.cookie(ACCESS_COOKIE, pair.accessToken, {
    ...baseOptions(isProd),
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, pair.refreshToken, {
    ...baseOptions(isProd),
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response, isProd: boolean): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions(isProd));
  res.clearCookie(REFRESH_COOKIE, baseOptions(isProd));
}
