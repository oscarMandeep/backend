import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env.schema';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { TokensService } from './tokens.service';

function makeController(nodeEnv: string) {
  const loginAsExisting = jest
    .fn()
    .mockResolvedValue({ userId: 'u1', onboarded: true });
  const issuePair = jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  const controller = new AuthController(
    { loginAsExisting } as unknown as AuthService,
    { issuePair } as unknown as TokensService,
    { get: () => nodeEnv } as unknown as ConfigService<Env, true>,
  );
  const cookie = jest.fn();
  const res = { cookie } as unknown as Response;
  return { controller, res, loginAsExisting, cookie };
}

describe('AuthController.devLogin', () => {
  it.each(['production', 'test'])(
    'does not exist in %s: 404, no lookup, no cookie',
    async (env) => {
      const { controller, res, loginAsExisting, cookie } = makeController(env);
      await expect(
        controller.devLogin({ email: 'demo@skillswap.dev' }, res),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(loginAsExisting).not.toHaveBeenCalled();
      expect(cookie).not.toHaveBeenCalled();
    },
  );

  it('works in development and sets both cookies', async () => {
    const { controller, res, cookie } = makeController('development');
    await controller.devLogin({ email: 'demo@skillswap.dev' }, res);
    expect(cookie).toHaveBeenCalledTimes(2);
  });
});
