process.env.NODE_ENV = 'development';

import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/** Email + password sign-up and login through the real HTTP stack. */
describe('Password auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tag = `pw${Date.now()}`;
  const email = `${tag}@test.dev`;
  const password = 'a-good-password';

  const cookiesOf = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const errorCode = (res: request.Response) =>
    (res.body as { error: { code: string } }).error.code;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      const users = await prisma.user.findMany({
        where: { email: { startsWith: tag } },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      await prisma.creditTx.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await app.close();
    }
  });

  const http = () => request(app.getHttpServer());

  it('registers, sets both cookies, and the new person is not onboarded yet', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({ name: 'Pat Test', email: email.toUpperCase(), password })
      .expect(204);
    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith('ss_at='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ss_rt='))).toBe(true);

    const me = await http()
      .get('/v1/me')
      .set(
        'Cookie',
        cookies.map((c) => c.split(';')[0]),
      )
      .expect(200);
    expect(me.body).toMatchObject({
      email, // stored lower-case
      name: 'Pat Test',
      onboarded: false,
      credits: 2,
    });
    // The password itself is never stored, and never returned.
    expect(JSON.stringify(me.body)).not.toContain(password);
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(password);
    expect(await prisma.creditTx.count({ where: { userId: row.id } })).toBe(1);
  });

  it('refuses a second account with the same email (any letter case)', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({ name: 'Other', email: email.toUpperCase(), password })
      .expect(409);
    expect(errorCode(res)).toBe('EMAIL_TAKEN');
  });

  it('validates the sign-up form', async () => {
    const bad = [
      { name: 'P', email, password },
      { name: 'Pat', email: 'not-an-email', password },
      { name: 'Pat', email: `${tag}-x@test.dev`, password: 'short' },
      { name: 'Pat', email: `${tag}-x@test.dev` },
    ];
    for (const body of bad) {
      const res = await http().post('/v1/auth/register').send(body);
      expect(res.status).toBe(422);
    }
  });

  it('logs in with the right password and works with the cookies', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: email.toUpperCase(), password })
      .expect(204);
    await http()
      .get('/v1/me')
      .set(
        'Cookie',
        cookiesOf(res).map((c) => c.split(';')[0]),
      )
      .expect(200);
  });

  it('gives one generic error for a wrong password and for an unknown email', async () => {
    const wrong = await http()
      .post('/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const unknown = await http()
      .post('/v1/auth/login')
      .send({ email: `${tag}-nobody@test.dev`, password })
      .expect(401);
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    expect(wrong.body).toEqual(unknown.body);
    expect(cookiesOf(wrong)).toHaveLength(0);
  });

  it('a Google-only account (no password) cannot log in with a password', async () => {
    const googleOnly = `${tag}-g@test.dev`;
    await prisma.user.create({
      data: {
        email: googleOnly,
        username: `${tag}g`,
        name: 'G',
        googleId: `${tag}-gid`,
      },
    });
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: googleOnly, password })
      .expect(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
  });

  it('slows down repeated wrong guesses for one email', async () => {
    const target = `${tag}-brute@test.dev`;
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: target, password: `guess-${i}` });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
