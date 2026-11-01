/**
 * Showcase data: 20 accounts that exercise every screen. Adds to the dev database
 * (nothing is deleted) and can be run again safely.
 *
 *   pnpm seed:showcase      (the API must be running on API_URL, default :4000)
 *
 * Accounts are created with Prisma. Everything that has rules (swipes, matches,
 * chat, sessions, credits, chains) goes through the real API, so the data is
 * exactly what the app itself would have produced.
 *
 * Every account: <username>@skillswap.dev, password "password123".
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { io } from 'socket.io-client';
import { hashPassword } from '../src/common/utils/password';
import { Mode, Priority, PrismaClient } from '../src/generated/prisma/client';

const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'password123';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Person {
  username: string;
  name: string;
  bio: string;
  haves: string[];
  wants: string[];
  onboarded?: boolean;
}

const PEOPLE: Person[] = [
  // ── Persona with a full history: matches, chat, sessions in every state ──
  { username: 'priya', name: 'Priya Sethi', bio: 'Front-end developer. Wants to sing, meditate and get fit.', haves: ['JavaScript'], wants: ['Singing', 'Meditation', 'Home Workout'] },
  { username: 'kunal', name: 'Kunal Arora', bio: 'Plays in a band. Wants to build websites.', haves: ['Singing'], wants: ['JavaScript'] },
  { username: 'tanvi', name: 'Tanvi Sood', bio: 'Meditation teacher who wants to code.', haves: ['Meditation'], wants: ['JavaScript'] },
  { username: 'yash', name: 'Yash Bhatt', bio: 'Fitness trainer curious about JavaScript.', haves: ['Home Workout'], wants: ['JavaScript'] },
  { username: 'ayesha', name: 'Ayesha Rizvi', bio: 'Vocal coach. Wants to learn JavaScript.', haves: ['Singing'], wants: ['JavaScript'] },

  // ── Swap chain A (3 people): maya -> rahul -> sana -> maya ──
  { username: 'maya', name: 'Maya Iyer', bio: 'Pianist who dreams of a garden.', haves: ['Piano'], wants: ['Gardening'] },
  { username: 'rahul', name: 'Rahul Verma', bio: 'Speaks French, wants to play the piano.', haves: ['French'], wants: ['Piano'] },
  { username: 'sana', name: 'Sana Qureshi', bio: 'Gardener who wants to speak French.', haves: ['Gardening'], wants: ['French'] },

  // ── Swap chain B (3 people): karan -> nisha -> vikram -> karan (skills nobody else wants) ──
  { username: 'karan', name: 'Karan Malhotra', bio: 'Dance teacher who wants to start running.', haves: ['Dance'], wants: ['Running'] },
  { username: 'nisha', name: 'Nisha Kapoor', bio: 'Illustrator who wants to learn dancing.', haves: ['Drawing'], wants: ['Dance'] },
  { username: 'vikram', name: 'Vikram Rao', bio: 'Runner who wants to learn to draw.', haves: ['Running'], wants: ['Drawing'] },

  // ── Swap chain C (4 people): zoya -> arnav -> leela -> tejas -> zoya ──
  { username: 'zoya', name: 'Zoya Khan', bio: 'Database engineer who wants better design skills.', haves: ['SQL'], wants: ['Graphic Design'] },
  { username: 'arnav', name: 'Arnav Das', bio: 'Marathon runner learning SQL.', haves: ['Running'], wants: ['SQL'] },
  { username: 'leela', name: 'Leela Menon', bio: 'Investor who wants to run.', haves: ['Stock Market Basics'], wants: ['Running'] },
  { username: 'tejas', name: 'Tejas Naik', bio: 'Designer curious about investing.', haves: ['Graphic Design'], wants: ['Stock Market Basics'] },

  // ── Direct swap pairs with no history yet: swipe, match and chat live ──
  { username: 'ishita', name: 'Ishita Bose', bio: 'Painter who wants to play chess.', haves: ['Painting'], wants: ['Chess'] },
  { username: 'jonas', name: 'Jonas Pinto', bio: 'Chess player who wants to paint.', haves: ['Chess'], wants: ['Painting'] },
  { username: 'omkar', name: 'Omkar Patil', bio: 'Back-end developer who wants to speak with confidence.', haves: ['Node.js'], wants: ['Public Speaking'] },
  { username: 'reva', name: 'Reva Nair', bio: 'Speaker and coach who wants to code.', haves: ['Public Speaking'], wants: ['Node.js'] },

  // ── A brand new account: log in to walk through onboarding ──
  { username: 'newbie', name: 'Nina Newcomer', bio: '', haves: [], wants: [], onboarded: false },
];

// Evenings every day plus weekend mornings, so shared free times always exist.
const WINDOWS = [
  ...[0, 1, 2, 3, 4, 5, 6].map((day) => ({ dayOfWeek: day, startMin: 18 * 60, endMin: 21 * 60 })),
  ...[0, 6].map((day) => ({ dayOfWeek: day, startMin: 10 * 60, endMin: 13 * 60 })),
];

const emailOf = (username: string) => `${username}@skillswap.dev`;

// ── people ────────────────────────────────────────────────

async function createPeople(): Promise<number> {
  const skills = new Map((await prisma.skill.findMany()).map((s) => [s.name, s.id]));
  const idOf = (name: string): string => {
    const id = skills.get(name);
    if (!id) throw new Error(`Skill "${name}" is not in the database. Run the base seed first.`);
    return id;
  };
  const passwordHash = await hashPassword(PASSWORD);
  let created = 0;

  for (const p of PEOPLE) {
    const exists = await prisma.user.findUnique({ where: { email: emailOf(p.username) } });
    if (exists) continue;
    const onboarded = p.onboarded !== false;
    await prisma.user.create({
      data: {
        email: emailOf(p.username),
        username: p.username,
        name: p.name,
        bio: p.bio || null,
        passwordHash,
        city: onboarded ? 'Dehradun' : null,
        lat: onboarded ? 30.3165 : null,
        lng: onboarded ? 78.0322 : null,
        mode: Mode.BOTH,
        languages: onboarded ? ['English', 'Hindi'] : [],
        timezone: 'Asia/Kolkata',
        onboarded,
        credits: 4,
        ledger: { create: { amount: 4, reason: 'SIGNUP_BONUS' } },
        haves: { create: p.haves.map((s) => ({ skillId: idOf(s), level: 4, years: 3 })) },
        wants: {
          create: p.wants.map((s) => ({
            skillId: idOf(s),
            currentLevel: 1,
            goalLevel: 3,
            priority: Priority.HIGH,
          })),
        },
        slots: onboarded ? { create: WINDOWS } : undefined,
      },
    });
    created++;
  }
  return created;
}

// ── talking to the real API ───────────────────────────────

interface Client {
  username: string;
  id: string;
  cookie: string;
  call: <T = unknown>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

async function login(username: string): Promise<Client> {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailOf(username), password: PASSWORD }),
  });
  if (res.status !== 204) throw new Error(`Login failed for ${username} (${res.status}). Is the API running?`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call: Client['call'] = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : undefined) as never };
  };
  const me = await call<{ id: string }>('GET', '/v1/me');
  return { username, id: me.body.id, cookie, call };
}

function must(label: string, r: { status: number; body: unknown }, ok: number[] = [200, 201, 204]) {
  if (!ok.includes(r.status)) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Opens a socket as this person, joins the match room and sends the given messages. */
async function chat(who: Client, matchId: string, lines: string[]) {
  const token = (await who.call<{ token: string }>('GET', '/v1/auth/socket-token')).body.token;
  const socket = io(API, { transports: ['websocket'], auth: { token } });
  await new Promise<void>((ok, no) => {
    socket.on('connect', ok);
    socket.on('connect_error', no);
  });
  await new Promise((ok) => socket.emit('match:join', { matchId }, ok));
  for (const body of lines) {
    const ack = await new Promise<{ ok: boolean }>((ok) =>
      socket.emit('chat:send', { matchId, body, clientId: crypto.randomUUID() }, ok),
    );
    if (!ack.ok) throw new Error(`chat:send failed for ${who.username}`);
  }
  socket.close();
}

async function matchUp(a: Client, b: Client): Promise<string> {
  await a.call('POST', '/v1/swipes', { targetId: b.id, action: 'LIKE' });
  const r = await b.call<{ matched: boolean; matchId?: string }>('POST', '/v1/swipes', { targetId: a.id, action: 'LIKE' });
  if (r.status === 200 && r.body.matchId) return r.body.matchId;
  // Already swiped on an earlier run: look the match up instead.
  const list = await a.call<{ items: { id: string; otherUser: { id: string } }[] }>('GET', '/v1/matches?limit=50');
  const found = list.body.items.find((m) => m.otherUser.id === b.id);
  if (!found) throw new Error(`No match between ${a.username} and ${b.username}`);
  return found.id;
}

interface Slot { startsAt: string }
async function slotsFor(c: Client, matchId: string): Promise<string[]> {
  const r = await c.call<Slot[]>('GET', `/v1/matches/${matchId}/slots?days=14&durationMin=60`);
  return r.body.map((s) => s.startsAt);
}

async function propose(
  by: Client,
  matchId: string,
  skillId: string,
  teacherId: string,
  startsAt: string,
): Promise<string> {
  const r = await by.call<{ id: string }>('POST', '/v1/sessions', {
    matchId,
    skillId,
    teacherId,
    startsAt,
    durationMin: 60,
    mode: 'ONLINE',
  });
  must('propose session', r);
  return r.body.id;
}

async function interactions() {
  const [priya, kunal, tanvi, yash] = await Promise.all(['priya', 'kunal', 'tanvi', 'yash'].map(login));
  const existing = await priya.call<unknown[]>('GET', '/v1/sessions?scope=upcoming');
  if (existing.body.length > 0) {
    console.log('Priya already has sessions: skipping matches, chat and sessions.');
    return;
  }
  const skillId = async (name: string) => (await prisma.skill.findFirstOrThrow({ where: { name } })).id;
  const js = await skillId('JavaScript');
  const singing = await skillId('Singing');
  const meditation = await skillId('Meditation');
  const workout = await skillId('Home Workout');

  // Matches (mutual likes through the real swipe rules).
  const mKunal = await matchUp(priya, kunal);
  const mTanvi = await matchUp(priya, tanvi);
  const mYash = await matchUp(priya, yash);

  // Chat. The last message in each is from the other person, so Priya has unread messages.
  await chat(kunal, mKunal, ['Hey Priya! Ready to swap JavaScript for singing lessons?']);
  await chat(priya, mKunal, ['Yes! I booked a time for us, please check it.']);
  await chat(kunal, mKunal, ['Looks great, see you then 🎤']);
  await chat(tanvi, mTanvi, ['Hi! I would love to teach you meditation.', 'I proposed a session. Tell me if the time works.']);
  await chat(yash, mYash, ['Thanks for the lesson on Home Workout plans!']);

  // Sessions in every state, from Priya's point of view.
  const slotsKunal = await slotsFor(priya, mKunal);
  const slotsTanvi = await slotsFor(priya, mTanvi);
  const slotsYash = await slotsFor(priya, mYash);

  // 1. CONFIRMED and upcoming: Kunal learns JavaScript from Priya; Priya confirms... no: the
  //    OTHER person confirms, so Kunal proposes and Priya confirms.
  const confirmed = await propose(kunal, mKunal, js, priya.id, slotsKunal[2]);
  must('confirm', await priya.call('POST', `/v1/sessions/${confirmed}/confirm`));
  // 2. PROPOSED by Priya, waiting for Kunal (she can withdraw it).
  await propose(priya, mKunal, singing, kunal.id, slotsKunal[6]);
  // 3. PROPOSED by Tanvi, waiting for Priya to confirm.
  await propose(tanvi, mTanvi, meditation, tanvi.id, slotsTanvi[4]);
  // 4. COMPLETED in the past, Yash already reviewed Priya, Priya's review is still pending.
  const done = await propose(priya, mYash, workout, yash.id, slotsYash[9]);
  must('confirm', await yash.call('POST', `/v1/sessions/${done}/confirm`));
  await prisma.$executeRaw`UPDATE sessions SET starts_at = now() - interval '3 days' WHERE id = ${done}`;
  must('complete', await priya.call('POST', `/v1/sessions/${done}/complete`));
  must('review', await yash.call('POST', '/v1/reviews', { sessionId: done, rating: 5, comment: 'Great student, very quick learner!' }));
  console.log('Matches, chat and sessions created for priya.');
}

async function chains() {
  console.log('Looking for swap chains...');
  execSync('pnpm chains:find', { stdio: 'inherit' });

  // Chain C: everybody says yes, so it shows as ACCEPTED (the glowing loop).
  for (const username of ['zoya', 'arnav', 'leela', 'tejas']) {
    const c = await login(username);
    const list = await c.call<{ id: string; members: { user: { id: string }; accepted: boolean | null }[] }[]>('GET', '/v1/chains');
    for (const chain of list.body) {
      const mine = chain.members.find((m) => m.user.id === c.id);
      if (mine?.accepted === null) await c.call('POST', `/v1/chains/${chain.id}/respond`, { accept: true });
    }
  }
  // Chain A: Rahul already said yes; Maya and Sana still have to answer.
  const rahul = await login('rahul');
  const list = await rahul.call<{ id: string; members: { user: { id: string }; accepted: boolean | null }[] }[]>('GET', '/v1/chains');
  for (const chain of list.body) {
    const mine = chain.members.find((m) => m.user.id === rahul.id);
    if (mine?.accepted === null) await rahul.call('POST', `/v1/chains/${chain.id}/respond`, { accept: true });
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed showcase data in production.');
  const created = await createPeople();
  console.log(`Showcase accounts: ${created} created, ${PEOPLE.length - created} already existed.`);
  await interactions();
  await chains();
  console.log(`Done. Log in with <username>@skillswap.dev / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
