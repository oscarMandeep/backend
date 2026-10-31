import { Mode } from '../src/generated/prisma/client';
import {
  body,
  createTestApp,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface Card {
  user: { username: string } & Record<string, unknown>;
  score: number;
  type: 'SWAP' | 'CREDIT';
  breakdown: Record<string, number>;
  reasons: string[];
  learnSkill: { name: string };
  teachSkill: { name: string } | null;
}

describe('Discover (e2e)', () => {
  let t: TestApp;
  const tag = `dc${Date.now()}`;
  const emailOf = (n: string) => `${tag}-${n}@test.dev`;
  const nameOf = (n: string) => `${tag}-${n}`;
  let cookies: string[];
  let spanish: string;
  let python: string;
  let guitar: string;

  const evenings = [
    { dayOfWeek: 1, startMin: 1080, endMin: 1200 },
    { dayOfWeek: 6, startMin: 600, endMin: 720 },
  ]; // 4 shared hours/week

  async function makeUser(
    n: string,
    o: {
      haves: { skillId: string; level: number }[];
      wants?: { skillId: string; goalLevel?: number }[];
      mode?: Mode;
      languages?: string[];
      onboarded?: boolean;
    },
  ) {
    return t.prisma.user.create({
      data: {
        email: emailOf(n),
        username: nameOf(n),
        name: n,
        city: 'Dehradun',
        mode: o.mode ?? Mode.BOTH,
        languages: o.languages ?? ['English'],
        onboarded: o.onboarded ?? true,
        haves: { create: o.haves },
        wants: {
          create: (o.wants ?? []).map((w) => ({
            skillId: w.skillId,
            currentLevel: 1,
            goalLevel: w.goalLevel ?? 3,
            priority: 'HIGH' as const,
          })),
        },
        slots: { create: evenings },
      },
    });
  }

  const deck = async (query: Record<string, string | number> = {}) =>
    body<Card[]>(
      await t
        .http()
        .get('/v1/discover')
        .query(query)
        .set('Cookie', cookies)
        .expect(200),
    );
  const names = (cards: Card[]) =>
    cards.map((c) => c.user.username.replace(`${tag}-`, ''));

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: nameOf(n), slug: nameOf(n), category: 'Test' },
      });
    [spanish, python, guitar] = (
      await Promise.all([mk('spanish'), mk('python'), mk('guitar')])
    ).map((s) => s.id);

    const me = await makeUser('me', {
      haves: [{ skillId: python, level: 4 }],
      wants: [{ skillId: spanish }],
    });
    const wantsPython = [{ skillId: python }];
    const teachesSpanish = (level: number) => [{ skillId: spanish, level }];

    await makeUser('swapper', { haves: teachesSpanish(4), wants: wantsPython });
    await makeUser('online', {
      haves: teachesSpanish(4),
      wants: wantsPython,
      mode: Mode.ONLINE,
    });
    await makeUser('partial', { haves: teachesSpanish(2), wants: wantsPython });
    await makeUser('credit', {
      haves: teachesSpanish(4),
      wants: [{ skillId: guitar }],
    });
    await makeUser('nolang', {
      haves: teachesSpanish(4),
      wants: wantsPython,
      languages: ['Tamil'],
    });
    await makeUser('noonboard', {
      haves: teachesSpanish(4),
      wants: wantsPython,
      onboarded: false,
    });
    const blocked = await makeUser('blocked', {
      haves: teachesSpanish(4),
      wants: wantsPython,
    });
    const swiped = await makeUser('swiped', {
      haves: teachesSpanish(4),
      wants: wantsPython,
    });
    await makeUser('irrelevant', {
      haves: [{ skillId: guitar, level: 5 }],
      wants: wantsPython,
    });

    await t.prisma.block.create({
      data: { blockerId: blocked.id, blockedId: me.id },
    });
    await t.prisma.swipe.create({
      data: { swiperId: me.id, swipedId: swiped.id, action: 'PASS', score: 50 },
    });
    cookies = await t.login(emailOf('me'));
  });

  afterAll(async () => {
    await t.prisma.user.deleteMany({
      where: { email: { startsWith: `${tag}-` } },
    });
    await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    await t.close();
  });

  it('ranks by score, with the new-user boost, and computes the documented scores', async () => {
    const cards = await deck();
    expect(names(cards)).toEqual(['swapper', 'online', 'partial', 'credit']);
    expect(cards.map((c) => [c.score, c.type])).toEqual([
      [96, 'SWAP'], // 35+25+10+10+8+3.5+4.2 = 95.7
      [93, 'SWAP'], // online-only: mode 0.7 instead of 1 -> 95.7 - 2.4
      [78, 'SWAP'], // teacher level 2 -> skill fit 0.5
      [71, 'CREDIT'], // they want nothing I teach
    ]);
  });

  it('excludes: no shared language, not onboarded, blocked, already swiped, nothing to teach, self', async () => {
    const found = names(await deck());
    for (const n of [
      'nolang',
      'noonboard',
      'blocked',
      'swiped',
      'irrelevant',
      'me',
    ]) {
      expect(found).not.toContain(n);
    }
  });

  it('cards carry the breakdown, reasons and both skills', async () => {
    const [top] = await deck();
    expect(Object.keys(top.breakdown).sort()).toEqual([
      'availability',
      'language',
      'mode',
      'priority',
      'reciprocity',
      'skill',
      'trust',
    ]);
    expect(top.learnSkill.name).toBe(nameOf('spanish'));
    expect(top.teachSkill?.name).toBe(nameOf('python'));
    expect(top.reasons).toEqual([
      `Teaches ${nameOf('spanish')} (you want)`,
      `Wants ${nameOf('python')} (you teach)`,
      '4 shared hrs/week',
      'Both in Dehradun',
      'Both speak English',
    ]);
  });

  it('a credit card has no teachSkill', async () => {
    const credit = (await deck()).find(
      (c) => c.user.username === nameOf('credit'),
    )!;
    expect(credit.teachSkill).toBeNull();
    expect(credit.reasons).not.toContain(expect.stringContaining('Wants '));
  });

  it('never leaks private fields', async () => {
    const [top] = await deck();
    for (const key of [
      'email',
      'credits',
      'googleId',
      'timezone',
      'lat',
      'lng',
      'onboarded',
    ]) {
      expect(top.user).not.toHaveProperty(key);
    }
    expect(top.user).toHaveProperty('username');
  });

  it('swapOnly drops credit matches; mode filters by what they can do; limit caps the deck', async () => {
    expect(names(await deck({ swapOnly: 'true' }))).toEqual([
      'swapper',
      'online',
      'partial',
    ]);
    expect(names(await deck({ mode: 'IN_PERSON' }))).toEqual([
      'swapper',
      'partial',
      'credit',
    ]);
    expect(names(await deck({ mode: 'ONLINE' }))).toHaveLength(4);
    expect(await deck({ limit: 2 })).toHaveLength(2);
  });

  it('validates the query and requires login and onboarding', async () => {
    await t
      .http()
      .get('/v1/discover')
      .query({ limit: 999 })
      .set('Cookie', cookies)
      .expect(422);
    await t
      .http()
      .get('/v1/discover')
      .query({ mode: 'MOON' })
      .set('Cookie', cookies)
      .expect(422);
    await t.http().get('/v1/discover').expect(401);

    const fresh = `${tag}-fresh@test.dev`;
    await t.prisma.user.create({
      data: { email: fresh, username: nameOf('fresh'), name: 'f' },
    });
    const freshCookies = await t.login(fresh); // log in first: never nest two supertest calls
    const res = await t
      .http()
      .get('/v1/discover')
      .set('Cookie', freshCookies)
      .expect(409);
    expect(body<ApiErrorBody>(res).error.code).toBe('ONBOARDING_REQUIRED');
  });
});
