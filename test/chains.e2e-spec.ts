import { io, type Socket } from 'socket.io-client';
import { findUsersWithoutMatches } from '../src/chains/chains.queries';
import { ChainsService } from '../src/chains/chains.service';
import {
  body,
  createTestApp,
  makeUser,
  type ApiErrorBody,
  type TestApp,
} from './helpers';

interface Chain {
  id: string;
  status: string;
  score: number;
  expiresAt: string;
  members: {
    position: number;
    user: { username: string };
    teachSkill: { slug: string };
    accepted: boolean | null;
  }[];
}

const HOUR = 3_600_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Swap chains (e2e)', () => {
  let t: TestApp;
  let chains: ChainsService;
  const tag = `cn${Date.now()}`;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const skills: Record<string, string> = {};
  const key = (n: string) => `${tag}-${n}`;
  const code = (res: Parameters<typeof body>[0]) =>
    body<ApiErrorBody>(res).error.code;

  const skill = async (n: string) => {
    skills[n] = (
      await t.prisma.skill.create({
        data: { name: key(n), slug: key(n), category: 'Test' },
      })
    ).id;
  };
  const person = async (
    n: string,
    teaches: string,
    wants: string,
    over: {
      level?: number;
      languages?: string[];
      onboarded?: boolean;
      extraHave?: string;
    } = {},
  ) => {
    const haves = [{ skillId: skills[teaches], level: over.level ?? 4 }];
    if (over.extraHave)
      haves.push({ skillId: skills[over.extraHave], level: 4 });
    ids[n] = (
      await makeUser(t.prisma, key(n), {
        haves,
        wants: [{ skillId: skills[wants] }],
        languages: over.languages,
        onboarded: over.onboarded,
      })
    ).id;
    cookies[n] = await t.login(`${key(n)}@test.dev`);
  };
  /** Makes a valid loop: a teaches `sx` to b, b teaches `sy` to c, c teaches `sz` to a. */
  async function loop(
    a: string,
    b: string,
    c: string,
    tagOf: string,
    over: Record<string, Parameters<typeof person>[3]> = {},
  ) {
    const [sx, sy, sz] = [`${tagOf}x`, `${tagOf}y`, `${tagOf}z`];
    await Promise.all([sx, sy, sz].map(skill));
    await person(a, sx, sz, over[a]);
    await person(b, sy, sx, over[b]);
    await person(c, sz, sy, over[c]);
  }
  const chainsOf = (userId: string) =>
    t.prisma.swapChain.findMany({
      where: { members: { some: { userId } } },
      include: { members: true },
    });
  const respond = (as: string, chainId: string, payload: unknown) =>
    t
      .http()
      .post(`/v1/chains/${chainId}/respond`)
      .set('Cookie', cookies[as])
      .send(payload as object);

  beforeAll(async () => {
    t = await createTestApp();
    chains = t.app.get(ChainsService);
    await loop('a', 'b', 'c', 'g1'); // the valid loop: a -x-> b -y-> c -z-> a
    await person('outsider', 'g1x', 'g1y'); // unrelated
  });

  afterAll(async () => {
    try {
      await t.prisma.swapChain.deleteMany({
        where: {
          members: { some: { user: { email: { startsWith: `${tag}-` } } } },
        },
      });
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
      await t.close();
    }
  });

  describe('finding loops', () => {
    it('proposes one chain for a valid loop, with who teaches what to whom', async () => {
      const created = await chains.findForUser(ids.a);
      expect(created).toHaveLength(1);

      const [chain] = await t.prisma.swapChain.findMany({
        where: { id: created[0] },
        include: { members: { orderBy: { position: 'asc' } } },
      });
      expect(chain.status).toBe('PROPOSED');
      expect(chain.score).toBeGreaterThan(0);
      expect(chain.score).toBeLessThanOrEqual(100);
      expect(
        Math.abs(chain.expiresAt.getTime() - (Date.now() + 48 * HOUR)),
      ).toBeLessThan(60_000);
      expect(chain.members.map((m) => m.position)).toEqual([0, 1, 2]);
      expect(chain.members.every((m) => m.accepted === null)).toBe(true);
      // member i teaches the NEXT member; check the whole ring
      const byUser = new Map(chain.members.map((m) => [m.userId, m]));
      expect(byUser.get(ids.a)!.teachSkillId).toBe(skills.g1x);
      expect(byUser.get(ids.b)!.teachSkillId).toBe(skills.g1y);
      expect(byUser.get(ids.c)!.teachSkillId).toBe(skills.g1z);
      expect(chain.members[0].userId).toBe([ids.a, ids.b, ids.c].sort()[0]); // canonical start
    });

    it('does not propose the same loop again, whichever member it is found from', async () => {
      expect(await chains.findForUser(ids.a)).toHaveLength(0);
      expect(await chains.findForUser(ids.b)).toHaveLength(0);
      expect(await chains.findForUser(ids.c)).toHaveLength(0);
      expect(await chainsOf(ids.a)).toHaveLength(1);
    });

    it('lists the chain for each member, and an empty list for anyone else', async () => {
      for (const n of ['a', 'b', 'c']) {
        const list = body<Chain[]>(
          await t
            .http()
            .get('/v1/chains')
            .set('Cookie', cookies[n])
            .expect(200),
        );
        expect(list).toHaveLength(1);
        expect(list[0].members).toHaveLength(3);
        expect(list[0].members.every((m) => m.accepted === null)).toBe(true);
        for (const m of list[0].members)
          expect(m.user).not.toHaveProperty('email');
      }
      expect(
        body<Chain[]>(
          await t
            .http()
            .get('/v1/chains')
            .set('Cookie', cookies.outsider)
            .expect(200),
        ),
      ).toEqual([]);
      await t.http().get('/v1/chains').expect(401);
    });

    // Each case: what is wrong, the group's name, the override that breaks it, and how to repair it.
    // After the skip is checked, the repair is applied and the SAME loop must now be proposed:
    // that proves the rule under test was the only thing in the way.
    it.each([
      [
        'two people share no language',
        'lang',
        { c: { languages: ['Tamil'] } },
        (id: string) =>
          t.prisma.user.update({
            where: { id },
            data: { languages: ['English'] },
          }),
        'c',
      ],
      [
        'a member has not finished onboarding',
        'onb',
        { b: { onboarded: false } },
        (id: string) =>
          t.prisma.user.update({ where: { id }, data: { onboarded: true } }),
        'b',
      ],
      [
        "a teacher is not above the learner's level",
        'lvl',
        { b: { level: 1 } },
        (id: string) =>
          t.prisma.userSkillHave.updateMany({
            where: { userId: id },
            data: { level: 4 },
          }),
        'b',
      ],
    ])(
      'skips a loop when %s (and proposes it once repaired)',
      async (_why, tagOf, over, repair, who) => {
        const [a, b, c] = [`${tagOf}-a`, `${tagOf}-b`, `${tagOf}-c`];
        // the cases say "b" or "c"; people are created as "<group>-b", "<group>-c"
        const overrides = Object.fromEntries(
          Object.entries(over).map(([w, o]) => [`${tagOf}-${w}`, o]),
        );
        await loop(a, b, c, tagOf, overrides);
        expect(await chains.findForUser(ids[a])).toHaveLength(0);

        await repair(ids[`${tagOf}-${who}`]);
        expect(await chains.findForUser(ids[a])).toHaveLength(1);
      },
    );

    it('skips a loop when two people have blocked each other', async () => {
      await loop('blk-a', 'blk-b', 'blk-c', 'blk');
      await t.prisma.block.create({
        data: { blockerId: ids['blk-a'], blockedId: ids['blk-c'] },
      });
      expect(await chains.findForUser(ids['blk-a'])).toHaveLength(0);

      await t.prisma.block.deleteMany({ where: { blockerId: ids['blk-a'] } });
      expect(await chains.findForUser(ids['blk-a'])).toHaveLength(1); // the block was the only obstacle
    });

    it('skips a loop when two members could simply swap with each other', async () => {
      // dz-b also teaches z, which dz-a wants, and dz-a teaches what dz-b wants: a direct swap
      const [sx, sy, sz] = ['dzx', 'dzy', 'dzz'];
      await Promise.all([sx, sy, sz].map(skill));
      await person('dz-a', sx, sz);
      await person('dz-b', sy, sx, { extraHave: sz });
      await person('dz-c', sz, sy);
      expect(await chains.findForUser(ids['dz-a'])).toHaveLength(0);

      // take away the extra skill: no direct swap any more, so the chain is worth proposing
      await t.prisma.userSkillHave.deleteMany({
        where: { userId: ids['dz-b'], skillId: skills.dzz },
      });
      expect(await chains.findForUser(ids['dz-a'])).toHaveLength(1);
    });

    it('does not pile a second proposal onto someone who is already deciding on one', async () => {
      // a is in an open chain (g1). A new loop through a, with e and f, must wait.
      await Promise.all(['nwx', 'nwy', 'nwz2'].map(skill));
      await person('nw-e', 'nwy', 'g1x'); // wants what a teaches
      await person('nw-f', 'g1z', 'nwy'); // teaches what a wants, wants what e teaches
      expect(await chains.findForUser(ids.a)).toHaveLength(0);
    });

    it('the cron picks people with no active match and no open proposal', async () => {
      const eligible = await findUsersWithoutMatches(t.prisma, 100_000);
      expect(eligible).toContain(ids.outsider); // onboarded, no match, no chain
      expect(eligible).not.toContain(ids.a); // already in an open chain
      expect(eligible).not.toContain(ids['onb-b']); // not onboarded
    });
  });

  describe('responding', () => {
    let chainId: string;
    beforeAll(async () => {
      chainId = (await chainsOf(ids.a))[0].id;
    });

    it('guards who may answer, and what', async () => {
      expect(
        code(await respond('outsider', chainId, { accept: true }).expect(403)),
      ).toBe('FORBIDDEN');
      expect(
        code(await respond('a', 'nope', { accept: true }).expect(404)),
      ).toBe('CHAIN_NOT_FOUND');
      await respond('a', chainId, { accept: 'yes' }).expect(422);
      await respond('a', chainId, {}).expect(422);
      await t
        .http()
        .post(`/v1/chains/${chainId}/respond`)
        .send({ accept: true })
        .expect(401);
    });

    it('one accept does not complete the chain, and you cannot answer twice', async () => {
      const res = await respond('a', chainId, { accept: true }).expect(200);
      const chain = body<Chain>(res);
      expect(chain.status).toBe('PROPOSED');
      expect(chain.members.map((m) => m.accepted).sort()).toEqual([
        null,
        null,
        true,
      ]);
      expect(
        code(await respond('a', chainId, { accept: false }).expect(409)),
      ).toBe('ALREADY_RESPONDED');
    });

    it('when the last two accept at the same instant it becomes ACCEPTED once, with chats and first sessions', async () => {
      const [rb, rc] = await Promise.all([
        respond('b', chainId, { accept: true }),
        respond('c', chainId, { accept: true }),
      ]);
      expect([rb.status, rc.status]).toEqual([200, 200]);
      expect(
        (await t.prisma.swapChain.findUniqueOrThrow({ where: { id: chainId } }))
          .status,
      ).toBe('ACCEPTED');

      // each neighbouring pair got ONE chat of type CHAIN
      const members = [ids.a, ids.b, ids.c];
      const matches = await t.prisma.match.findMany({
        where: { userAId: { in: members }, userBId: { in: members } },
      });
      expect(matches).toHaveLength(3);
      expect(
        matches.every((m) => m.type === 'CHAIN' && m.status === 'ACTIVE'),
      ).toBe(true);

      // ...and the teacher of each pair proposed their earliest common time, one after another
      const sessions = await t.prisma.session.findMany({
        where: { teacherId: { in: members } },
        orderBy: { startsAt: 'asc' },
      });
      expect(sessions).toHaveLength(3);
      const teaches = new Map(sessions.map((s) => [s.teacherId, s]));
      expect(teaches.get(ids.a)).toMatchObject({
        learnerId: ids.b,
        skillId: skills.g1x,
        status: 'PROPOSED',
        proposedById: ids.a,
      });
      expect(teaches.get(ids.b)).toMatchObject({
        learnerId: ids.c,
        skillId: skills.g1y,
      });
      expect(teaches.get(ids.c)).toMatchObject({
        learnerId: ids.a,
        skillId: skills.g1z,
      });
      expect(new Set(sessions.map((s) => s.startsAt.getTime())).size).toBe(3); // nobody double-booked

      expect(
        code(await respond('b', chainId, { accept: true }).expect(409)),
      ).toBe('CHAIN_NOT_PROPOSED');
    });
  });

  describe('declining and expiring', () => {
    it('one decline rejects the chain for everyone', async () => {
      await loop('d-a', 'd-b', 'd-c', 'dcl');
      const [id] = await chains.findForUser(ids['d-a']);
      await respond('d-b', id, { accept: true }).expect(200);
      const res = await respond('d-c', id, { accept: false }).expect(200);
      expect(body<Chain>(res).status).toBe('REJECTED');
      expect(code(await respond('d-a', id, { accept: true }).expect(409))).toBe(
        'CHAIN_NOT_PROPOSED',
      );
      expect(
        await t.prisma.match.count({
          where: { userAId: { in: [ids['d-a'], ids['d-b'], ids['d-c']] } },
        }),
      ).toBe(0);
    });

    it('answers after the deadline are refused, and the cron then marks the chain EXPIRED', async () => {
      await loop('x-a', 'x-b', 'x-c', 'exp');
      const [id] = await chains.findForUser(ids['x-a']);
      await t.prisma.swapChain.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(code(await respond('x-a', id, { accept: true }).expect(409))).toBe(
        'CHAIN_EXPIRED',
      );
      expect(await chains.expireOverdue()).toBeGreaterThanOrEqual(1);
      expect(await chains.expireOverdue()).toBe(0); // running it again does nothing
      expect(
        (await t.prisma.swapChain.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('EXPIRED');
      expect(code(await respond('x-a', id, { accept: true }).expect(409))).toBe(
        'CHAIN_NOT_PROPOSED',
      );
    });
  });

  describe('live updates', () => {
    const connect = async (as: string): Promise<Socket> => {
      const token = await t.socketToken(cookies[as]);
      return new Promise((resolve, reject) => {
        const s = io(t.baseUrl, {
          auth: { token },
          transports: ['websocket'],
          reconnection: false,
          forceNew: true,
        });
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      });
    };
    const next = <T>(s: Socket, name: string, ms = 3000) =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${name}`)), ms);
        s.once(name, (p: T) => {
          clearTimeout(timer);
          resolve(p);
        });
      });

    it('pushes chain:proposed to every member when found, and chain:update when someone answers', async () => {
      await loop('s-a', 's-b', 's-c', 'sck');
      await person('s-bystander', 'sckx', 'sckz');
      const [sa, sb, sc, bystander] = await Promise.all(
        ['s-a', 's-b', 's-c', 's-bystander'].map(connect),
      );
      try {
        const proposed = ['s-a', 's-b', 's-c'].map((_, i) =>
          next<Chain>([sa, sb, sc][i], 'chain:proposed'),
        );
        const quiet = Promise.race([
          next(bystander, 'chain:proposed', 500).then(
            () => 'got one',
            () => 'quiet', // no event within 500 ms is what we want
          ),
          wait(600).then(() => 'quiet'),
        ]);
        const [id] = await chains.findForUser(ids['s-a']);

        for (const chain of await Promise.all(proposed)) {
          expect(chain).toMatchObject({ id, status: 'PROPOSED' });
          expect(chain.members).toHaveLength(3);
        }
        expect(await quiet).toBe('quiet');

        const updates = [sa, sb, sc].map((s) => next<Chain>(s, 'chain:update'));
        await respond('s-a', id, { accept: true }).expect(200);
        for (const chain of await Promise.all(updates)) {
          expect(chain.members.filter((m) => m.accepted === true)).toHaveLength(
            1,
          );
        }
      } finally {
        [sa, sb, sc, bystander].forEach((s) => s.close());
      }
    });
  });
});
