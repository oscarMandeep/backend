import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Mode, Priority, PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/common/utils/password';
import { slugify } from '../src/common/utils/slugify';
import { SKILLS } from './skills-data';

/** Every seeded account can log in with this (development only). */
export const SEED_PASSWORD = 'password123';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ── helpers ───────────────────────────────────────────────

/** Small deterministic RNG so every seed run produces the same data. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

function pickDistinct<T>(arr: readonly T[], n: number, exclude: readonly T[] = []): T[] {
  const pool = arr.filter((x) => !exclude.includes(x));
  const out: T[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}



// ── skills ────────────────────────────────────────────────


// ── users ─────────────────────────────────────────────────

const CITIES = [
  { city: 'Haridwar', lat: 29.9457, lng: 78.1642 },
  { city: 'Dehradun', lat: 30.3165, lng: 78.0322 },
  { city: 'Delhi', lat: 28.6139, lng: 77.209 },
  { city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { city: 'Mumbai', lat: 19.076, lng: 72.8777 },
] as const;

const NAMES = [
  'Riya Sharma', 'Kabir Singh', 'Ananya Iyer', 'Vihaan Gupta', 'Isha Verma',
  'Arjun Nair', 'Meera Joshi', 'Rohan Mehta', 'Saanvi Reddy', 'Aditya Rawat',
  'Kavya Menon', 'Dev Malhotra', 'Tara Bisht', 'Yash Kapoor', 'Nisha Patel',
  'Karan Bhatt', 'Pooja Desai', 'Manav Thakur', 'Simran Kaur', 'Harsh Agarwal',
  'Lakshmi Rao', 'Ishaan Chauhan', 'Neha Pillai', 'Siddharth Negi', 'Aisha Khan',
  'Varun Pandey', 'Diya Bansal', 'Aman Rathore', 'Prisha Kulkarni', 'Nikhil Saini',
];

const EXTRA_LANGUAGES = ['Tamil', 'Punjabi', 'Garhwali', 'Marathi', 'Kannada', 'Bengali'];

// Evening and weekend windows, so many pairs overlap.
const WINDOWS: { day: number; start: number; end: number }[] = [
  { day: 1, start: 1080, end: 1260 }, { day: 2, start: 1080, end: 1260 },
  { day: 3, start: 1140, end: 1320 }, { day: 4, start: 1080, end: 1260 },
  { day: 5, start: 1140, end: 1320 }, { day: 6, start: 600, end: 780 },
  { day: 6, start: 960, end: 1140 }, { day: 0, start: 600, end: 780 },
  { day: 0, start: 960, end: 1140 },
];

interface SeedUser {
  email: string;
  username: string;
  name: string;
  bio: string;
  city: (typeof CITIES)[number];
  mode: Mode;
  languages: string[];
  haves: { skill: string; level: number; years: number }[];
  wants: { skill: string; goal: number; priority: Priority }[];
  windows: typeof WINDOWS;
}

const skillNames = SKILLS.map((s) => s.name);

// The guaranteed 3-person chain: demo -> aarav -> diya -> demo.
// demo teaches Python to aarav, aarav teaches Guitar to diya, diya teaches Spanish to demo.
// No pair is a direct swap. The skills are reserved so random users never use them as haves.
const CHAIN = {
  demo: { have: 'Python', want: 'Spanish' },
  aarav: { have: 'Guitar', want: 'Python' },
  diya: { have: 'Spanish', want: 'Guitar' },
};
const RESERVED = ['Python', 'Guitar', 'Spanish'];

function makeChainUsers(): SeedUser[] {
  const shared = { mode: Mode.BOTH, languages: ['English', 'Hindi'], windows: [WINDOWS[0], WINDOWS[5], WINDOWS[8]] };
  return [
    {
      email: 'demo@skillswap.dev', username: 'demo', name: 'Demo User',
      bio: 'Python developer who wants to learn Spanish.', city: CITIES[1], ...shared,
      haves: [{ skill: CHAIN.demo.have, level: 4, years: 5 }],
      wants: [{ skill: CHAIN.demo.want, goal: 3, priority: Priority.HIGH }],
    },
    {
      email: 'aarav@skillswap.dev', username: 'aarav', name: 'Aarav Sharma',
      bio: 'Guitarist who wants to learn Python.', city: CITIES[1], ...shared,
      haves: [{ skill: CHAIN.aarav.have, level: 4, years: 6 }],
      wants: [{ skill: CHAIN.aarav.want, goal: 3, priority: Priority.HIGH }],
    },
    {
      email: 'diya@skillswap.dev', username: 'diya', name: 'Diya Nair',
      bio: 'Spanish speaker who wants to learn Guitar.', city: CITIES[1], ...shared,
      haves: [{ skill: CHAIN.diya.have, level: 5, years: 4 }],
      wants: [{ skill: CHAIN.diya.want, goal: 3, priority: Priority.HIGH }],
    },
  ];
}

function makeRandomUsers(): SeedUser[] {
  return NAMES.map((name, i) => {
    const first = name.split(' ')[0].toLowerCase();
    const haveSkills = pickDistinct(skillNames, int(2, 3), RESERVED);
    const wantSkills = pickDistinct(skillNames, int(2, 3), [...haveSkills, ...RESERVED]);
    const languages = ['English', 'Hindi'];
    if (rand() < 0.5) languages.push(pick(EXTRA_LANGUAGES));
    return {
      email: `${first}${i + 1}@example.com`,
      username: `${first}${i + 1}`,
      name,
      bio: `I love sharing ${haveSkills[0]} and I am curious about ${wantSkills[0]}.`,
      city: CITIES[i % CITIES.length],
      mode: pick([Mode.ONLINE, Mode.BOTH, Mode.BOTH, Mode.IN_PERSON]),
      languages,
      haves: haveSkills.map((skill) => ({ skill, level: int(2, 5), years: int(1, 8) })),
      wants: wantSkills.map((skill) => ({
        skill,
        goal: int(3, 5),
        priority: pick([Priority.HIGH, Priority.MEDIUM, Priority.LOW]),
      })),
      windows: pickDistinct(WINDOWS, 3),
    };
  });
}

// ── main ──────────────────────────────────────────────────

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the demo seed in production.');
  }

  // Dev seed: start from empty tables (children first).
  await prisma.$transaction([
    prisma.review.deleteMany(),
    prisma.creditTx.deleteMany(),
    prisma.session.deleteMany(),
    prisma.chainMember.deleteMany(),
    prisma.swapChain.deleteMany(),
    prisma.message.deleteMany(),
    prisma.match.deleteMany(),
    prisma.swipe.deleteMany(),
    prisma.block.deleteMany(),
    prisma.report.deleteMany(),
    prisma.userSkillHave.deleteMany(),
    prisma.userSkillWant.deleteMany(),
    prisma.availabilitySlot.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.skill.deleteMany(),
  ]);

  const skillIds = new Map<string, string>();
  for (const s of SKILLS) {
    const row = await prisma.skill.create({
      data: { name: s.name, slug: slugify(s.name), category: s.category, aliases: s.aliases },
    });
    skillIds.set(s.name, row.id);
  }

  const users = [...makeChainUsers(), ...makeRandomUsers()];
  const passwordHash = await hashPassword(SEED_PASSWORD); // one hash, shared on purpose
  for (const u of users) {
    const isChain = ['demo', 'aarav', 'diya'].includes(u.username);
    await prisma.user.create({
      data: {
        email: u.email,
        passwordHash,
        username: u.username,
        name: u.name,
        bio: u.bio,
        city: u.city.city,
        lat: u.city.lat,
        lng: u.city.lng,
        mode: u.mode,
        languages: u.languages,
        onboarded: true,
        verified: isChain,
        haves: {
          create: u.haves.map((h) => ({
            skillId: skillIds.get(h.skill)!,
            level: h.level,
            years: h.years,
          })),
        },
        wants: {
          create: u.wants.map((w) => ({
            skillId: skillIds.get(w.skill)!,
            currentLevel: 1,
            goalLevel: w.goal,
            priority: w.priority,
          })),
        },
        slots: {
          create: u.windows.map((w) => ({ dayOfWeek: w.day, startMin: w.start, endMin: w.end })),
        },
        // credits default to 2, so record the matching signup bonus
        ledger: { create: { amount: 2, reason: 'SIGNUP_BONUS' } },
      },
    });
  }

  console.log(`Seeded ${SKILLS.length} skills and ${users.length} users.`);
  console.log('Demo login user: demo@skillswap.dev (chain: demo -> aarav -> diya -> demo)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
