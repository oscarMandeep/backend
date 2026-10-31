import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { MIN_SKILL_SIMILARITY, type SimilarityFn } from './score';

/** Skills closer than this cosine distance are "the same thing" (= similarity 0.65). */
const MAX_DISTANCE = 1 - MIN_SKILL_SIMILARITY;

/**
 * Stage 1 (SQL): who could teach something I want? Exact skill or a close one
 * (pgvector). Excludes me, people I already swiped, blocked pairs and users who
 * have not finished onboarding. Scoring happens in stage 2 (score.ts).
 */
export async function findCandidateUserIds(
  prisma: PrismaService,
  userId: string,
  limit = 200,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ user_id: string }[]>(Prisma.sql`
    WITH my_wants AS (
      SELECT w.skill_id, s.embedding
      FROM user_skill_wants w JOIN skills s ON s.id = w.skill_id
      WHERE w.user_id = ${userId}
    ),
    similar_skills AS (
      SELECT DISTINCT s.id AS skill_id
      FROM skills s
      JOIN my_wants mw
        ON s.id = mw.skill_id
        OR (s.embedding IS NOT NULL AND mw.embedding IS NOT NULL
            AND (s.embedding <=> mw.embedding) < ${MAX_DISTANCE})
    )
    SELECT DISTINCT h.user_id
    FROM user_skill_haves h
    JOIN similar_skills ss ON ss.skill_id = h.skill_id
    JOIN users u ON u.id = h.user_id AND u.onboarded
    WHERE h.user_id <> ${userId}
      AND NOT EXISTS (SELECT 1 FROM swipes sw
                      WHERE sw.swiper_id = ${userId} AND sw.swiped_id = h.user_id)
      AND NOT EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = ${userId} AND b.blocked_id = h.user_id)
                         OR (b.blocker_id = h.user_id AND b.blocked_id = ${userId}))
    LIMIT ${limit}
  `);
  return rows.map((r) => r.user_id);
}

/**
 * Similarity (0..1) between every pair of the given skills that is close enough
 * to matter. Skills without an embedding are only similar to themselves.
 */
export async function loadSimilarity(
  prisma: PrismaService,
  skillIds: string[],
): Promise<SimilarityFn> {
  const ids = [...new Set(skillIds)];
  const pairs = new Map<string, number>();
  if (ids.length > 1) {
    const rows = await prisma.$queryRaw<
      { a: string; b: string; sim: number }[]
    >(Prisma.sql`
      SELECT a.id AS a, b.id AS b, 1 - (a.embedding <=> b.embedding) AS sim
      FROM skills a
      JOIN skills b ON a.id < b.id
      WHERE a.id = ANY(${ids}::text[]) AND b.id = ANY(${ids}::text[])
        AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) < ${MAX_DISTANCE}
    `);
    for (const r of rows) pairs.set(`${r.a}|${r.b}`, Number(r.sim));
  }
  return (x, y) => {
    if (x === y) return 1;
    return pairs.get(x < y ? `${x}|${y}` : `${y}|${x}`) ?? 0;
  };
}
