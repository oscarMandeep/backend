import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findCandidateUserIds, loadSimilarity } from './matching.queries';
import type { SkillRefDto } from '../skills/dto/skill-ref.dto';
import { scoreMatch, type MatchResult, type Profile } from './score';

/** Everything scoring and the deck cards need about a user, in one query. */
export const matchUserInclude = {
  haves: { include: { skill: true } },
  wants: { include: { skill: true } },
  slots: true,
} satisfies Prisma.UserInclude;

export type MatchUser = Prisma.UserGetPayload<{
  include: typeof matchUserInclude;
}>;

export interface ScoredCandidate {
  user: MatchUser;
  result: MatchResult;
}

export function toProfile(u: MatchUser): Profile {
  return {
    id: u.id,
    mode: u.mode,
    city: u.city,
    languages: u.languages,
    ratingAvg: u.ratingAvg,
    ratingCount: u.ratingCount,
    sessionsDone: u.sessionsDone,
    noShowCount: u.noShowCount,
    haves: u.haves.map((h) => ({ skillId: h.skillId, level: h.level })),
    wants: u.wants.map((w) => ({
      skillId: w.skillId,
      currentLevel: w.currentLevel,
      goalLevel: w.goalLevel,
      priority: w.priority,
    })),
    availability: u.slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startMin: s.startMin,
      endMin: s.endMin,
    })),
  };
}

const skillIdsOf = (users: MatchUser[]) =>
  users.flatMap((u) => [
    ...u.haves.map((h) => h.skillId),
    ...u.wants.map((w) => w.skillId),
  ]);

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  loadUser(userId: string): Promise<MatchUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: matchUserInclude,
    });
  }

  /** Stage 1 (SQL) then stage 2 (pure scoring). Unsorted, filters not applied. */
  async findScoredCandidates(me: MatchUser): Promise<ScoredCandidate[]> {
    const ids = await findCandidateUserIds(this.prisma, me.id);
    if (ids.length === 0) return [];
    const candidates = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      include: matchUserInclude,
    });
    const similarity = await loadSimilarity(
      this.prisma,
      skillIdsOf([me, ...candidates]),
    );
    const myProfile = toProfile(me);

    const scored: ScoredCandidate[] = [];
    for (const user of candidates) {
      const result = scoreMatch(myProfile, toProfile(user), similarity);
      if (result) scored.push({ user, result });
    }
    return scored;
  }

  /**
   * Score one specific pair, always computed on the server (the client's idea of
   * a score is never trusted). Null means they are not a valid match.
   */
  async scorePair(
    me: MatchUser,
    other: MatchUser,
  ): Promise<MatchResult | null> {
    const similarity = await loadSimilarity(
      this.prisma,
      skillIdsOf([me, other]),
    );
    return scoreMatch(toProfile(me), toProfile(other), similarity);
  }

  /**
   * The match as seen by `viewer`: the fresh score plus what `other` teaches the
   * viewer (learn) and what the viewer teaches `other` (teach). Each person in a
   * match sees the mirror image of the other.
   */
  async describePair(viewer: MatchUser, other: MatchUser): Promise<PairView> {
    const result = await this.scorePair(viewer, other);
    const learn =
      other.haves.find((h) => h.skillId === result?.learnSkillId)?.skill ??
      other.haves[0]?.skill;
    if (!learn) throw new Error(`user ${other.id} has no skills to teach`);
    const teach = result?.teachSkillId
      ? (viewer.haves.find((h) => h.skillId === result.teachSkillId)?.skill ??
        null)
      : null;
    return { result, learnSkill: learn, teachSkill: teach };
  }
}

export interface PairView {
  /** Null when the pair no longer qualifies (profiles changed after matching). */
  result: MatchResult | null;
  learnSkill: SkillRefDto;
  teachSkill: SkillRefDto | null;
}
