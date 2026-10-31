import {
  body,
  createTestApp,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface Me {
  username: string;
  city: string | null;
  mode: string;
  languages: string[];
  onboarded: boolean;
  haves: { skill: { id: string }; level: number; verified: boolean }[];
  wants: { skill: { id: string }; goalLevel: number }[];
  availability: { dayOfWeek: number; startMin: number; endMin: number }[];
}

describe('Profile and onboarding (e2e)', () => {
  let t: TestApp;
  const tag = `pf${Date.now()}`;
  const email = `${tag}@test.dev`;
  let cookies: string[];
  let skillA: string;
  let skillB: string;
  let skillC: string;

  const put = (path: string, payload: object) =>
    t.http().put(`/v1/me${path}`).set('Cookie', cookies).send(payload);
  const details = (res: Parameters<typeof body>[0]) =>
    body<ApiErrorBody>(res).error.details ?? {};

  beforeAll(async () => {
    t = await createTestApp();
    await t.prisma.user.create({
      data: { email, username: tag, name: 'Profile E2E' },
    });
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: `${tag} ${n}`, slug: `${tag}-${n}`, category: 'Test' },
      });
    [skillA, skillB, skillC] = (
      await Promise.all([mk('a'), mk('b'), mk('c')])
    ).map((s) => s.id);
    cookies = await t.login(email);
  });

  afterAll(async () => {
    await t.prisma.user.deleteMany({ where: { email } });
    await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    await t.close();
  });

  it('PATCH /me updates fields and sets coordinates for known cities', async () => {
    const res = await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({
        name: 'Riya S',
        bio: 'Hello',
        city: 'Dehradun',
        mode: 'ONLINE',
        languages: ['English', 'Hindi', 'English'],
        timezone: 'Asia/Kolkata',
      })
      .expect(200);
    expect(body<Me>(res)).toMatchObject({ city: 'Dehradun', mode: 'ONLINE' });
    expect(body<Me>(res).languages).toEqual(['English', 'Hindi']); // de-duplicated
    const row = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.lat).toBeCloseTo(30.3165, 3);
  });

  it('PATCH /me validates input and rejects unknown fields', async () => {
    const bad = await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({
        username: 'Bad Name!',
        timezone: 'Mars/Base',
        avatarUrl: 'javascript:alert(1)',
      })
      .expect(422);
    expect(Object.keys(details(bad)).sort()).toEqual([
      'avatarUrl',
      'timezone',
      'username',
    ]);
    await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ credits: 999 })
      .expect(422);
    await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ onboarded: true })
      .expect(422);
  });

  it('PATCH /me answers 409 USERNAME_TAKEN for a taken username', async () => {
    const other = `${tag}x`;
    await t.prisma.user.create({
      data: { email: `${other}@test.dev`, username: other, name: 'x' },
    });
    const res = await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ username: other })
      .expect(409);
    expect(body<ApiErrorBody>(res).error.code).toBe('USERNAME_TAKEN');
    await t.prisma.user.delete({ where: { email: `${other}@test.dev` } });
  });

  it('onboarding cannot complete while the profile is empty, and says why', async () => {
    const res = await t
      .http()
      .post('/v1/me/onboarding/complete')
      .set('Cookie', cookies)
      .expect(422);
    expect(Object.keys(details(res)).sort()).toEqual([
      'availability',
      'haves',
      'wants',
    ]);
  });

  it('PUT /me/skills rejects duplicates, overlap between have/want, unknown ids, bad goals', async () => {
    const dup = await put('/skills', {
      haves: [
        { skillId: skillA, level: 3 },
        { skillId: skillA, level: 4 },
      ],
      wants: [],
    }).expect(422);
    expect(details(dup).haves).toBeDefined();

    const both = await put('/skills', {
      haves: [{ skillId: skillA, level: 3 }],
      wants: [
        { skillId: skillA, currentLevel: 1, goalLevel: 3, priority: 'HIGH' },
      ],
    }).expect(422);
    expect(details(both).wants).toBeDefined();

    const unknown = await put('/skills', {
      haves: [{ skillId: 'nope', level: 3 }],
      wants: [],
    }).expect(422);
    expect(details(unknown).haves).toContain('unknown skillId');

    await put('/skills', {
      haves: [],
      wants: [
        { skillId: skillB, currentLevel: 4, goalLevel: 2, priority: 'LOW' },
      ],
    }).expect(422);

    await put('/skills', {
      haves: [{ skillId: skillA, level: 9 }],
      wants: [],
    }).expect(422); // level out of range, caught by the DTO
  });

  it('PUT /me/skills replaces both lists and keeps verified badges', async () => {
    await put('/skills', {
      haves: [{ skillId: skillA, level: 4, years: 3 }],
      wants: [
        { skillId: skillB, currentLevel: 1, goalLevel: 3, priority: 'HIGH' },
      ],
    }).expect(200);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    await t.prisma.userSkillHave.updateMany({
      where: { userId: user.id },
      data: { verified: true },
    });

    const res = await put('/skills', {
      haves: [
        { skillId: skillA, level: 5 },
        { skillId: skillC, level: 2 },
      ],
      wants: [
        { skillId: skillB, currentLevel: 2, goalLevel: 4, priority: 'MEDIUM' },
      ],
    }).expect(200);
    const me = body<Me>(res);
    expect(me.haves).toHaveLength(2);
    expect(me.haves.find((h) => h.skill.id === skillA)).toMatchObject({
      level: 5,
      verified: true,
    });
    expect(me.haves.find((h) => h.skill.id === skillC)?.verified).toBe(false);
    expect(me.wants[0]).toMatchObject({ goalLevel: 4 });
  });

  it('PUT /me/availability rejects overlaps and replaces the list', async () => {
    const bad = await put('/availability', {
      slots: [
        { dayOfWeek: 1, startMin: 600, endMin: 700 },
        { dayOfWeek: 1, startMin: 650, endMin: 720 },
      ],
    }).expect(422);
    expect(details(bad).slots).toBeDefined();
    await put('/availability', {
      slots: [{ dayOfWeek: 1, startMin: 700, endMin: 600 }],
    }).expect(422);
    await put('/availability', {
      slots: [{ dayOfWeek: 9, startMin: 0, endMin: 60 }],
    }).expect(422);

    const ok = await put('/availability', {
      slots: [
        { dayOfWeek: 3, startMin: 1080, endMin: 1200 },
        { dayOfWeek: 1, startMin: 600, endMin: 700 },
      ],
    }).expect(200);
    expect(body<Me['availability']>(ok)).toEqual([
      { dayOfWeek: 1, startMin: 600, endMin: 700 },
      { dayOfWeek: 3, startMin: 1080, endMin: 1200 },
    ]);
  });

  it('onboarding completes once the profile is complete', async () => {
    const res = await t
      .http()
      .post('/v1/me/onboarding/complete')
      .set('Cookie', cookies)
      .expect(200);
    expect(body<Me>(res).onboarded).toBe(true);
  });

  it('in-person mode needs a city to finish onboarding', async () => {
    await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ mode: 'BOTH', city: '' })
      .expect(200);
    const res = await t
      .http()
      .post('/v1/me/onboarding/complete')
      .set('Cookie', cookies)
      .expect(422);
    expect(details(res).city).toBeDefined();
  });

  it('all profile routes require login', async () => {
    await t.http().patch('/v1/me').send({ name: 'x' }).expect(401);
    await t
      .http()
      .put('/v1/me/skills')
      .send({ haves: [], wants: [] })
      .expect(401);
    await t.http().put('/v1/me/availability').send({ slots: [] }).expect(401);
    await t.http().post('/v1/me/onboarding/complete').expect(401);
  });
});
