import {
  body,
  createTestApp,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface SkillRef {
  id: string;
  name: string;
  slug: string;
  category: string;
}

describe('Skills (e2e)', () => {
  let t: TestApp;
  const tag = `sk${Date.now()}`;
  const email = `${tag}@test.dev`;
  let cookies: string[];

  beforeAll(async () => {
    t = await createTestApp();
    await t.prisma.user.create({
      data: { email, username: tag, name: 'Skills E2E' },
    });
    await t.prisma.skill.create({
      data: {
        name: 'Zzyzx Calligraphy',
        slug: `zzyzx-${tag}`,
        category: 'Art',
        aliases: ['zzyzxpen'],
      },
    });
    cookies = await t.login(email);
  });

  afterAll(async () => {
    await t.prisma.skill.deleteMany({
      where: {
        OR: [{ slug: { contains: tag } }, { slug: { startsWith: 'zzq-' } }],
      },
    });
    await t.prisma.user.deleteMany({ where: { email } });
    await t.close();
  });

  it('search is public and tolerates typos', async () => {
    const res = await t
      .http()
      .get('/v1/skills/search')
      .query({ q: 'zyzx calligrapy' })
      .expect(200);
    expect(body<SkillRef[]>(res).map((s) => s.name)).toContain(
      'Zzyzx Calligraphy',
    );
  });

  it('search matches aliases', async () => {
    const res = await t
      .http()
      .get('/v1/skills/search')
      .query({ q: 'zzyzxpen' })
      .expect(200);
    expect(body<SkillRef[]>(res).map((s) => s.name)).toContain(
      'Zzyzx Calligraphy',
    );
  });

  it('search treats % literally instead of as a wildcard', async () => {
    const res = await t
      .http()
      .get('/v1/skills/search')
      .query({ q: '%', limit: 20 })
      .expect(200);
    expect(body<SkillRef[]>(res)).toHaveLength(0);
  });

  it('search validates input', async () => {
    await t.http().get('/v1/skills/search').expect(422);
    await t
      .http()
      .get('/v1/skills/search')
      .query({ q: 'x', limit: 999 })
      .expect(422);
  });

  it('create requires login', async () => {
    const res = await t
      .http()
      .post('/v1/skills')
      .send({ name: 'Anything' })
      .expect(401);
    expect(body<ApiErrorBody>(res).error.code).toBe('UNAUTHENTICATED');
  });

  it('create normalises, then reuses the same skill for the same name', async () => {
    if (process.env.GROQ_API_KEY) return; // the model's wording is not deterministic
    const first = await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({ name: '  zzq rock   climbing ' })
      .expect(201);
    expect(body<SkillRef>(first)).toMatchObject({
      name: 'Zzq Rock Climbing',
      slug: 'zzq-rock-climbing',
      category: 'Other',
    });
    const again = await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({ name: 'ZZQ ROCK CLIMBING' })
      .expect(201);
    expect(body<SkillRef>(again).id).toBe(body<SkillRef>(first).id);
  });

  it('create rejects empty or too-short names', async () => {
    await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({ name: ' ' })
      .expect(422);
    await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({})
      .expect(422);
  });
});
