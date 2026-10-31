import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import type { MatchNewPayload } from '../src/chat/socket.events';
import { createTestApp, makeUser, type TestApp } from './helpers';

describe('Sockets (e2e)', () => {
  let t: TestApp;
  const tag = `so${Date.now()}`;
  const key = (n: string) => `${tag}-${n}`;
  const open: Socket[] = [];
  let spanish: string;
  let python: string;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};

  /** Resolves when connected, rejects with the server's connect_error. */
  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(t.baseUrl, {
        auth: token === undefined ? {} : { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      open.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  const nextEvent = <T>(socket: Socket, name: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no "${name}" within ${ms} ms`)),
        ms,
      );
      socket.once(name, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const noEvent = (socket: Socket, name: string, ms = 400) =>
    new Promise<void>((resolve, reject) => {
      const onEvent = () => reject(new Error(`unexpected "${name}"`));
      socket.once(name, onEvent);
      setTimeout(() => {
        socket.off(name, onEvent);
        resolve();
      }, ms);
    });

  const tokenFor = async (n: string) => t.socketToken(cookies[n]);
  const swipe = (as: string, target: string) =>
    t
      .http()
      .post('/v1/swipes')
      .set('Cookie', cookies[as])
      .send({ targetId: ids[target], action: 'LIKE' });

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: key(n), slug: key(n), category: 'Test' },
      });
    [spanish, python] = (await Promise.all([mk('spanish'), mk('python')])).map(
      (s) => s.id,
    );
    const teach = (n: string, have: string, want: string) =>
      makeUser(t.prisma, key(n), {
        haves: [{ skillId: have, level: 4 }],
        wants: [{ skillId: want }],
      });
    for (const [n, have, want] of [
      ['a', python, spanish],
      ['b', spanish, python],
      ['c', python, spanish],
    ] as const) {
      ids[n] = (await teach(n, have, want)).id;
      cookies[n] = await t.login(`${key(n)}@test.dev`);
    }
  });

  afterAll(async () => {
    open.forEach((s) => s.close());
    await t.prisma.user.deleteMany({
      where: { email: { startsWith: `${tag}-` } },
    });
    await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    await t.close();
  });

  describe('handshake authentication', () => {
    it.each([
      ['no token', undefined],
      ['a garbage token', 'not-a-jwt'],
      ['an empty token', ''],
    ])('rejects %s with UNAUTHENTICATED', async (_label, token) => {
      await expect(connect(token)).rejects.toMatchObject({
        message: 'UNAUTHENTICATED',
      });
    });

    it('rejects an ACCESS token: the socket secret is different from the access secret', async () => {
      const access = cookies.a
        .find((c) => c.startsWith('ss_at='))!
        .split(';')[0]
        .slice('ss_at='.length);
      await expect(connect(access)).rejects.toMatchObject({
        message: 'UNAUTHENTICATED',
      });
    });

    it('rejects an expired socket token', async () => {
      const secret = t.app.get(ConfigService).get<string>('SOCKET_JWT_SECRET');
      const expired = await new JwtService({ secret }).signAsync(
        { sub: ids.a },
        { expiresIn: -10 },
      );
      await expect(connect(expired)).rejects.toMatchObject({
        message: 'UNAUTHENTICATED',
      });
    });

    it('accepts a fresh socket token', async () => {
      const socket = await connect(await tokenFor('a'));
      expect(socket.connected).toBe(true);
    });
  });

  describe('match:new', () => {
    it('is pushed live to BOTH people, mirrored, and to nobody else', async () => {
      const [sa, sa2, sb, sc] = await Promise.all([
        connect(await tokenFor('a')),
        connect(await tokenFor('a')), // a second tab of the same user
        connect(await tokenFor('b')),
        connect(await tokenFor('c')), // bystander
      ]);
      const gotA = nextEvent<MatchNewPayload>(sa, 'match:new');
      const gotA2 = nextEvent<MatchNewPayload>(sa2, 'match:new');
      const gotB = nextEvent<MatchNewPayload>(sb, 'match:new');
      const bystander = noEvent(sc, 'match:new');

      await swipe('a', 'b').expect(200); // first like: nobody is told anything yet
      await noEvent(sb, 'match:new', 300);
      const res = await swipe('b', 'a').expect(200); // second like: it's a match
      const matchId = (res.body as { matchId: string }).matchId;

      const [pa, pa2, pb] = await Promise.all([gotA, gotA2, gotB]);
      await bystander;

      expect(pa.matchId).toBe(matchId);
      expect(pb.matchId).toBe(matchId);
      expect(pa2).toEqual(pa); // every tab of a user gets it

      // a sees b, and learns Spanish / teaches Python...
      expect(pa.otherUser.username).toBe(key('b'));
      expect([pa.learnSkill.name, pa.teachSkill?.name]).toEqual([
        key('spanish'),
        key('python'),
      ]);
      // ...b sees a, and the mirror image
      expect(pb.otherUser.username).toBe(key('a'));
      expect([pb.learnSkill.name, pb.teachSkill?.name]).toEqual([
        key('python'),
        key('spanish'),
      ]);

      expect(pa).toMatchObject({ type: 'SWAP' });
      expect(pa.score).toBeGreaterThan(0);
      for (const k of ['email', 'credits', 'lat', 'lng'])
        expect(pa.otherUser).not.toHaveProperty(k);
    });

    it('a user who is offline simply gets it from GET /matches later', async () => {
      const res = await t
        .http()
        .get('/v1/matches')
        .set('Cookie', cookies.a)
        .expect(200);
      const items = (
        res.body as { items: { otherUser: { username: string } }[] }
      ).items;
      expect(items.map((m) => m.otherUser.username)).toContain(key('b'));
    });
  });
});
