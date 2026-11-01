import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export interface LoopRow {
  path: string[];
  skills: string[];
  depth: number;
}

const MAX_DEPTH = 4;

/**
 * Loops that start and end at `userId`: "U -> V" means U teaches a skill V wants.
 * 3- and 4-person loops only (docs/02-backend-plan.md §3). Compared with the doc
 * query, edges are limited to people who finished onboarding and exclude pairs
 * where either person blocked the other.
 */
export function findLoopRows(
  prisma: PrismaService,
  userId: string,
): Promise<LoopRow[]> {
  return prisma.$queryRaw<LoopRow[]>(Prisma.sql`
    WITH RECURSIVE edges AS (
      SELECT DISTINCT h.user_id AS src, w.user_id AS dst, h.skill_id AS skill
      FROM user_skill_haves h
      JOIN user_skill_wants w ON w.skill_id = h.skill_id AND w.user_id <> h.user_id
      JOIN users us ON us.id = h.user_id AND us.onboarded
      JOIN users ud ON ud.id = w.user_id AND ud.onboarded
      WHERE NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = h.user_id AND b.blocked_id = w.user_id)
           OR (b.blocker_id = w.user_id AND b.blocked_id = h.user_id)
      )
    ),
    paths AS (
      SELECT e.src AS start, e.dst, ARRAY[e.src, e.dst] AS path, ARRAY[e.skill] AS skills, 1 AS depth
      FROM edges e WHERE e.src = ${userId}
      UNION ALL
      SELECT p.start, e.dst, p.path || e.dst, p.skills || e.skill, p.depth + 1
      FROM paths p
      JOIN edges e ON e.src = p.dst
      WHERE p.depth < ${MAX_DEPTH}
        AND p.dst <> p.start
        AND (e.dst = p.start OR NOT e.dst = ANY(p.path))
    )
    SELECT path, skills, depth
    FROM paths
    WHERE dst = start AND depth >= 3
    ORDER BY depth
    LIMIT 20`);
}

/** People who finished onboarding, have no active match and are in no open chain proposal. */
export async function findUsersWithoutMatches(
  prisma: PrismaService,
  limit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    FROM users u
    WHERE u.onboarded
      AND NOT EXISTS (
        SELECT 1 FROM matches m
        WHERE m.status = 'ACTIVE' AND (m.user_a_id = u.id OR m.user_b_id = u.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM chain_members cm
        JOIN swap_chains c ON c.id = cm.chain_id
        WHERE cm.user_id = u.id AND c.status = 'PROPOSED'
      )
    ORDER BY u.created_at, u.id
    LIMIT ${limit}`);
  return rows.map((r) => r.id);
}
