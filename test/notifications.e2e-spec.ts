import { ConfigService } from '@nestjs/config';
import { RevalidateService } from '../src/notifications/revalidate.service';
import { body, createTestApp, makeUser, type TestApp } from './helpers';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Revalidation webhook (e2e)', () => {
  let t: TestApp;
  const tag = `nt${Date.now()}`;
  const realFetch = global.fetch;
  let hooks: { url: string; headers: Record<string, string>; tags: string[] }[];
  let webIsDown = false;
  let cookies: string[];
  let username: string;

  /** Catches only the website webhook; every other request (supertest, etc.) is untouched. */
  function stubWebhook() {
    hooks = [];
    global.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.endsWith('/internal/revalidate')) return realFetch(input, init);
      hooks.push({
        url,
        headers: init?.headers as Record<string, string>,
        tags: (JSON.parse(init?.body as string) as { tags: string[] }).tags,
      });
      return webIsDown
        ? Promise.reject(new Error('web is down'))
        : Promise.resolve(new Response('{}', { status: 200 }));
    };
  }
  /** Let the event handler queue its tags, then send them now instead of after the 1 s delay. */
  const settle = async () => {
    await wait(200);
    await t.app.get(RevalidateService).flush();
  };

  beforeAll(async () => {
    t = await createTestApp();
    stubWebhook();
    const skill = await t.prisma.skill.create({
      data: { name: `${tag}-sk`, slug: `${tag}-sk`, category: 'Test' },
    });
    username = `${tag}-me`;
    await makeUser(t.prisma, username, {
      haves: [{ skillId: skill.id, level: 3 }],
      wants: [],
    });
    cookies = await t.login(`${username}@test.dev`);
  });

  beforeEach(() => {
    hooks.length = 0;
    webIsDown = false;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    try {
      await t.prisma.user.deleteMany({
        where: { email: { startsWith: `${tag}-` } },
      });
      await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    } finally {
      await t.close();
    }
  });

  it('a profile change refreshes that profile, the skills it appears on, and its city', async () => {
    await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ bio: 'hello', city: 'Haridwar' })
      .expect(200);
    await settle();

    expect(hooks).toHaveLength(1);
    expect(hooks[0].tags).toEqual([
      'city:haridwar',
      `skill:${tag}-sk`,
      `user:${username}`,
    ]);
    const secret = t.app.get(ConfigService).get<string>('REVALIDATE_SECRET');
    expect(hooks[0].headers['x-revalidate-secret']).toBe(secret);
    expect(hooks[0].url).toBe(
      `${t.app.get(ConfigService).get<string>('WEB_URL')}/internal/revalidate`,
    );
  });

  it('several quick edits become ONE webhook call', async () => {
    for (const bio of ['one', 'two', 'three']) {
      await t
        .http()
        .patch('/v1/me')
        .set('Cookie', cookies)
        .send({ bio })
        .expect(200);
    }
    await settle();
    expect(hooks).toHaveLength(1);
  });

  it('a brand-new skill refreshes the skills index, its page and the sitemap; reusing one does not', async () => {
    const created = await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({ name: `${tag} Origami` })
      .expect(201);
    await settle();
    const slug = body<{ slug: string }>(created).slug;
    expect(hooks).toHaveLength(1);
    expect(hooks[0].tags).toEqual(['sitemap', `skill:${slug}`, 'skills']);

    hooks.length = 0;
    await t
      .http()
      .post('/v1/skills')
      .set('Cookie', cookies)
      .send({ name: `${tag} origami` })
      .expect(201); // same skill
    await settle();
    expect(hooks).toHaveLength(0);
  });

  it('a website that is down never breaks or slows the request that triggered it', async () => {
    webIsDown = true;
    const started = Date.now();
    await t
      .http()
      .patch('/v1/me')
      .set('Cookie', cookies)
      .send({ bio: 'still works' })
      .expect(200);
    expect(Date.now() - started).toBeLessThan(1000);
    await settle(); // the failure is only logged
    expect(hooks).toHaveLength(1);
    const me = await t.http().get('/v1/me').set('Cookie', cookies).expect(200);
    expect(body<{ bio: string }>(me).bio).toBe('still works');
  });
});
