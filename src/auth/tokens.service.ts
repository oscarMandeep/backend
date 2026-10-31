import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SOCKET_TOKEN_TTL_SECONDS = 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const hashToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

const unauthenticated = (code: string, message: string) =>
  new UnauthorizedException({ code, message });

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** New access JWT + new random refresh token (only its hash is stored). */
  async issuePair(userId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { expiresIn: ACCESS_TTL_SECONDS },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { accessToken, refreshToken };
  }

  /**
   * Single-use refresh: the presented token is revoked and a new pair issued.
   * Presenting an already-used token means it was stolen or replayed, so every
   * token of that user is revoked (reuse detection).
   */
  async rotate(
    rawRefreshToken: string,
  ): Promise<{ userId: string; pair: TokenPair }> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawRefreshToken) },
    });
    if (!row) {
      throw unauthenticated('INVALID_REFRESH_TOKEN', 'Please log in again.');
    }
    if (row.revokedAt) {
      await this.revokeAll(row.userId);
      throw unauthenticated('REFRESH_TOKEN_REUSED', 'Please log in again.');
    }
    if (row.expiresAt <= new Date()) {
      throw unauthenticated(
        'REFRESH_TOKEN_EXPIRED',
        'Your session expired. Please log in again.',
      );
    }

    // Atomic claim: if two requests race with the same token, only one wins.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeAll(row.userId);
      throw unauthenticated('REFRESH_TOKEN_REUSED', 'Please log in again.');
    }

    return { userId: row.userId, pair: await this.issuePair(row.userId) };
  }

  async revoke(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 60 s JWT for the Socket.io handshake, signed with its own secret. */
  signSocketToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get('SOCKET_JWT_SECRET', { infer: true }),
        expiresIn: SOCKET_TOKEN_TTL_SECONDS,
      },
    );
  }
}
