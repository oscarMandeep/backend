import {
  body,
  createTestApp,
  makeUser,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

describe('Safety: block and report (e2e)', () => {
  let t: TestApp;
  const tag = `sf${Date.now()}`;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let spanish: string;
  let python: string;
  let matchId: string;

  const post = (as: string, path: string, payload: object) =>
    t.http().post(path).set('Cookie', cookies[as]).send(payload);
  const status = async () =>
    (await t.prisma.match.findUniqueOrThrow({ where: { id: matchId } })).status;

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: `${tag}-${n}`, slug: `${tag}-${n}`, category: 'Test' },
      });
    [spanish, python] = (await Promise.all([mk('spanish'), mk('python')])).map(
      (s) => s.id,
    );
    const teach = (n: string, have: string, want: string) =>
      makeUser(t.prisma, `${tag}-${n}`, {
        haves: [{ skillId: have, level: 4 }],
        wants: [{ skillId: want }],
      });
    for (const [n, have, want] of [
      ['a', python, spanish],
      ['b', spanish, python],
      ['c', spanish, python],
    ] as const) {
      ids[n] = (await teach(n, have, want)).id;
      cookies[n] = await t.login(`${tag}-${n}@test.dev`);
    }
    const [userAId, userBId] = [ids.a, ids.b].sort();
    matchId = (
      await t.prisma.match.create({
        data: { userAId, userBId, type: 'SWAP', score: 90, breakdown: {} },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      await t.prisma.user.deleteMany({
        where: { email: { startsWith: `${tag}-` } },
      });
      await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    } finally {
      await t.close();
    }
  });

  it('blocking removes the person from discover and stops swipes', async () => {
    const before = body<{ user: { username: string } }[]>(
      await t.http().get('/v1/discover').set('Cookie', cookies.a).expect(200),
    );
    expect(before.map((c) => c.user.username)).toContain(`${tag}-c`);

    await post('a', '/v1/blocks', { userId: ids.c, reason: 'rude' }).expect(
      204,
    );
    const after = body<{ user: { username: string } }[]>(
      await t.http().get('/v1/discover').set('Cookie', cookies.a).expect(200),
    );
    expect(after.map((c) => c.user.username)).not.toContain(`${tag}-c`);
    // it works both ways: c no longer sees a either
    const asC = body<{ user: { username: string } }[]>(
      await t.http().get('/v1/discover').set('Cookie', cookies.c).expect(200),
    );
    expect(asC.map((c) => c.user.username)).not.toContain(`${tag}-a`);

    const swipe = await post('c', '/v1/swipes', {
      targetId: ids.a,
      action: 'LIKE',
    }).expect(400);
    expect(body<ApiErrorBody>(swipe).error.code).toBe('NOT_A_VALID_CANDIDATE');
  });

  it('blocking is safe to repeat and keeps the first reason', async () => {
    await post('a', '/v1/blocks', {
      userId: ids.c,
      reason: 'changed my mind',
    }).expect(204);
    const rows = await t.prisma.block.findMany({
      where: { blockerId: ids.a, blockedId: ids.c },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('rude');
  });

  it('blocking someone you matched with closes the match and the chat; unblocking brings it back', async () => {
    expect(await status()).toBe('ACTIVE');
    await post('a', '/v1/blocks', { userId: ids.b }).expect(204);
    expect(await status()).toBe('BLOCKED');
    const list = body<{ items: { id: string }[] }>(
      await t.http().get('/v1/matches').set('Cookie', cookies.b).expect(200),
    );
    expect(list.items.map((m) => m.id)).not.toContain(matchId); // b no longer sees it either

    await t
      .http()
      .delete(`/v1/blocks/${ids.b}`)
      .set('Cookie', cookies.a)
      .expect(204);
    expect(await status()).toBe('ACTIVE');
  });

  it('a match stays blocked while the OTHER person still blocks too', async () => {
    await post('a', '/v1/blocks', { userId: ids.b }).expect(204);
    await post('b', '/v1/blocks', { userId: ids.a }).expect(204);
    await t
      .http()
      .delete(`/v1/blocks/${ids.b}`)
      .set('Cookie', cookies.a)
      .expect(204); // a unblocks b
    expect(await status()).toBe('BLOCKED'); // but b still blocks a
    await t
      .http()
      .delete(`/v1/blocks/${ids.a}`)
      .set('Cookie', cookies.b)
      .expect(204);
    expect(await status()).toBe('ACTIVE');
  });

  it('unblocking someone you never blocked is harmless', async () => {
    await t
      .http()
      .delete(`/v1/blocks/${ids.b}`)
      .set('Cookie', cookies.a)
      .expect(204);
  });

  it('validates who can be blocked or reported', async () => {
    expect(
      body<ApiErrorBody>(
        await post('a', '/v1/blocks', { userId: ids.a }).expect(400),
      ).error.code,
    ).toBe('BAD_REQUEST');
    expect(
      body<ApiErrorBody>(
        await post('a', '/v1/blocks', { userId: 'nobody' }).expect(404),
      ).error.code,
    ).toBe('USER_NOT_FOUND');
    await post('a', '/v1/blocks', {}).expect(422);
    await t.http().post('/v1/blocks').send({ userId: ids.b }).expect(401);
    await t.http().delete(`/v1/blocks/${ids.b}`).expect(401);
  });

  it('records a report with a reason and optional details', async () => {
    await post('a', '/v1/reports', {
      userId: ids.c,
      reason: 'Harassment',
      details: '  sent rude messages  ',
    }).expect(201);
    const rows = await t.prisma.report.findMany({
      where: { reporterId: ids.a, reportedId: ids.c },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'Harassment',
      details: 'sent rude messages',
      resolvedAt: null,
    });
  });

  it('validates reports and requires login', async () => {
    await post('a', '/v1/reports', { userId: ids.c }).expect(422);
    await post('a', '/v1/reports', { userId: ids.c, reason: 'x' }).expect(422); // too short
    await post('a', '/v1/reports', {
      userId: ids.c,
      reason: 'y'.repeat(101),
    }).expect(422);
    expect(
      body<ApiErrorBody>(
        await post('a', '/v1/reports', {
          userId: ids.a,
          reason: 'Spam',
        }).expect(400),
      ).error.code,
    ).toBe('BAD_REQUEST');
    await post('a', '/v1/reports', { userId: 'nobody', reason: 'Spam' }).expect(
      404,
    );
    await t
      .http()
      .post('/v1/reports')
      .send({ userId: ids.c, reason: 'Spam' })
      .expect(401);
  });
});
