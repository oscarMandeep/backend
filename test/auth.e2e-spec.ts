process.env.NODE_ENV = 'development'; // dev-login exists only in development

import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/** Full auth flow against the real database through the real HTTP stack. */
describe('Auth flow (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const email = `auth-e2e-${Date.now()}@test.dev`;

  const cookiesOf = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const body = <T>(res: request.Response): T => res.body as T;
  const pick = (cookies: string[], name: string) =>
    cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.create({
      data: { email, username: `auth-e2e-${Date.now()}`, name: 'Auth E2E' },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('rejects /v1/me without cookies', async () => {
    const res = await http().get('/v1/me').expect(401);
    expect(body<{ error: { code: string } }>(res).error.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects a tampered access cookie', () =>
    http().get('/v1/me').set('Cookie', 'ss_at=garbage').expect(401));

  it('login -> /me -> refresh (rotation) -> old refresh is rejected -> logout', async () => {
    const login = await http()
      .post('/v1/auth/dev-login')
      .send({ email })
      .expect(204);
    const first = cookiesOf(login);
    expect(first.join(';')).toMatch(/HttpOnly/i);
    expect(first.join(';')).toMatch(/SameSite=Lax/i);

    const me = await http().get('/v1/me').set('Cookie', first).expect(200);
    expect(me.body).toMatchObject({ email, onboarded: false, credits: 2 });
    expect(me.body).not.toHaveProperty('googleId');

    const refreshed = await http()
      .post('/v1/auth/refresh')
      .set('Cookie', [pick(first, 'ss_rt')])
      .expect(204);
    const second = cookiesOf(refreshed);
    expect(pick(second, 'ss_rt')).not.toBe(pick(first, 'ss_rt'));
    await http().get('/v1/me').set('Cookie', second).expect(200);

    // replaying the first refresh token = reuse: rejected AND kills the session
    const replay = await http()
      .post('/v1/auth/refresh')
      .set('Cookie', [pick(first, 'ss_rt')])
      .expect(401);
    expect(body<{ error: { code: string } }>(replay).error.code).toBe(
      'REFRESH_TOKEN_REUSED',
    );
    await http()
      .post('/v1/auth/refresh')
      .set('Cookie', [pick(second, 'ss_rt')])
      .expect(401);
  });

  it('socket-token returns a 60 s token; logout revokes the refresh token', async () => {
    const login = await http()
      .post('/v1/auth/dev-login')
      .send({ email })
      .expect(204);
    const cookies = cookiesOf(login);
    const sock = await http()
      .get('/v1/auth/socket-token')
      .set('Cookie', cookies)
      .expect(200);
    expect(body<{ token: string; expiresIn: number }>(sock)).toMatchObject({
      expiresIn: 60,
    });
    expect(typeof body<{ token: string }>(sock).token).toBe('string');

    await http().post('/v1/auth/logout').set('Cookie', cookies).expect(204);
    await http()
      .post('/v1/auth/refresh')
      .set('Cookie', [pick(cookies, 'ss_rt')])
      .expect(401);
  });

  it('dev-login validates input and unknown users', async () => {
    await http()
      .post('/v1/auth/dev-login')
      .send({ email: 'not-an-email' })
      .expect(422);
    await http()
      .post('/v1/auth/dev-login')
      .send({ email: 'ghost@test.dev' })
      .expect(404);
  });

  it('Google login answers 503 until credentials are configured', async () => {
    if (process.env.GOOGLE_CLIENT_ID) return;
    const res = await http().get('/v1/auth/google').expect(503);
    expect(body<{ error: { code: string } }>(res).error.code).toBe(
      'GOOGLE_NOT_CONFIGURED',
    );
  });
});
