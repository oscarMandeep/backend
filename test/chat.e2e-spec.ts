import { io, type Socket } from 'socket.io-client';
import { MatchStatus } from '../src/generated/prisma/client';
import {
  body,
  createTestApp,
  makeUser,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface AckRes {
  ok: boolean;
  code?: string;
  message?: {
    id: string;
    matchId: string;
    senderId: string;
    body: string;
    readAt: string | null;
  };
}
interface ChatMessage {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  clientId?: string;
}
interface Presence {
  userId: string;
  online: boolean;
}
interface Page {
  items: { id: string; body: string; matchId: string }[];
  nextCursor: string | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Chat (e2e)', () => {
  let t: TestApp;
  const tag = `ch${Date.now()}`;
  const key = (n: string) => `${tag}-${n}`;
  const open: Socket[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let spanish: string;
  let python: string;
  let matchAB: string;
  let archived: string;

  async function connect(as: string): Promise<Socket> {
    const token = await t.socketToken(cookies[as]);
    return new Promise((resolve, reject) => {
      const socket = io(t.baseUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      open.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }
  const call = (s: Socket, event: string, payload: unknown) =>
    s.emitWithAck(event, payload) as Promise<AckRes>;
  const join = (s: Socket, matchId: string) =>
    call(s, 'match:join', { matchId });
  const send = (s: Socket, matchId: string, text: string, clientId = 'c1') =>
    call(s, 'chat:send', { matchId, body: text, clientId });
  const nextEvent = <T>(s: Socket, name: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no "${name}" within ${ms} ms`)),
        ms,
      );
      s.once(name, (p: T) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
  const noEvent = (s: Socket, name: string, ms = 400) =>
    new Promise<void>((resolve, reject) => {
      const onEvent = () => reject(new Error(`unexpected "${name}"`));
      s.once(name, onEvent);
      setTimeout(() => {
        s.off(name, onEvent);
        resolve();
      }, ms);
    });
  const collect = <T>(s: Socket, name: string) => {
    const seen: T[] = [];
    s.on(name, (p: T) => seen.push(p));
    return seen;
  };

  async function makeMatch(
    x: string,
    y: string,
    status: MatchStatus = MatchStatus.ACTIVE,
  ) {
    const [userAId, userBId] = [ids[x], ids[y]].sort();
    const m = await t.prisma.match.create({
      data: {
        userAId,
        userBId,
        type: 'SWAP',
        score: 90,
        breakdown: {},
        status,
      },
    });
    return m.id;
  }
  const messageCount = (matchId: string) =>
    t.prisma.message.count({ where: { matchId } });

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: key(n), slug: key(n), category: 'Test' },
      });
    [spanish, python] = (await Promise.all([mk('spanish'), mk('python')])).map(
      (s) => s.id,
    );
    for (const n of ['a', 'b', 'c', 'r1', 'r2', 'z1', 'z2']) {
      ids[n] = (
        await makeUser(t.prisma, key(n), {
          haves: [{ skillId: python, level: 4 }],
          wants: [{ skillId: spanish }],
        })
      ).id;
      cookies[n] = await t.login(`${key(n)}@test.dev`);
    }
    matchAB = await makeMatch('a', 'b');
    archived = await makeMatch('a', 'c', MatchStatus.ARCHIVED);
  });

  afterAll(async () => {
    open.forEach((s) => s.close());
    await t.prisma.user.deleteMany({
      where: { email: { startsWith: `${tag}-` } },
    });
    await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    await t.close();
  });

  describe('match:join', () => {
    it('lets members in, and refuses everyone else with a code', async () => {
      const [a, c] = [await connect('a'), await connect('c')];
      expect(await join(a, matchAB)).toEqual({ ok: true });
      expect(await join(c, matchAB)).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(await join(a, 'no-such-match')).toEqual({
        ok: false,
        code: 'MATCH_NOT_FOUND',
      });
    });

    it('refuses an archived match and malformed payloads', async () => {
      const a = await connect('a');
      expect(await join(a, archived)).toEqual({
        ok: false,
        code: 'MATCH_CLOSED',
      });
      for (const bad of [
        {},
        { matchId: 5 },
        { matchId: 'x', extra: 1 },
        'hello',
        null,
      ]) {
        expect(await call(a, 'match:join', bad)).toEqual({
          ok: false,
          code: 'VALIDATION_FAILED',
        });
      }
    });
  });

  describe('chat:send', () => {
    it('saves the message, acks it, and delivers it live to everyone in the room', async () => {
      const [a, a2, b] = [
        await connect('a'),
        await connect('a'),
        await connect('b'),
      ];
      for (const s of [a, a2, b]) await join(s, matchAB);
      const gotB = nextEvent<ChatMessage>(b, 'chat:message');
      const gotA = nextEvent<ChatMessage>(a, 'chat:message');
      const gotA2 = nextEvent<ChatMessage>(a2, 'chat:message');

      const ack = await send(a, matchAB, '  hello b  ', 'client-1');
      expect(ack.ok).toBe(true);
      expect(ack.message).toMatchObject({
        matchId: matchAB,
        senderId: ids.a,
        body: 'hello b', // trimmed
        readAt: null,
      });

      for (const got of await Promise.all([gotA, gotA2, gotB])) {
        expect(got).toMatchObject({
          id: ack.message!.id,
          body: 'hello b',
          clientId: 'client-1',
        });
      }
      const saved = await t.prisma.message.findUniqueOrThrow({
        where: { id: ack.message!.id },
      });
      expect(saved.senderId).toBe(ids.a);
      const match = await t.prisma.match.findUniqueOrThrow({
        where: { id: matchAB },
      });
      expect(match.lastMsgAt?.getTime()).toBe(saved.createdAt.getTime());
    });

    it('does not deliver to a member who has not opened the chat (never joined)', async () => {
      const [a, b] = [await connect('a'), await connect('b')];
      await join(a, matchAB); // b stays out of the room
      const silent = noEvent(b, 'chat:message');
      expect((await send(a, matchAB, 'psst')).ok).toBe(true);
      await silent;
    });

    it('rejects invalid input and saves nothing', async () => {
      const a = await connect('a');
      const before = await messageCount(matchAB);
      const bad: unknown[] = [
        { matchId: matchAB, body: '', clientId: 'c' },
        { matchId: matchAB, body: '   ', clientId: 'c' },
        { matchId: matchAB, body: 'x'.repeat(2001), clientId: 'c' },
        { matchId: matchAB, body: 'hi' },
        { matchId: matchAB, body: 'hi', clientId: 'c', senderId: ids.b },
        'just a string',
      ];
      for (const payload of bad) {
        expect(await call(a, 'chat:send', payload)).toEqual({
          ok: false,
          code: 'VALIDATION_FAILED',
        });
      }
      expect((await send(a, matchAB, 'x'.repeat(2000))).ok).toBe(true); // the limit itself is allowed
      expect(await messageCount(matchAB)).toBe(before + 1);
    });

    it('only members can send, and only to active matches', async () => {
      const c = await connect('c');
      expect(await send(c, matchAB, 'let me in')).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(await send(c, 'nope', 'x')).toEqual({
        ok: false,
        code: 'MATCH_NOT_FOUND',
      });
      const a = await connect('a');
      expect(await send(a, archived, 'x')).toEqual({
        ok: false,
        code: 'MATCH_CLOSED',
      });
    });

    it('limits each user to 30 messages a minute, independently', async () => {
      const matchR = await makeMatch('r1', 'r2');
      const [r1, r2] = [await connect('r1'), await connect('r2')];
      const acks: AckRes[] = [];
      for (let i = 0; i < 31; i++)
        acks.push(await send(r1, matchR, `m${i}`, `id${i}`));
      expect(acks.filter((a) => a.ok)).toHaveLength(30);
      expect(acks[30]).toEqual({ ok: false, code: 'RATE_LIMITED' });
      expect((await send(r2, matchR, 'still fine')).ok).toBe(true); // other user unaffected
      expect(await messageCount(matchR)).toBe(31);
    });
  });

  describe('chat:typing', () => {
    it('reaches the other person only, and only from sockets that joined the room', async () => {
      const [a, b] = [await connect('a'), await connect('b')];
      await join(a, matchAB);
      await join(b, matchAB);
      const gotB = nextEvent<{
        userId: string;
        typing: boolean;
        matchId: string;
      }>(b, 'chat:typing');
      const notA = noEvent(a, 'chat:typing');
      a.emit('chat:typing', { matchId: matchAB, typing: true });
      expect(await gotB).toEqual({
        matchId: matchAB,
        userId: ids.a,
        typing: true,
      });
      await notA;

      const outsider = await connect('a'); // never joined
      const silent = noEvent(b, 'chat:typing');
      outsider.emit('chat:typing', { matchId: matchAB, typing: true });
      outsider.emit('chat:typing', { garbage: true }); // must not crash anything
      await silent;
    });
  });

  describe('chat:read and unread counts', () => {
    it("marks the other person's messages read, tells the room, and clears the unread count", async () => {
      const matchZ = await makeMatch('z1', 'z2');
      const [z1, z2] = [await connect('z1'), await connect('z2')];
      await join(z1, matchZ);
      await join(z2, matchZ);
      const first = await send(z1, matchZ, 'one');
      const last = await send(z1, matchZ, 'two');
      const mine = await send(z2, matchZ, 'reply from z2');

      const unread = async (as: string) => {
        const res = await t
          .http()
          .get('/v1/matches')
          .set('Cookie', cookies[as])
          .expect(200);
        const items = body<{ items: { id: string; unreadCount: number }[] }>(
          res,
        ).items;
        return items.find((m) => m.id === matchZ)!.unreadCount;
      };
      expect(await unread('z2')).toBe(2);
      expect(await unread('z1')).toBe(1);

      const notice = nextEvent<{
        userId: string;
        lastMessageId: string;
        matchId: string;
      }>(z1, 'chat:read');
      expect(
        await call(z2, 'chat:read', {
          matchId: matchZ,
          lastMessageId: last.message!.id,
        }),
      ).toEqual({ ok: true });
      expect(await notice).toEqual({
        matchId: matchZ,
        userId: ids.z2,
        lastMessageId: last.message!.id,
      });

      expect(await unread('z2')).toBe(0);
      expect(await unread('z1')).toBe(1); // z2's own message is still unread for z1
      const rows = await t.prisma.message.findMany({
        where: { matchId: matchZ },
      });
      expect(
        rows.find((m) => m.id === first.message!.id)?.readAt,
      ).not.toBeNull();
      expect(rows.find((m) => m.id === mine.message!.id)?.readAt).toBeNull();
    });

    it('refuses a message from another match, non-members and bad payloads', async () => {
      const [a, c] = [await connect('a'), await connect('c')];
      const other = await t.prisma.message.create({
        data: { matchId: archived, senderId: ids.a, body: 'elsewhere' },
      });
      expect(
        await call(a, 'chat:read', {
          matchId: matchAB,
          lastMessageId: other.id,
        }),
      ).toEqual({
        ok: false,
        code: 'MESSAGE_NOT_FOUND',
      });
      expect(
        await call(c, 'chat:read', {
          matchId: matchAB,
          lastMessageId: other.id,
        }),
      ).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(await call(a, 'chat:read', { matchId: matchAB })).toEqual({
        ok: false,
        code: 'VALIDATION_FAILED',
      });
    });
  });

  describe('presence', () => {
    it('shows who is online in a chat, and treats several tabs as one person', async () => {
      const matchP = await makeMatch('a', 'r1');
      const a = await connect('a');
      await join(a, matchP);
      const seenByA = collect<Presence>(a, 'presence');

      const b1 = await connect('r1');
      const seenByB1 = collect<Presence>(b1, 'presence');
      await join(b1, matchP);
      await wait(200);
      expect(seenByA).toContainEqual({ userId: ids.r1, online: true }); // a learns r1 arrived
      expect(seenByB1).toContainEqual({ userId: ids.a, online: true }); // r1 learns a is here

      const b2 = await connect('r1'); // second tab
      await join(b2, matchP);
      await wait(150);
      const before = seenByA.length;

      b1.close(); // one tab closes: r1 is still online through the other
      await wait(300);
      expect(seenByA.slice(before).filter((p) => !p.online)).toHaveLength(0);

      b2.close(); // last tab closes: now r1 is offline
      await wait(300);
      expect(seenByA[seenByA.length - 1]).toEqual({
        userId: ids.r1,
        online: false,
      });
    });

    it('match:leave reports offline when it was the last tab', async () => {
      const matchP2 = await makeMatch('b', 'r2');
      const [b, r2] = [await connect('b'), await connect('r2')];
      await join(b, matchP2);
      const seenByB = collect<Presence>(b, 'presence');
      await join(r2, matchP2);
      await wait(200); // b first hears that r2 arrived
      expect(seenByB).toContainEqual({ userId: ids.r2, online: true });

      expect(await call(r2, 'match:leave', { matchId: matchP2 })).toEqual({
        ok: true,
      });
      await wait(200);
      expect(seenByB[seenByB.length - 1]).toEqual({
        userId: ids.r2,
        online: false,
      });
    });
  });

  describe('REST: history and archive', () => {
    let matchH: string;

    beforeAll(async () => {
      matchH = await makeMatch('c', 'z1');
      for (let i = 1; i <= 5; i++) {
        await t.prisma.message.create({
          data: {
            matchId: matchH,
            senderId: i % 2 ? ids.c : ids.z1,
            body: `msg ${i}`,
            createdAt: new Date(Date.UTC(2031, 0, 1, 12, i)),
          },
        });
      }
    });

    it('returns messages newest first, in pages, with no repeats', async () => {
      const bodies: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: Record<string, string | number> = { limit: 2 };
        if (cursor) query.cursor = cursor;
        const res = await t
          .http()
          .get(`/v1/matches/${matchH}/messages`)
          .query(query)
          .set('Cookie', cookies.c)
          .expect(200);
        const page = body<Page>(res);
        bodies.push(...page.items.map((m) => m.body));
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(bodies).toEqual(['msg 5', 'msg 4', 'msg 3', 'msg 2', 'msg 1']);
      expect(pages).toBe(3);
    });

    it('guards history: 403 outsiders, 404 unknown, 401 anonymous, 422 bad limit', async () => {
      const forbidden = await t
        .http()
        .get(`/v1/matches/${matchH}/messages`)
        .set('Cookie', cookies.a)
        .expect(403);
      expect(body<ApiErrorBody>(forbidden).error.code).toBe('FORBIDDEN');
      await t
        .http()
        .get('/v1/matches/nope/messages')
        .set('Cookie', cookies.c)
        .expect(404);
      await t.http().get(`/v1/matches/${matchH}/messages`).expect(401);
      await t
        .http()
        .get(`/v1/matches/${matchH}/messages`)
        .query({ limit: 0 })
        .set('Cookie', cookies.c)
        .expect(422);
    });

    it('the match list shows the newest message as lastMessage', async () => {
      const res = await t
        .http()
        .get('/v1/matches')
        .set('Cookie', cookies.c)
        .expect(200);
      const item = body<{
        items: { id: string; lastMessage: { body: string } | null }[];
      }>(res).items.find((m) => m.id === matchH)!;
      expect(item.lastMessage?.body).toBe('msg 5');
    });

    it('archive hides the match for both people and closes the chat; outsiders cannot archive', async () => {
      await t
        .http()
        .post(`/v1/matches/${matchH}/archive`)
        .set('Cookie', cookies.a)
        .expect(403);
      await t
        .http()
        .post(`/v1/matches/${matchH}/archive`)
        .set('Cookie', cookies.c)
        .expect(204);
      await t
        .http()
        .post(`/v1/matches/${matchH}/archive`)
        .set('Cookie', cookies.c)
        .expect(204); // idempotent

      for (const as of ['c', 'z1']) {
        const res = await t
          .http()
          .get('/v1/matches')
          .set('Cookie', cookies[as])
          .expect(200);
        expect(
          body<{ items: { id: string }[] }>(res).items.map((m) => m.id),
        ).not.toContain(matchH);
      }
      const z1 = await connect('z1');
      expect(await send(z1, matchH, 'anyone there?')).toEqual({
        ok: false,
        code: 'MATCH_CLOSED',
      });
    });
  });
});
