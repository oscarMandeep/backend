import { body, createTestApp, makeUser, type TestApp } from './helpers';

interface Card {
  username: string;
  ratingAvg: number;
  city: string | null;
}
interface SkillPage {
  slug: string;
  teacherCount: number;
  learnerCount: number;
  teachers: Card[];
  popularSwaps: { skill: { slug: string }; count: number }[];
}

/** Keys and values that must never reach the public internet. */
const FORBIDDEN_KEYS = [
  'email',
  'googleId',
  'google_id',
  'lat',
  'lng',
  'credits',
  'availability',
  'timezone',
  'isPublic',
  'onboarded',
  'noShowCount',
];

describe('Public API (e2e)', () => {
  let t: TestApp;
  const tag = `pb${Date.now()}`;
  const name = (n: string) => `${tag}-${n}`;
  const everything: string[] = []; // every response body, for the privacy scan
  let skillS: string;
  let skillT: string;
  let skillU: string;

  /** No cookies on purpose: these endpoints are for anonymous visitors. */
  const get = async (
    path: string,
    query: Record<string, string | number> = {},
  ) => {
    const res = await t.http().get(path).query(query);
    everything.push(JSON.stringify(res.body));
    return res;
  };

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string, category: string) =>
      t.prisma.skill.create({
        data: { name: name(n), slug: name(n), category, aliases: [] },
      });
    [skillS, skillT, skillU] = (
      await Promise.all([mk('s', 'Test'), mk('t', 'Test'), mk('u', 'Other')])
    ).map((s) => s.id);

    // 13 visible teachers of S: 4 in Haridwar, 9 in Dehradun, ratings 1.0 .. 5.0
    for (let i = 1; i <= 13; i++) {
      const user = await makeUser(t.prisma, name(`t${i}`), {
        haves: [{ skillId: skillS, level: 3 }],
        wants: i <= 5 ? [{ skillId: skillT }] : [],
      });
      await t.prisma.user.update({
        where: { id: user.id },
        data: {
          city: i <= 4 ? 'Haridwar' : 'Dehradun',
          ratingAvg: i / 3,
          sessionsDone: i,
          bio: `bio ${i}`,
          lat: 29.9,
          lng: 78.1,
        },
      });
    }
    // people who teach S but must stay invisible
    const hidden = await makeUser(t.prisma, name('private'), {
      haves: [{ skillId: skillS, level: 5 }],
    });
    await t.prisma.user.update({
      where: { id: hidden.id },
      data: { isPublic: false, city: 'Haridwar', ratingAvg: 5 },
    });
    const fresh = await makeUser(t.prisma, name('fresh'), {
      haves: [{ skillId: skillS, level: 5 }],
      onboarded: false,
    });
    await t.prisma.user.update({
      where: { id: fresh.id },
      data: { city: 'Haridwar', ratingAvg: 5 },
    });
    // two teachers of U in one city: below the 3 needed for an indexed city page
    for (const n of ['u1', 'u2']) {
      const u = await makeUser(t.prisma, name(n), {
        haves: [{ skillId: skillU, level: 3 }],
      });
      await t.prisma.user.update({
        where: { id: u.id },
        data: { city: 'Mumbai' },
      });
    }
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

  describe('skill pages', () => {
    it('counts and lists only public, onboarded people, best rated first, at most 12', async () => {
      const res = await get(`/v1/public/skills/${name('s')}`);
      expect(res.status).toBe(200);
      const page = body<SkillPage>(res);
      expect(page.teacherCount).toBe(13); // not 15: the private and not-onboarded ones are excluded
      expect(page.teachers).toHaveLength(12);
      const ratings = page.teachers.map((c) => c.ratingAvg);
      expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
      const usernames = page.teachers.map((c) => c.username);
      expect(usernames).not.toContain(name('private'));
      expect(usernames).not.toContain(name('fresh'));
    });

    it('shows what teachers of this skill want in return', async () => {
      const page = body<SkillPage>(await get(`/v1/public/skills/${name('s')}`));
      expect(page.popularSwaps.map((s) => [s.skill.slug, s.count])).toEqual([
        [name('t'), 5],
      ]);
      const t2 = body<SkillPage>(await get(`/v1/public/skills/${name('t')}`));
      expect(t2.learnerCount).toBe(5);
      expect(t2.teacherCount).toBe(0);
    });

    it('404 for an unknown skill', async () => {
      expect((await get('/v1/public/skills/no-such-skill')).status).toBe(404);
    });

    it('city pages filter teachers by city, ignoring case and hyphens', async () => {
      const har = body<{
        city: string;
        teacherCount: number;
        teachers: Card[];
      }>(await get(`/v1/public/skills/${name('s')}/cities/haridwar`));
      expect(har).toMatchObject({ city: 'Haridwar', teacherCount: 4 });
      expect(har.teachers.every((c) => c.city === 'Haridwar')).toBe(true);
      expect(har.teachers.map((c) => c.username)).not.toContain(
        name('private'),
      );

      const upper = body<{ teacherCount: number }>(
        await get(`/v1/public/skills/${name('s')}/cities/HARIDWAR`),
      );
      expect(upper.teacherCount).toBe(4);

      const nowhere = body<{
        city: string;
        teacherCount: number;
        teachers: Card[];
      }>(await get(`/v1/public/skills/${name('s')}/cities/new-atlantis`));
      expect(nowhere).toMatchObject({
        city: 'New Atlantis',
        teacherCount: 0,
        teachers: [],
      });
      expect(
        (await get('/v1/public/skills/no-such-skill/cities/haridwar')).status,
      ).toBe(404);
    });
  });

  describe('profiles', () => {
    it('shows a public profile with skills, and nothing else', async () => {
      const res = await get(`/v1/public/users/${name('t1')}`);
      expect(res.status).toBe(200);
      expect(body<Record<string, unknown>>(res)).toMatchObject({
        username: name('t1'),
        bio: 'bio 1',
        haves: [{ skill: { slug: name('s') }, level: 3 }],
        wants: [{ skill: { slug: name('t') } }],
      });
    });

    it.each(['private', 'fresh', 'nobody'])(
      '404 for %s (hidden, not onboarded or unknown)',
      async (n) => {
        expect((await get(`/v1/public/users/${name(n)}`)).status).toBe(404);
      },
    );
  });

  describe('lists, stats and sitemap', () => {
    it('lists skills with counts and filters by category and limit', async () => {
      const all = body<{ slug: string; teacherCount: number }[]>(
        await get('/v1/public/skills', { limit: 200 }),
      );
      expect(all.find((s) => s.slug === name('s'))?.teacherCount).toBe(13);

      const cat = body<{ slug: string; category: string }[]>(
        await get('/v1/public/skills', { category: 'test', limit: 200 }),
      );
      expect(cat.every((s) => s.category === 'Test')).toBe(true);
      expect(cat.map((s) => s.slug)).toEqual(
        expect.arrayContaining([name('s'), name('t')]),
      );
      expect(cat.map((s) => s.slug)).not.toContain(name('u'));

      expect(
        body<unknown[]>(await get('/v1/public/skills', { limit: 1 })),
      ).toHaveLength(1);
      expect((await get('/v1/public/skills', { limit: 0 })).status).toBe(422);
    });

    it('stats are whole numbers with at most five top swaps, biggest first', async () => {
      const stats = body<{
        users: number;
        skills: number;
        sessions: number;
        topSwaps: {
          count: number;
          from: { slug: string };
          to: { slug: string };
        }[];
      }>(await get('/v1/public/stats'));
      for (const n of [stats.users, stats.skills, stats.sessions])
        expect(Number.isInteger(n) && n >= 0).toBe(true);
      expect(stats.users).toBeGreaterThanOrEqual(13);
      expect(stats.topSwaps.length).toBeLessThanOrEqual(5);
      const counts = stats.topSwaps.map((s) => s.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(stats.topSwaps.every((s) => s.from.slug && s.to.slug)).toBe(true);
    });

    it('the sitemap lists public pages only, and city pages only with 3+ teachers', async () => {
      const map = body<{
        skills: { slug: string }[];
        users: { username: string }[];
        localPages: { skill: string; city: string }[];
      }>(await get('/v1/public/sitemap'));
      expect(map.skills.map((s) => s.slug)).toEqual(
        expect.arrayContaining([name('s'), name('t'), name('u')]),
      );
      const users = map.users.map((u) => u.username);
      expect(users).toContain(name('t1'));
      expect(users).not.toContain(name('private'));
      expect(users).not.toContain(name('fresh'));

      const mine = map.localPages.filter((p) => p.skill.startsWith(tag));
      expect(mine).toContainEqual({ skill: name('s'), city: 'Haridwar' });
      expect(mine).toContainEqual({ skill: name('s'), city: 'Dehradun' });
      expect(mine.find((p) => p.skill === name('u'))).toBeUndefined(); // only 2 teachers
    });

    it('is open to anonymous visitors and safe for a CDN to cache', async () => {
      const res = await t.http().get('/v1/public/stats').expect(200); // no cookie
      expect(res.headers['cache-control']).toMatch(/public/);
      expect(res.headers['cache-control']).toMatch(/s-maxage=\d+/);
    });
  });

  it('PRIVACY: no response ever contains a private key or any private value', () => {
    expect(everything.length).toBeGreaterThan(10);
    const text = everything.join('\n');
    for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('@test.dev'); // no email addresses at all
    expect(text).not.toContain('29.9'); // the coordinates we stored on the test users
  });
});
