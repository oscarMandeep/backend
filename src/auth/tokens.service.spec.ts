import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.schema';
import type { PrismaService } from '../prisma/prisma.service';
import { hashToken, TokensService } from './tokens.service';

interface Row {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const JWT_SECRET = 'j'.repeat(32);
const SOCKET_SECRET = 's'.repeat(32);

/** In-memory stand-in for the refresh_tokens table (only what the service uses). */
function makeService() {
  const rows: Row[] = [];
  let n = 0;
  const prisma = {
    refreshToken: {
      create: ({ data }: { data: Omit<Row, 'id' | 'revokedAt'> }) => {
        const row: Row = { ...data, id: `rt${++n}`, revokedAt: null };
        rows.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
        ),
      updateMany: ({
        where,
        data,
      }: {
        where: {
          id?: string;
          userId?: string;
          tokenHash?: string;
          revokedAt: null;
        };
        data: { revokedAt: Date };
      }) => {
        const hit = rows.filter(
          (r) =>
            r.revokedAt === null &&
            (where.id === undefined || r.id === where.id) &&
            (where.userId === undefined || r.userId === where.userId) &&
            (where.tokenHash === undefined || r.tokenHash === where.tokenHash),
        );
        hit.forEach((r) => (r.revokedAt = data.revokedAt));
        return Promise.resolve({ count: hit.length });
      },
    },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => ({ SOCKET_JWT_SECRET: SOCKET_SECRET })[key],
  } as unknown as ConfigService<Env, true>;
  const jwt = new JwtService({ secret: JWT_SECRET });
  return { service: new TokensService(prisma, jwt, config), rows, jwt };
}

describe('TokensService', () => {
  it('issues an access JWT and stores only the hash of the refresh token', async () => {
    const { service, rows, jwt } = makeService();
    const pair = await service.issuePair('u1');
    expect((await jwt.verifyAsync<{ sub: string }>(pair.accessToken)).sub).toBe(
      'u1',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(pair.refreshToken));
    expect(rows[0].tokenHash).not.toBe(pair.refreshToken);
  });

  it('rotates: old token is revoked and a new working pair is returned', async () => {
    const { service, rows } = makeService();
    const first = await service.issuePair('u1');
    const { userId, pair } = await service.rotate(first.refreshToken);
    expect(userId).toBe('u1');
    expect(pair.refreshToken).not.toBe(first.refreshToken);
    expect(
      rows.find((r) => r.tokenHash === hashToken(first.refreshToken))
        ?.revokedAt,
    ).not.toBeNull();
    await expect(service.rotate(pair.refreshToken)).resolves.toBeDefined();
  });

  it('detects reuse: replaying a rotated token revokes ALL tokens of the user', async () => {
    const { service, rows } = makeService();
    const first = await service.issuePair('u1');
    const { pair: second } = await service.rotate(first.refreshToken);
    await service.issuePair('u1'); // a second device
    await expect(service.rotate(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
    });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(service.rotate(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('reuse detection does not touch other users', async () => {
    const { service, rows } = makeService();
    const a = await service.issuePair('u1');
    await service.issuePair('u2');
    await service.rotate(a.refreshToken);
    await expect(service.rotate(a.refreshToken)).rejects.toBeDefined();
    expect(
      rows.filter((r) => r.userId === 'u2').every((r) => r.revokedAt === null),
    ).toBe(true);
  });

  it('two concurrent refreshes with the same token: only one succeeds', async () => {
    const { service } = makeService();
    const first = await service.issuePair('u1');
    const results = await Promise.allSettled([
      service.rotate(first.refreshToken),
      service.rotate(first.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('rejects unknown and expired tokens', async () => {
    const { service, rows } = makeService();
    await expect(service.rotate('nope')).rejects.toMatchObject({
      response: { code: 'INVALID_REFRESH_TOKEN' },
    });
    const pair = await service.issuePair('u1');
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.rotate(pair.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_EXPIRED' },
    });
  });

  it('revoke() invalidates a single token (logout)', async () => {
    const { service } = makeService();
    const pair = await service.issuePair('u1');
    await service.revoke(pair.refreshToken);
    await expect(service.rotate(pair.refreshToken)).rejects.toBeDefined();
  });

  it('socket token is signed with the socket secret, not the access secret', async () => {
    const { service } = makeService();
    const token = await service.signSocketToken('u1');
    const socketJwt = new JwtService({ secret: SOCKET_SECRET });
    expect((await socketJwt.verifyAsync<{ sub: string }>(token)).sub).toBe(
      'u1',
    );
    await expect(
      new JwtService({ secret: JWT_SECRET }).verifyAsync(token),
    ).rejects.toBeDefined();
  });
});
