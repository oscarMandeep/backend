import {
  body,
  createTestApp,
  makeUser,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface SwipeRes {
  matched: boolean;
  matchId?: string;
}
interface MatchSummary {
  id: string;
  type: string;
  score: number;
  otherUser: { username: string } & Record<string, unknown>;
  lastMessage: unknown;
  unreadCount: number;
}
interface MatchDetail extends MatchSummary {
  breakdown: Record<string, number>;
  learnSkill: { name: string };
  teachSkill: { name: string } | null;
}
interface Page {
  items: MatchSummary[];
  nextCursor: string | null;
}

describe('Swipes and matches (e2e)', () => {
  let t: TestApp;
  const tag = `sw${Date.now()}`;
  const key = (n: string) => `${tag}-${n}`;
  let spanish: string;
  let python: string;
  const cookies: Record<string, string[]> = {};

  const swipe = (as: string, targetId: string, action: string) =>
    t
      .http()
      .post('/v1/swipes')
      .set('Cookie', cookies[as])
      .send({ targetId, action });
  const idOf = async (n: string) =>
    (await t.prisma.user.findUniqueOrThrow({ where: { username: key(n) } })).id;
  const matchRows = (a: string, b: string) =>
    t.prisma.match.findMany({
      where: { userAId: { in: [a, b] }, userBId: { in: [a, b] } },
    });

  /** Teaches Spanish, wants Python: a valid partner for anyone who teaches Python. */
  const spanishTeacher = (n: string, extra = {}) =>
    makeUser(t.prisma, key(n), {
      haves: [{ skillId: spanish, level: 4 }],
      wants: [{ skillId: python }],
      ...extra,
    });
  /** Teaches Python, wants Spanish: a valid partner for a Spanish teacher. */
  const pythonTeacher = (n: string) =>
    makeUser(t.prisma, key(n), {
      haves: [{ skillId: python, level: 4 }],
      wants: [{ skillId: spanish }],
    });

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: key(n), slug: key(n), category: 'Test' },
      });
    [spanish, python] = (await Promise.all([mk('spanish'), mk('python')])).map(
      (s) => s.id,
    );

    await pythonTeacher('a');
    // partners for `a`
    for (const n of ['b', 'c', 'x', 'm1']) await spanishTeacher(n);
    // pairs for the race / undo / super / double-click tests: python teacher + spanish teacher
    for (const n of ['p1', 'p2', 'p3', 'u', 's1', 'h1']) await pythonTeacher(n);
    for (const n of ['q1', 'q2', 'q3', 'v', 's2', 'h2'])
      await spanishTeacher(n);
    // users who must never be swipeable by `a`
    await spanishTeacher('nolang', { languages: ['Tamil'] });
    await spanishTeacher('noonboard', { onboarded: false });
    await spanishTeacher('blockedme');
    await t.prisma.block.create({
      data: { blockerId: await idOf('blockedme'), blockedId: await idOf('a') },
    });

    for (const n of [
      'a',
      'b',
      'c',
      'x',
      'm1',
      'p1',
      'p2',
      'p3',
      'q1',
      'q2',
      'q3',
      'u',
      'v',
      's1',
      's2',
      'h1',
      'h2',
    ]) {
      cookies[n] = await t.login(`${key(n)}@test.dev`);
    }
  });

  afterAll(async () => {
    await t.prisma.user.deleteMany({
      where: { email: { startsWith: `${tag}-` } },
    });
    await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    await t.close();
  });

  describe('one-sided and mutual likes', () => {
    it('a like alone is not a match; the second like creates exactly one', async () => {
      const [a, b] = [await idOf('a'), await idOf('b')];
      const first = await swipe('a', b, 'LIKE').expect(200);
      expect(body<SwipeRes>(first)).toEqual({ matched: false });
      expect(await matchRows(a, b)).toHaveLength(0);

      const second = await swipe('b', a, 'LIKE').expect(200);
      expect(body<SwipeRes>(second).matched).toBe(true);
      const rows = await matchRows(a, b);
      expect(rows).toHaveLength(1);
      expect(body<SwipeRes>(second).matchId).toBe(rows[0].id);
      expect(rows[0].userAId < rows[0].userBId).toBe(true); // sorted pair
      expect(rows[0]).toMatchObject({ type: 'SWAP', status: 'ACTIVE' });
    });

    it('the server stores its own score and rejects client-supplied fields', async () => {
      const swipes = await t.prisma.swipe.findMany({
        where: { swiperId: await idOf('a') },
      });
      expect(swipes[0].score).toBeGreaterThan(0);
      await swipe('a', await idOf('c'), 'LIKE')
        .send({ targetId: await idOf('c'), action: 'LIKE', score: 100 })
        .expect(422);
    });

    it('a PASS never creates a match, even if they liked first', async () => {
      const [a, x] = [await idOf('a'), await idOf('x')];
      await swipe('x', a, 'LIKE').expect(200);
      const res = await swipe('a', x, 'PASS').expect(200);
      expect(body<SwipeRes>(res)).toEqual({ matched: false });
      expect(await matchRows(a, x)).toHaveLength(0);
    });

    it('SUPER counts as a like', async () => {
      const [s1, s2] = [await idOf('s1'), await idOf('s2')];
      await swipe('s1', s2, 'SUPER').expect(200);
      const res = await swipe('s2', s1, 'LIKE').expect(200);
      expect(body<SwipeRes>(res).matched).toBe(true);
    });

    it('swiping the same person twice is 409 ALREADY_SWIPED', async () => {
      const res = await swipe('a', await idOf('b'), 'LIKE').expect(409);
      expect(body<ApiErrorBody>(res).error.code).toBe('ALREADY_SWIPED');
    });
  });

  describe('who can be swiped', () => {
    it.each(['nolang', 'noonboard', 'blockedme'])(
      '%s is NOT_A_VALID_CANDIDATE',
      async (n) => {
        const res = await swipe('a', await idOf(n), 'LIKE').expect(400);
        expect(body<ApiErrorBody>(res).error.code).toBe(
          'NOT_A_VALID_CANDIDATE',
        );
      },
    );

    it('yourself and unknown ids are NOT_A_VALID_CANDIDATE', async () => {
      for (const target of [await idOf('a'), 'does-not-exist']) {
        const res = await swipe('a', target, 'LIKE').expect(400);
        expect(body<ApiErrorBody>(res).error.code).toBe(
          'NOT_A_VALID_CANDIDATE',
        );
      }
    });

    it('validates the body and requires login', async () => {
      await swipe('a', await idOf('c'), 'MAYBE').expect(422);
      await t
        .http()
        .post('/v1/swipes')
        .send({ targetId: 'x', action: 'LIKE' })
        .expect(401);
    });
  });

  describe('undo', () => {
    it('undoes the last PASS so the person can be swiped again; a LIKE cannot be undone', async () => {
      const u = await idOf('u');
      const v = await idOf('v');
      await swipe('u', v, 'PASS').expect(200);
      await t
        .http()
        .delete('/v1/swipes/last')
        .set('Cookie', cookies.u)
        .expect(204);
      await swipe('u', v, 'LIKE').expect(200); // allowed again

      const res = await t
        .http()
        .delete('/v1/swipes/last')
        .set('Cookie', cookies.u)
        .expect(409);
      expect(body<ApiErrorBody>(res).error.code).toBe('NOTHING_TO_UNDO');
      expect(
        await t.prisma.swipe.count({ where: { swiperId: u, swipedId: v } }),
      ).toBe(1);
    });

    it('with no swipes there is nothing to undo', async () => {
      await t
        .http()
        .delete('/v1/swipes/last')
        .set('Cookie', cookies.c)
        .expect(409);
    });
  });

  describe('races', () => {
    it.each([
      ['p1', 'q1'],
      ['p2', 'q2'],
      ['p3', 'q3'],
    ])(
      'two people liking each other at the same instant (%s, %s) make exactly ONE match',
      async (x, y) => {
        const [ix, iy] = [await idOf(x), await idOf(y)];
        const [r1, r2] = await Promise.all([
          swipe(x, iy, 'LIKE'),
          swipe(y, ix, 'LIKE'),
        ]);
        expect([r1.status, r2.status]).toEqual([200, 200]);
        const matchedCount = [r1, r2].filter(
          (r) => body<SwipeRes>(r).matched,
        ).length;
        expect(matchedCount).toBe(1); // the second one to run sees the first one's swipe
        expect(await matchRows(ix, iy)).toHaveLength(1);
      },
    );

    it('the same person double-clicking creates one swipe and one 409', async () => {
      const [h1, h2] = [await idOf('h1'), await idOf('h2')];
      const [r1, r2] = await Promise.all([
        swipe('h1', h2, 'LIKE'),
        swipe('h1', h2, 'LIKE'),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(
        await t.prisma.swipe.count({ where: { swiperId: h1, swipedId: h2 } }),
      ).toBe(1);
    });
  });

  describe('GET /matches', () => {
    let matchId: string;

    beforeAll(async () => {
      matchId = (await matchRows(await idOf('a'), await idOf('b')))[0].id;
    });

    it('lists my matches with the other user, no private fields', async () => {
      const res = await t
        .http()
        .get('/v1/matches')
        .set('Cookie', cookies.a)
        .expect(200);
      const page = body<Page>(res);
      const item = page.items.find((m) => m.id === matchId)!;
      expect(item.otherUser.username).toBe(key('b'));
      expect(item).toMatchObject({
        lastMessage: null,
        unreadCount: 0,
        type: 'SWAP',
      });
      for (const k of ['email', 'credits', 'lat', 'lng'])
        expect(item.otherUser).not.toHaveProperty(k);
    });

    it('detail is a mirror image for each side', async () => {
      const asA = body<MatchDetail>(
        await t
          .http()
          .get(`/v1/matches/${matchId}`)
          .set('Cookie', cookies.a)
          .expect(200),
      );
      const asB = body<MatchDetail>(
        await t
          .http()
          .get(`/v1/matches/${matchId}`)
          .set('Cookie', cookies.b)
          .expect(200),
      );
      expect(asA.otherUser.username).toBe(key('b'));
      expect(asB.otherUser.username).toBe(key('a'));
      expect([asA.learnSkill.name, asA.teachSkill?.name]).toEqual([
        key('spanish'),
        key('python'),
      ]);
      expect([asB.learnSkill.name, asB.teachSkill?.name]).toEqual([
        key('python'),
        key('spanish'),
      ]);
      expect(Object.keys(asA.breakdown).sort()).toEqual([
        'availability',
        'language',
        'mode',
        'priority',
        'reciprocity',
        'skill',
        'trust',
      ]);
    });

    it('is 403 for non-members, 404 for unknown ids, 401 without login', async () => {
      const res = await t
        .http()
        .get(`/v1/matches/${matchId}`)
        .set('Cookie', cookies.c)
        .expect(403);
      expect(body<ApiErrorBody>(res).error.code).toBe('FORBIDDEN');
      const missing = await t
        .http()
        .get('/v1/matches/nope')
        .set('Cookie', cookies.a)
        .expect(404);
      expect(body<ApiErrorBody>(missing).error.code).toBe('MATCH_NOT_FOUND');
      await t.http().get(`/v1/matches/${matchId}`).expect(401);
      await t.http().get('/v1/matches').expect(401);
    });

    it('paginates with a cursor, newest first, without repeating items', async () => {
      // give `a` two more matches so there are at least three
      for (const n of ['c', 'm1']) {
        const id = await idOf(n);
        await swipe('a', id, 'LIKE').expect(200);
        await swipe(n, await idOf('a'), 'LIKE').expect(200);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: Record<string, string | number> = { limit: 1 };
        if (cursor) query.cursor = cursor;
        const page = body<Page>(
          await t
            .http()
            .get('/v1/matches')
            .query(query)
            .set('Cookie', cookies.a)
            .expect(200),
        );
        expect(page.items.length).toBeLessThanOrEqual(1);
        seen.push(...page.items.map((m) => m.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 20);

      expect(new Set(seen).size).toBe(seen.length); // no repeats
      expect(seen.length).toBeGreaterThanOrEqual(3);
      expect(seen).toContain(matchId);
      await t
        .http()
        .get('/v1/matches')
        .query({ limit: 0 })
        .set('Cookie', cookies.a)
        .expect(422);
    });
  });
});
