import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { toSkillRef } from '../matching/mappers';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PublicProfileCardDto,
  PublicProfileDto,
  PublicSitemapDto,
  PublicSkillCityDto,
  PublicSkillDto,
  PublicSkillSummaryDto,
  PublicStatsDto,
  SwapCountDto,
} from './dto/public.dto';

const MAX_TEACHERS = 12;
/** Only people who chose to be public AND finished onboarding are ever shown. */
const VISIBLE = { onboarded: true, isPublic: true } as const;

const cardSelect = {
  username: true,
  name: true,
  avatarUrl: true,
  city: true,
  ratingAvg: true,
  sessionsDone: true,
} satisfies Prisma.UserSelect;

const toCard = (u: {
  username: string;
  name: string;
  avatarUrl: string | null;
  city: string | null;
  ratingAvg: number;
  sessionsDone: number;
}): PublicProfileCardDto => ({
  username: u.username,
  name: u.name,
  avatarUrl: u.avatarUrl,
  city: u.city,
  ratingAvg: u.ratingAvg,
  sessionsDone: u.sessionsDone,
});

const notFound = (what: string) =>
  new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(): Promise<PublicStatsDto> {
    const [users, skills, sessions, swaps] = await Promise.all([
      this.prisma.user.count({ where: VISIBLE }),
      this.prisma.skill.count(),
      this.prisma.session.count({ where: { status: 'COMPLETED' } }),
      // "I teach A and want B": the swaps people are looking for most.
      this.prisma.$queryRaw<
        { from_id: string; to_id: string; count: number }[]
      >(Prisma.sql`
        SELECT h.skill_id AS from_id, w.skill_id AS to_id, count(*)::int AS count
        FROM user_skill_haves h
        JOIN user_skill_wants w ON w.user_id = h.user_id AND w.skill_id <> h.skill_id
        JOIN users u ON u.id = h.user_id AND u.onboarded AND u.is_public
        GROUP BY h.skill_id, w.skill_id
        ORDER BY count DESC, from_id, to_id
        LIMIT 5`),
    ]);
    const refs = await this.skillRefs(
      swaps.flatMap((s) => [s.from_id, s.to_id]),
    );
    return {
      users,
      skills,
      sessions,
      topSwaps: swaps.map((s) => ({
        from: refs.get(s.from_id)!,
        to: refs.get(s.to_id)!,
        count: s.count,
      })),
    };
  }

  async skills(
    limit = 50,
    category?: string,
  ): Promise<PublicSkillSummaryDto[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        slug: string;
        category: string;
        teacher_count: number;
        learner_count: number;
      }[]
    >(Prisma.sql`
      SELECT s.id, s.name, s.slug, s.category,
        (SELECT count(*) FROM user_skill_haves h
           JOIN users u ON u.id = h.user_id AND u.onboarded AND u.is_public
           WHERE h.skill_id = s.id)::int AS teacher_count,
        (SELECT count(*) FROM user_skill_wants w
           JOIN users u ON u.id = w.user_id AND u.onboarded AND u.is_public
           WHERE w.skill_id = s.id)::int AS learner_count
      FROM skills s
      WHERE ${category ?? null}::text IS NULL OR lower(s.category) = lower(${category ?? null}::text)
      ORDER BY teacher_count DESC, learner_count DESC, s.name
      LIMIT ${limit}`);
    return rows.map((r) => ({
      ...toSkillRef(r),
      teacherCount: r.teacher_count,
      learnerCount: r.learner_count,
    }));
  }

  async skill(slug: string): Promise<PublicSkillDto> {
    const skill = await this.prisma.skill.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
      },
    });
    if (!skill) throw notFound('Skill');

    const [teacherCount, learnerCount, teachers, swaps] = await Promise.all([
      this.prisma.userSkillHave.count({
        where: { skillId: skill.id, user: VISIBLE },
      }),
      this.prisma.userSkillWant.count({
        where: { skillId: skill.id, user: VISIBLE },
      }),
      this.teachersOf(skill.id),
      // What do the people who teach this skill want to learn in return?
      this.prisma.$queryRaw<{ skill_id: string; count: number }[]>(Prisma.sql`
        SELECT w.skill_id, count(*)::int AS count
        FROM user_skill_haves h
        JOIN user_skill_wants w ON w.user_id = h.user_id AND w.skill_id <> h.skill_id
        JOIN users u ON u.id = h.user_id AND u.onboarded AND u.is_public
        WHERE h.skill_id = ${skill.id}
        GROUP BY w.skill_id
        ORDER BY count DESC, w.skill_id
        LIMIT 5`),
    ]);
    const refs = await this.skillRefs(swaps.map((s) => s.skill_id));
    const popularSwaps: SwapCountDto[] = swaps.map((s) => ({
      skill: refs.get(s.skill_id)!,
      count: s.count,
    }));

    return {
      ...toSkillRef(skill),
      description: skill.description,
      teacherCount,
      learnerCount,
      popularSwaps,
      teachers,
    };
  }

  async skillInCity(
    slug: string,
    citySlug: string,
  ): Promise<PublicSkillCityDto> {
    const skill = await this.prisma.skill.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, category: true },
    });
    if (!skill) throw notFound('Skill');

    const cityName = citySlug.replace(/-/g, ' ').trim();
    const inCity = {
      skillId: skill.id,
      user: {
        ...VISIBLE,
        city: { equals: cityName, mode: 'insensitive' as const },
      },
    };
    const [teacherCount, teachers] = await Promise.all([
      this.prisma.userSkillHave.count({ where: inCity }),
      this.teachersOf(skill.id, cityName),
    ]);
    return {
      skill: toSkillRef(skill),
      // Show the city as people wrote it ("Haridwar"), not as the URL spelled it.
      city:
        teachers[0]?.city ?? cityName.replace(/\b\w/g, (c) => c.toUpperCase()),
      teacherCount,
      teachers,
    };
  }

  async profile(username: string): Promise<PublicProfileDto> {
    const user = await this.prisma.user.findFirst({
      where: { username, ...VISIBLE },
      select: {
        ...cardSelect,
        bio: true,
        haves: {
          select: { level: true, skill: true },
          orderBy: { level: 'desc' },
        },
        wants: { select: { skill: true } },
      },
    });
    if (!user) throw notFound('Profile');
    return {
      ...toCard(user),
      bio: user.bio,
      haves: user.haves.map((h) => ({
        skill: toSkillRef(h.skill),
        level: h.level,
      })),
      wants: user.wants.map((w) => ({ skill: toSkillRef(w.skill) })),
    };
  }

  async sitemap(): Promise<PublicSitemapDto> {
    const [skills, users, local] = await Promise.all([
      this.prisma.skill.findMany({
        select: { slug: true, updatedAt: true },
        orderBy: { slug: 'asc' },
      }),
      this.prisma.user.findMany({
        where: VISIBLE,
        select: { username: true, updatedAt: true },
        orderBy: { username: 'asc' },
      }),
      // A city page is only worth indexing when it has something to show.
      this.prisma.$queryRaw<{ skill: string; city: string }[]>(Prisma.sql`
        SELECT s.slug AS skill, u.city AS city
        FROM user_skill_haves h
        JOIN skills s ON s.id = h.skill_id
        JOIN users u ON u.id = h.user_id AND u.onboarded AND u.is_public AND u.city IS NOT NULL
        GROUP BY s.slug, u.city
        HAVING count(*) >= 3
        ORDER BY s.slug, u.city`),
    ]);
    return {
      skills: skills.map((s) => ({
        slug: s.slug,
        updatedAt: s.updatedAt.toISOString(),
      })),
      users: users.map((u) => ({
        username: u.username,
        updatedAt: u.updatedAt.toISOString(),
      })),
      localPages: local,
    };
  }

  /** Best-rated public teachers of a skill, optionally limited to one city. */
  private async teachersOf(
    skillId: string,
    city?: string,
  ): Promise<PublicProfileCardDto[]> {
    const rows = await this.prisma.userSkillHave.findMany({
      where: {
        skillId,
        user: {
          ...VISIBLE,
          ...(city
            ? { city: { equals: city, mode: 'insensitive' as const } }
            : {}),
        },
      },
      select: { user: { select: cardSelect } },
      orderBy: [
        { user: { ratingAvg: 'desc' } },
        { user: { sessionsDone: 'desc' } },
        { user: { username: 'asc' } },
      ],
      take: MAX_TEACHERS,
    });
    return rows.map((r) => toCard(r.user));
  }

  private async skillRefs(ids: string[]) {
    const skills = await this.prisma.skill.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, slug: true, category: true },
    });
    return new Map(skills.map((s) => [s.id, toSkillRef(s)]));
  }
}
