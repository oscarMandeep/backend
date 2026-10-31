/**
 * Pure match scoring: no Nest, no Prisma, no I/O, so it is easy to unit test.
 * Weights come from docs/00-overview.md. The formula inside each factor is
 * documented next to it.
 */

export type Mode = 'ONLINE' | 'IN_PERSON' | 'BOTH';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type MatchKind = 'SWAP' | 'CREDIT';

export interface Have {
  skillId: string;
  level: number; // 1-5
}

export interface Want {
  skillId: string;
  currentLevel: number; // 1-5
  goalLevel: number; // 1-5
  priority: Priority;
}

export interface Slot {
  dayOfWeek: number; // 0 = Sunday
  startMin: number;
  endMin: number;
}

export interface Profile {
  id: string;
  mode: Mode;
  city: string | null;
  languages: string[];
  ratingAvg: number;
  ratingCount: number;
  sessionsDone: number;
  noShowCount: number;
  haves: Have[];
  wants: Want[];
  availability: Slot[];
}

/** 0..1 similarity of two skills. 1 for the same skill. */
export type SimilarityFn = (skillIdA: string, skillIdB: string) => number;

export const WEIGHTS = {
  skill: 35,
  reciprocity: 25,
  priority: 10,
  availability: 10,
  mode: 8,
  language: 5,
  trust: 7,
} as const;

/** Skills closer than this count as "the same thing" (cosine distance < 0.35). */
export const MIN_SKILL_SIMILARITY = 0.65;
export const NEW_USER_TRUST = 0.6;
const FULL_AVAILABILITY_HOURS = 4;
const PRIORITY_VALUE: Record<Priority, number> = {
  HIGH: 1,
  MEDIUM: 0.6,
  LOW: 0.3,
};

export interface Breakdown {
  skill: number;
  reciprocity: number;
  priority: number;
  availability: number;
  mode: number;
  language: number;
  trust: number;
}

export interface MatchResult {
  score: number; // 0..100
  parts: Breakdown; // each 0..1
  type: MatchKind;
  /** What the candidate teaches me. */
  learnSkillId: string;
  /** What I teach them, or null for a credit match. */
  teachSkillId: string | null;
  sharedLanguages: string[];
  sharedHoursPerWeek: number;
  sameCity: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Can a teacher at `teacherLevel` help a learner go from currentLevel to goalLevel?
 * 0 = no (teacher is not above the learner), 1 = reaches the goal,
 * in between = helps part of the way (never below 0.4 once it helps at all).
 */
export function levelFit(
  teacherLevel: number,
  currentLevel: number,
  goalLevel: number,
): number {
  if (teacherLevel <= currentLevel) return 0;
  if (teacherLevel >= goalLevel) return 1;
  return clamp01(
    Math.max(0.4, (teacherLevel - currentLevel) / (goalLevel - currentLevel)),
  );
}

interface Fit {
  fit: number; // 0..1
  skillId: string; // the teacher's skill
  want: Want; // the learner's want it serves
}

/** Best way `teacher` can teach what `learner` wants (null if none). */
function bestFit(
  teacher: Profile,
  learner: Profile,
  similarity: SimilarityFn,
): Fit | null {
  let best: Fit | null = null;
  for (const want of learner.wants) {
    for (const have of teacher.haves) {
      const sim =
        have.skillId === want.skillId
          ? 1
          : similarity(have.skillId, want.skillId);
      if (sim < MIN_SKILL_SIMILARITY) continue;
      const fit = sim * levelFit(have.level, want.currentLevel, want.goalLevel);
      if (fit <= 0) continue;
      const better =
        !best ||
        fit > best.fit ||
        (fit === best.fit &&
          PRIORITY_VALUE[want.priority] > PRIORITY_VALUE[best.want.priority]);
      if (better) best = { fit, skillId: have.skillId, want };
    }
  }
  return best;
}

/** Overlapping hours per week between two availability lists. */
export function sharedHours(a: readonly Slot[], b: readonly Slot[]): number {
  let minutes = 0;
  for (const x of a) {
    for (const y of b) {
      if (x.dayOfWeek !== y.dayOfWeek) continue;
      minutes += Math.max(
        0,
        Math.min(x.endMin, y.endMin) - Math.max(x.startMin, y.startMin),
      );
    }
  }
  return minutes / 60;
}

const canOnline = (m: Mode) => m === 'ONLINE' || m === 'BOTH';
const canInPerson = (m: Mode) => m === 'IN_PERSON' || m === 'BOTH';

function sameCityOf(a: Profile, b: Profile): boolean {
  return (
    !!a.city &&
    !!b.city &&
    a.city.trim().toLowerCase() === b.city.trim().toLowerCase()
  );
}

/** In person in the same city = 1, online-compatible = 0.7, otherwise 0. */
function modeScore(me: Profile, other: Profile): number {
  if (canInPerson(me.mode) && canInPerson(other.mode) && sameCityOf(me, other))
    return 1;
  if (canOnline(me.mode) && canOnline(other.mode)) return 0.7;
  return 0;
}

/** New users get 0.6; others get rating/5 times reliability (1 - no-show rate). */
export function trustScore(p: Profile): number {
  const sessions = p.sessionsDone + p.noShowCount;
  const reliability = sessions === 0 ? 1 : 1 - p.noShowCount / sessions;
  if (p.ratingCount === 0) {
    return p.sessionsDone === 0 && p.noShowCount === 0
      ? NEW_USER_TRUST
      : NEW_USER_TRUST * reliability;
  }
  return clamp01((p.ratingAvg / 5) * reliability);
}

/**
 * Score `candidate` as a match for `me`, or null when they must not be shown:
 * no shared language (hard filter) or nothing the candidate can teach me.
 */
export function scoreMatch(
  me: Profile,
  candidate: Profile,
  similarity: SimilarityFn,
): MatchResult | null {
  const lang = new Set(me.languages.map((l) => l.trim().toLowerCase()));
  const sharedLanguages = candidate.languages.filter((l) =>
    lang.has(l.trim().toLowerCase()),
  );
  if (sharedLanguages.length === 0) return null;

  const learn = bestFit(candidate, me, similarity);
  if (!learn) return null;
  const teach = bestFit(me, candidate, similarity);

  const hours = sharedHours(me.availability, candidate.availability);
  const parts: Breakdown = {
    skill: round2(learn.fit),
    reciprocity: round2(teach?.fit ?? 0),
    priority: PRIORITY_VALUE[learn.want.priority],
    availability: round2(clamp01(hours / FULL_AVAILABILITY_HOURS)),
    mode: modeScore(me, candidate),
    language: sharedLanguages.length >= 2 ? 1 : 0.7,
    trust: round2(trustScore(candidate)),
  };

  const total =
    parts.skill * WEIGHTS.skill +
    parts.reciprocity * WEIGHTS.reciprocity +
    parts.priority * WEIGHTS.priority +
    parts.availability * WEIGHTS.availability +
    parts.mode * WEIGHTS.mode +
    parts.language * WEIGHTS.language +
    parts.trust * WEIGHTS.trust;

  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    parts,
    type: teach ? 'SWAP' : 'CREDIT',
    learnSkillId: learn.skillId,
    teachSkillId: teach?.skillId ?? null,
    sharedLanguages,
    sharedHoursPerWeek: round2(hours),
    sameCity: sameCityOf(me, candidate),
  };
}
