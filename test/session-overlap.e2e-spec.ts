import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Mode,
  PrismaClient,
  SessionStatus,
} from '../src/generated/prisma/client';

/**
 * Integration test against the real local Postgres.
 * Proves the exclusion constraints (btree_gist) reject double-booking,
 * regardless of what the application code does.
 */
describe('sessions exclusion constraint', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const tag = `ovl${Date.now()}`;
  let teacherId: string;
  let otherTeacherId: string;
  let learnerId: string;
  let otherLearnerId: string;
  let skillId: string;

  const at = (hour: number, minute = 0) =>
    new Date(Date.UTC(2031, 0, 15, hour, minute));
  const book = (
    teacher: string,
    learner: string,
    start: Date,
    durationMin = 60,
    status: SessionStatus = SessionStatus.CONFIRMED,
  ) =>
    prisma.session.create({
      data: {
        teacherId: teacher,
        learnerId: learner,
        skillId,
        startsAt: start,
        durationMin,
        mode: Mode.ONLINE,
        status,
      },
    });

  beforeAll(async () => {
    const mk = (n: string) =>
      prisma.user.create({
        data: {
          email: `${tag}-${n}@test.dev`,
          username: `${tag}-${n}`,
          name: n,
        },
      });
    [teacherId, otherTeacherId, learnerId, otherLearnerId] = (
      await Promise.all(['t1', 't2', 'l1', 'l2'].map(mk))
    ).map((u) => u.id);
    skillId = (
      await prisma.skill.create({
        data: { name: tag, slug: tag, category: 'Test' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { skillId } });
    await prisma.skill.delete({ where: { id: skillId } });
    await prisma.user.deleteMany({ where: { username: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  it('rejects a teacher being booked in overlapping slots', async () => {
    await book(teacherId, learnerId, at(10)); // 10:00-11:00
    await expect(book(teacherId, otherLearnerId, at(10, 30))).rejects.toThrow(
      /exclusion constraint/i,
    );
  });

  it('rejects a learner being booked in overlapping slots', async () => {
    await book(otherTeacherId, otherLearnerId, at(14)); // 14:00-15:00
    await expect(book(teacherId, otherLearnerId, at(14, 15))).rejects.toThrow(
      /exclusion constraint/i,
    );
  });

  it('allows back-to-back sessions (11:00 starts when 10:00-11:00 ends)', async () => {
    await expect(
      book(teacherId, otherLearnerId, at(11)),
    ).resolves.toBeDefined();
  });

  it('ignores cancelled sessions, so the slot can be rebooked', async () => {
    await book(teacherId, learnerId, at(16), 60, SessionStatus.CANCELLED);
    await expect(book(teacherId, learnerId, at(16))).resolves.toBeDefined();
  });
});
