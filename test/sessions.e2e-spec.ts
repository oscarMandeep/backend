import { io, type Socket } from 'socket.io-client';
import { SessionsService } from '../src/sessions/sessions.service';
import {
  body,
  createTestApp,
  makeUser,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface Session {
  id: string;
  status: string;
  proposedById: string | null;
  meetingUrl: string | null;
  location: string | null;
  mode: string;
  myReview: { rating: number } | null;
  teacher: { username: string };
  learner: { username: string };
  durationMin: number;
}

const HOUR = 3_600_000;

describe('Sessions, credits and reviews (e2e)', () => {
  let t: TestApp;
  const tag = `se${Date.now()}`;
  const key = (n: string) => `${tag}-${n}`;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let spanish: string;
  let python: string;
  let matchAB: string;
  let counter = 0;

  /** A start time nobody else uses: tests never collide with each other's sessions. */
  const freshStart = () =>
    new Date(Date.now() + (48 + 4 * counter++) * HOUR).toISOString();
  const code = (res: Parameters<typeof body>[0]) =>
    body<ApiErrorBody>(res).error.code;

  const proposeBody = (over: Record<string, unknown> = {}) => ({
    matchId: matchAB,
    skillId: python,
    teacherId: ids.a,
    startsAt: freshStart(),
    durationMin: 60,
    mode: 'ONLINE',
    ...over,
  });
  const post = (as: string, path: string, payload?: object) =>
    t.http().post(path).set('Cookie', cookies[as]).send(payload);
  const propose = (as: string, over: Record<string, unknown> = {}) =>
    post(as, '/v1/sessions', proposeBody(over));

  async function newConfirmed(
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await propose('a', over).expect(201);
    const id = body<Session>(created).id;
    await post('b', `/v1/sessions/${id}/confirm`).expect(200);
    return id;
  }
  /** Moves a session into the past so it can be completed / reported. */
  // Each call gets its own slot, 3 hours apart, so two past sessions of the same
  // person can never overlap (the database would reject that, rightly).
  let pastSlots = 0;
  const intoThePast = (id: string) =>
    t.prisma.session.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - (3 + 3 * pastSlots++) * HOUR) },
    });
  const credits = async (n: string) =>
    (await t.prisma.user.findUniqueOrThrow({ where: { id: ids[n] } })).credits;
  const setCredits = (n: string, value: number) =>
    t.prisma.user.update({ where: { id: ids[n] }, data: { credits: value } });

  beforeAll(async () => {
    t = await createTestApp();
    const mk = (n: string) =>
      t.prisma.skill.create({
        data: { name: key(n), slug: key(n), category: 'Test' },
      });
    [spanish, python] = (await Promise.all([mk('spanish'), mk('python')])).map(
      (s) => s.id,
    );
    const teaches = (n: string, have: string, want: string) =>
      makeUser(t.prisma, key(n), {
        haves: [{ skillId: have, level: 4 }],
        wants: [{ skillId: want }],
      });
    for (const [n, have, want] of [
      ['a', python, spanish],
      ['b', spanish, python],
      ['c', python, spanish],
    ] as const) {
      ids[n] = (await teaches(n, have, want)).id;
      cookies[n] = await t.login(`${key(n)}@test.dev`);
    }
    const [userAId, userBId] = [ids.a, ids.b].sort();
    matchAB = (
      await t.prisma.match.create({
        data: { userAId, userBId, type: 'SWAP', score: 90, breakdown: {} },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      // Users that still have sessions cannot be deleted, so sessions go first.
      await t.prisma.session.deleteMany({
        where: {
          OR: [
            { teacher: { email: { startsWith: `${tag}-` } } },
            { learner: { email: { startsWith: `${tag}-` } } },
          ],
        },
      });
      await t.prisma.user.deleteMany({
        where: { email: { startsWith: `${tag}-` } },
      });
      await t.prisma.skill.deleteMany({ where: { slug: { startsWith: tag } } });
    } finally {
      await t.close(); // never leave the server running, or Jest cannot exit
    }
  });

  describe('proposing', () => {
    it('creates a PROPOSED session; the proposer is recorded, the other person is the learner', async () => {
      const res = await propose('a').expect(201);
      const s = body<Session>(res);
      expect(s).toMatchObject({
        status: 'PROPOSED',
        proposedById: ids.a,
        meetingUrl: null,
        mode: 'ONLINE',
      });
      expect([s.teacher.username, s.learner.username]).toEqual([
        key('a'),
        key('b'),
      ]);
    });

    it('either person can propose (the learner asks the teacher for a time)', async () => {
      const res = await propose('b').expect(201);
      expect(body<Session>(res).proposedById).toBe(ids.b);
    });

    it('validates times, durations, location, teacher and skill', async () => {
      const cases: [string, Record<string, unknown>][] = [
        ['startsAt', { startsAt: new Date(Date.now() - HOUR).toISOString() }],
        ['durationMin', { durationMin: 50 }],
        ['location', { mode: 'IN_PERSON' }],
        ['teacherId', { teacherId: ids.c }],
        ['skillId', { skillId: spanish }], // a does not teach spanish
      ];
      for (const [field, over] of cases) {
        const res = await propose('a', over).expect(422);
        expect(
          Object.keys(body<ApiErrorBody>(res).error.details ?? {}),
        ).toContain(field);
      }
      await propose('a', { mode: 'BOTH' }).expect(422);
      await propose('a', { durationMin: 500 }).expect(422);
      await propose('a', { startsAt: 'tomorrow' }).expect(422);
    });

    it('keeps the location for in-person sessions', async () => {
      const res = await propose('a', {
        mode: 'IN_PERSON',
        location: 'Cafe Coffee Day, Rajpur Road',
      }).expect(201);
      expect(body<Session>(res)).toMatchObject({
        mode: 'IN_PERSON',
        location: 'Cafe Coffee Day, Rajpur Road',
      });
    });

    it('only match members can propose; unknown matches are 404; login is required', async () => {
      expect(code(await propose('c').expect(403))).toBe('FORBIDDEN');
      expect(code(await propose('a', { matchId: 'nope' }).expect(404))).toBe(
        'MATCH_NOT_FOUND',
      );
      await t.http().post('/v1/sessions').send(proposeBody()).expect(401);
    });

    it('rejects overlapping times with 409 SLOT_TAKEN, including teaching vs learning at the same time', async () => {
      const startsAt = freshStart();
      await propose('a', { startsAt }).expect(201); // a teaches 60 min
      // same role, partly overlapping
      const later = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
      expect(code(await propose('a', { startsAt: later }).expect(409))).toBe(
        'SLOT_TAKEN',
      );
      // DIFFERENT role: b teaches (a would be the learner) at a time a is already teaching
      expect(
        code(
          await propose('b', {
            teacherId: ids.b,
            skillId: spanish,
            startsAt: later,
          }).expect(409),
        ),
      ).toBe('SLOT_TAKEN');
      // back-to-back is fine
      const after = new Date(Date.parse(startsAt) + 60 * 60_000).toISOString();
      await propose('a', { startsAt: after }).expect(201);
    });

    it('a cancelled session frees its time', async () => {
      const startsAt = freshStart();
      const id = body<Session>(await propose('a', { startsAt }).expect(201)).id;
      await post('b', `/v1/sessions/${id}/cancel`).expect(200);
      await propose('a', { startsAt }).expect(201);
    });
  });

  describe('confirming and cancelling', () => {
    it('only the OTHER person confirms; online sessions get a Jitsi link', async () => {
      const id = body<Session>(await propose('a').expect(201)).id;
      expect(
        code(await post('a', `/v1/sessions/${id}/confirm`).expect(403)),
      ).toBe('CANNOT_CONFIRM_OWN_PROPOSAL');
      expect(
        code(await post('c', `/v1/sessions/${id}/confirm`).expect(403)),
      ).toBe('FORBIDDEN');

      const res = await post('b', `/v1/sessions/${id}/confirm`).expect(200);
      expect(body<Session>(res)).toMatchObject({
        status: 'CONFIRMED',
        meetingUrl: `https://meet.jit.si/skillswap-${id}`,
      });
      expect(
        code(await post('b', `/v1/sessions/${id}/confirm`).expect(409)),
      ).toBe('SESSION_NOT_PROPOSED');
      expect(
        code(await post('b', '/v1/sessions/nope/confirm').expect(404)),
      ).toBe('SESSION_NOT_FOUND');
    });

    it('in-person sessions have no meeting link', async () => {
      const id = await newConfirmed({ mode: 'IN_PERSON', location: 'Library' });
      const s = await t.prisma.session.findUniqueOrThrow({ where: { id } });
      expect(s.meetingUrl).toBeNull();
      expect(s.location).toBe('Library');
    });

    it('refuses to confirm when the learner cannot pay', async () => {
      const id = body<Session>(await propose('a').expect(201)).id; // b is the learner
      await setCredits('b', 0);
      expect(
        code(await post('b', `/v1/sessions/${id}/confirm`).expect(409)),
      ).toBe('INSUFFICIENT_CREDITS');
      await setCredits('b', 2);
    });

    it('either person can cancel a proposed or confirmed session, once', async () => {
      const id = await newConfirmed();
      const res = await post('a', `/v1/sessions/${id}/cancel`)
        .send({ reason: 'sick' })
        .expect(200);
      expect(body<Session>(res).status).toBe('CANCELLED');
      expect(
        code(await post('b', `/v1/sessions/${id}/cancel`).expect(409)),
      ).toBe('SESSION_NOT_CANCELLABLE');
      expect(
        code(await post('c', `/v1/sessions/${id}/cancel`).expect(403)),
      ).toBe('FORBIDDEN');
    });
  });

  describe('completing: credits move exactly once', () => {
    beforeEach(async () => {
      await Promise.all([setCredits('a', 2), setCredits('b', 2)]);
    });

    it('cannot complete before it starts, or as an outsider; a proposed session is not completable', async () => {
      const id = await newConfirmed();
      expect(
        code(await post('a', `/v1/sessions/${id}/complete`).expect(409)),
      ).toBe('SESSION_NOT_STARTED');
      await intoThePast(id);
      expect(
        code(await post('c', `/v1/sessions/${id}/complete`).expect(403)),
      ).toBe('FORBIDDEN');

      const proposed = body<Session>(await propose('a').expect(201)).id;
      expect(
        code(await post('a', `/v1/sessions/${proposed}/complete`).expect(409)),
      ).toBe('SESSION_NOT_CONFIRMED');
    });

    it('moves credits from learner to teacher, writes the ledger, counts the session', async () => {
      const id = await newConfirmed(); // a teaches, b learns, 60 min = 1 credit
      await intoThePast(id);
      const res = await post('b', `/v1/sessions/${id}/complete`).expect(200);
      expect(body<Session>(res).status).toBe('COMPLETED');

      expect([await credits('a'), await credits('b')]).toEqual([3, 1]);
      const ledger = await t.prisma.creditTx.findMany({
        where: { sessionId: id },
        orderBy: { amount: 'asc' },
      });
      expect(ledger.map((l) => [l.userId, l.amount, l.reason])).toEqual([
        [ids.b, -1, 'LEARNED_SESSION'],
        [ids.a, 1, 'TAUGHT_SESSION'],
      ]);
      const users = await t.prisma.user.findMany({
        where: { id: { in: [ids.a, ids.b] } },
      });
      expect(users.every((u) => u.sessionsDone >= 1)).toBe(true);
    });

    it('charges by the started hour: 90 minutes costs 2', async () => {
      await setCredits('b', 5);
      const id = await newConfirmed({ durationMin: 90 });
      await intoThePast(id);
      await post('a', `/v1/sessions/${id}/complete`).expect(200);
      expect([await credits('a'), await credits('b')]).toEqual([4, 3]);
    });

    it('two simultaneous "complete" requests settle once, never twice', async () => {
      const id = await newConfirmed();
      await intoThePast(id);
      const [r1, r2] = await Promise.all([
        post('a', `/v1/sessions/${id}/complete`),
        post('b', `/v1/sessions/${id}/complete`),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect([await credits('a'), await credits('b')]).toEqual([3, 1]);
      expect(await t.prisma.creditTx.count({ where: { sessionId: id } })).toBe(
        2,
      );
      expect(
        code(await post('a', `/v1/sessions/${id}/complete`).expect(409)),
      ).toBe('SESSION_NOT_CONFIRMED');
    });

    it('if the learner can no longer pay, nothing changes and the session stays CONFIRMED', async () => {
      const id = await newConfirmed();
      await intoThePast(id);
      await setCredits('b', 0);
      expect(
        code(await post('a', `/v1/sessions/${id}/complete`).expect(409)),
      ).toBe('INSUFFICIENT_CREDITS');
      const s = await t.prisma.session.findUniqueOrThrow({ where: { id } });
      expect(s.status).toBe('CONFIRMED');
      expect([await credits('a'), await credits('b')]).toEqual([2, 0]); // teacher was not paid
      expect(await t.prisma.creditTx.count({ where: { sessionId: id } })).toBe(
        0,
      );
    });

    it('the database itself refuses a negative balance and a duplicate ledger row', async () => {
      await expect(setCredits('a', -1)).rejects.toThrow();
      const id = await newConfirmed();
      await intoThePast(id);
      await post('a', `/v1/sessions/${id}/complete`).expect(200);
      await expect(
        t.prisma.creditTx.create({
          data: {
            userId: ids.a,
            amount: 1,
            reason: 'TAUGHT_SESSION',
            sessionId: id,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('no-show', () => {
    it('can be reported only after a grace period, by one participant, against the other', async () => {
      const id = await newConfirmed();
      expect(
        code(await post('b', `/v1/sessions/${id}/no-show`).expect(409)),
      ).toBe('SESSION_NOT_STARTED');
      await intoThePast(id);
      const before = await t.prisma.user.findUniqueOrThrow({
        where: { id: ids.a },
      });

      const res = await post('b', `/v1/sessions/${id}/no-show`).expect(200); // b says a did not come
      expect(body<Session>(res).status).toBe('NO_SHOW');
      const after = await t.prisma.user.findUniqueOrThrow({
        where: { id: ids.a },
      });
      expect(after.noShowCount).toBe(before.noShowCount + 1);
      expect(after.credits).toBe(before.credits); // no credits move
      expect(
        code(await post('a', `/v1/sessions/${id}/no-show`).expect(409)),
      ).toBe('SESSION_NOT_CONFIRMED');
    });
  });

  describe('reviews', () => {
    let completed: string;

    beforeAll(async () => {
      await Promise.all([setCredits('a', 10), setCredits('b', 10)]);
      completed = await newConfirmed();
      await intoThePast(completed);
      await post('a', `/v1/sessions/${completed}/complete`).expect(200);
    });

    it('needs a completed session, a participant, and a rating from 1 to 5', async () => {
      const open = body<Session>(await propose('a').expect(201)).id;
      expect(
        code(
          await post('a', '/v1/reviews', { sessionId: open, rating: 5 }).expect(
            409,
          ),
        ),
      ).toBe('SESSION_NOT_COMPLETED');
      expect(
        code(
          await post('c', '/v1/reviews', {
            sessionId: completed,
            rating: 5,
          }).expect(403),
        ),
      ).toBe('FORBIDDEN');
      expect(
        code(
          await post('a', '/v1/reviews', {
            sessionId: 'nope',
            rating: 5,
          }).expect(404),
        ),
      ).toBe('SESSION_NOT_FOUND');
      for (const rating of [0, 6, 2.5, '5']) {
        await post('a', '/v1/reviews', { sessionId: completed, rating }).expect(
          422,
        );
      }
      await t
        .http()
        .post('/v1/reviews')
        .send({ sessionId: completed, rating: 5 })
        .expect(401);
    });

    it("updates the other person's rating, once per reviewer", async () => {
      const res = await post('b', '/v1/reviews', {
        sessionId: completed,
        rating: 5,
        comment: '  great teacher  ',
      }).expect(201);
      expect(body<{ rating: number; comment: string }>(res)).toMatchObject({
        rating: 5,
        comment: 'great teacher',
      });
      expect(
        await t.prisma.user.findUniqueOrThrow({ where: { id: ids.a } }),
      ).toMatchObject({ ratingAvg: 5, ratingCount: 1 });

      expect(
        code(
          await post('b', '/v1/reviews', {
            sessionId: completed,
            rating: 1,
          }).expect(409),
        ),
      ).toBe('ALREADY_REVIEWED');
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: ids.a } }))
          .ratingCount,
      ).toBe(1);

      // the teacher rates the learner too; a second session changes the average
      await post('a', '/v1/reviews', {
        sessionId: completed,
        rating: 3,
      }).expect(201);
      const second = await newConfirmed();
      await intoThePast(second);
      await post('a', `/v1/sessions/${second}/complete`).expect(200);
      await post('b', '/v1/reviews', { sessionId: second, rating: 2 }).expect(
        201,
      );
      expect(
        await t.prisma.user.findUniqueOrThrow({ where: { id: ids.a } }),
      ).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 });
    });

    it("shows my own review on the session, and not the other person's", async () => {
      const res = await t
        .http()
        .get('/v1/sessions')
        .query({ scope: 'past' })
        .set('Cookie', cookies.b)
        .expect(200);
      const mine = body<Session[]>(res).find((s) => s.id === completed)!;
      expect(mine.myReview).toMatchObject({ rating: 5 });
    });
  });

  describe('lists, wallet and suggested slots', () => {
    it('splits sessions into upcoming and past', async () => {
      const upcoming = body<Session[]>(
        await t.http().get('/v1/sessions').set('Cookie', cookies.a).expect(200),
      );
      expect(upcoming.length).toBeGreaterThan(0);
      expect(
        upcoming.every((s) => ['PROPOSED', 'CONFIRMED'].includes(s.status)),
      ).toBe(true);
      const times = (
        await t.prisma.session.findMany({
          where: { id: { in: upcoming.map((s) => s.id) } },
        })
      ).map((s) => s.startsAt.getTime());
      const byId = new Map(upcoming.map((s, i) => [s.id, i]));
      const sorted = [...times].sort((x, y) => x - y);
      const inReturnedOrder = (
        await t.prisma.session.findMany({
          where: { id: { in: upcoming.map((s) => s.id) } },
        })
      )
        .sort((x, y) => byId.get(x.id)! - byId.get(y.id)!)
        .map((s) => s.startsAt.getTime());
      expect(inReturnedOrder).toEqual(sorted); // soonest first

      const past = body<Session[]>(
        await t
          .http()
          .get('/v1/sessions')
          .query({ scope: 'past' })
          .set('Cookie', cookies.a)
          .expect(200),
      );
      expect(past.some((s) => s.status === 'COMPLETED')).toBe(true);
      expect(past.some((s) => s.status === 'CANCELLED')).toBe(true);
      await t
        .http()
        .get('/v1/sessions')
        .query({ scope: 'future' })
        .set('Cookie', cookies.a)
        .expect(422);
    });

    it('wallet shows the balance and the ledger, newest first, in pages', async () => {
      const first = body<{
        balance: number;
        ledger: { items: { amount: number }[]; nextCursor: string | null };
      }>(
        await t
          .http()
          .get('/v1/wallet')
          .query({ limit: 2 })
          .set('Cookie', cookies.a)
          .expect(200),
      );
      expect(first.balance).toBe(await credits('a'));
      expect(first.ledger.items).toHaveLength(2);
      expect(first.ledger.nextCursor).not.toBeNull();
      const next = body<typeof first>(
        await t
          .http()
          .get('/v1/wallet')
          .query({ limit: 2, cursor: first.ledger.nextCursor! })
          .set('Cookie', cookies.a)
          .expect(200),
      );
      expect(next.ledger.items.length).toBeGreaterThan(0);
      await t.http().get('/v1/wallet').expect(401);
    });

    it('suggests times both people are free, and stops suggesting a time once it is booked', async () => {
      const res = await t
        .http()
        .get(`/v1/matches/${matchAB}/slots`)
        .query({ days: 14, durationMin: 60 })
        .set('Cookie', cookies.a)
        .expect(200);
      const slots = body<{ startsAt: string; endsAt: string }[]>(res);
      expect(slots.length).toBeGreaterThan(0);

      // both users are in Asia/Kolkata, free Mon 18:00-20:00 and Sat 10:00-12:00 local time
      const local = (iso: string) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(iso));
      for (const s of slots) {
        expect(local(s.startsAt)).toMatch(
          /^(Mon (18|19):\d\d|Sat (10|11):\d\d)$/,
        );
        expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(60 * 60_000);
        expect(Date.parse(s.startsAt)).toBeGreaterThan(
          Date.now() + 59 * 60_000,
        ); // at least an hour ahead
      }

      const booked = slots[0];
      await propose('a', { startsAt: booked.startsAt }).expect(201);
      const again = body<typeof slots>(
        await t
          .http()
          .get(`/v1/matches/${matchAB}/slots`)
          .query({ days: 14, durationMin: 60 })
          .set('Cookie', cookies.b)
          .expect(200),
      );
      expect(
        again.find(
          (s) =>
            Date.parse(s.startsAt) < Date.parse(booked.endsAt) &&
            Date.parse(s.endsAt) > Date.parse(booked.startsAt),
        ),
      ).toBeUndefined();
    });

    it('guards the slots endpoint', async () => {
      await t
        .http()
        .get(`/v1/matches/${matchAB}/slots`)
        .set('Cookie', cookies.c)
        .expect(403);
      await t
        .http()
        .get('/v1/matches/nope/slots')
        .set('Cookie', cookies.a)
        .expect(404);
      await t
        .http()
        .get(`/v1/matches/${matchAB}/slots`)
        .query({ days: 0 })
        .set('Cookie', cookies.a)
        .expect(422);
      await t.http().get(`/v1/matches/${matchAB}/slots`).expect(401);
    });
  });

  describe('cron jobs are idempotent', () => {
    const insert = (startsAt: Date, over: Record<string, unknown> = {}) =>
      t.prisma.session.create({
        data: {
          matchId: matchAB,
          teacherId: ids.a,
          learnerId: ids.b,
          skillId: python,
          startsAt,
          durationMin: 30,
          mode: 'ONLINE',
          status: 'CONFIRMED',
          ...over,
        },
      });

    it('reminds once about a confirmed session starting within the hour, and ignores the rest', async () => {
      const sessions = t.app.get(SessionsService);
      const now = new Date('2032-03-01T10:00:00Z');
      const soon = await insert(new Date(now.getTime() + 20 * 60_000));
      const far = await insert(new Date(now.getTime() + 5 * HOUR));
      const unconfirmed = await insert(new Date(now.getTime() + 3 * HOUR), {
        status: 'PROPOSED',
      });

      expect(await sessions.sendReminders(now)).toBe(1);
      expect(await sessions.sendReminders(now)).toBe(0); // running it again does nothing
      const rows = await t.prisma.session.findMany({
        where: { id: { in: [soon.id, far.id, unconfirmed.id] } },
      });
      const sent = Object.fromEntries(
        rows.map((r) => [r.id, r.reminderSentAt !== null]),
      );
      expect(sent).toEqual({
        [soon.id]: true,
        [far.id]: false,
        [unconfirmed.id]: false,
      });
    });

    it('prompts once about a confirmed session that ended long ago and was never resolved', async () => {
      const sessions = t.app.get(SessionsService);
      const now = new Date('2032-04-01T10:00:00Z');
      const stale = await insert(new Date(now.getTime() - 3 * HOUR)); // ended 2.5 h ago
      const recent = await insert(new Date(now.getTime() - 40 * 60_000)); // ended 10 min ago

      // Other old confirmed sessions in this shared dev DB may qualify too, so only
      // check what is certain: at least ours, and a second run finds nothing new.
      expect(await sessions.promptUnresolved(now)).toBeGreaterThanOrEqual(1);
      expect(await sessions.promptUnresolved(now)).toBe(0);
      const rows = await t.prisma.session.findMany({
        where: { id: { in: [stale.id, recent.id] } },
      });
      expect(
        rows.find((r) => r.id === stale.id)?.resolutionPromptSentAt,
      ).not.toBeNull();
      expect(
        rows.find((r) => r.id === recent.id)?.resolutionPromptSentAt,
      ).toBeNull();
    });
  });

  describe('live updates', () => {
    function connect(as: string): Promise<Socket> {
      return t.socketToken(cookies[as]).then(
        (token) =>
          new Promise((resolve, reject) => {
            const socket = io(t.baseUrl, {
              auth: { token },
              transports: ['websocket'],
              reconnection: false,
              forceNew: true,
            });
            socket.once('connect', () => resolve(socket));
            socket.once('connect_error', reject);
          }),
      );
    }
    const next = (s: Socket, ms = 3000) =>
      new Promise<Session>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no session:update')),
          ms,
        );
        s.once('session:update', (p: Session) => {
          clearTimeout(timer);
          resolve(p);
        });
      });

    it('pushes session:update to both people when a session is proposed and confirmed', async () => {
      const [sa, sb] = [await connect('a'), await connect('b')];
      try {
        const [pa, pb] = [next(sa), next(sb)];
        const id = body<Session>(await propose('a').expect(201)).id;
        for (const p of await Promise.all([pa, pb]))
          expect(p).toMatchObject({ id, status: 'PROPOSED' });

        const [ca, cb] = [next(sa), next(sb)];
        await post('b', `/v1/sessions/${id}/confirm`).expect(200);
        for (const p of await Promise.all([ca, cb])) {
          expect(p).toMatchObject({
            id,
            status: 'CONFIRMED',
            meetingUrl: `https://meet.jit.si/skillswap-${id}`,
          });
        }
      } finally {
        sa.close();
        sb.close();
      }
    });
  });
});
