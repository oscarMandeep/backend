import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Mode } from '../generated/prisma/client';
import { toSkillRef as ref, toUserCard } from '../matching/mappers';
import {
  MatchingService,
  type MatchUser,
  type ScoredCandidate,
} from '../matching/matching.service';
import type { DiscoverQuery } from './dto/discover-query.dto';
import type { DeckCardDto } from './dto/deck-card.dto';
import { buildReasons } from './reasons';

const NEW_USER_BOOST = 5; // cold start: new people get seen, without outranking clearly better matches
const DEFAULT_LIMIT = 20;

const isNewUser = (u: MatchUser) => u.sessionsDone === 0 && u.ratingCount === 0;
const rankKey = (c: ScoredCandidate) =>
  c.result.score + (isNewUser(c.user) ? NEW_USER_BOOST : 0);

@Injectable()
export class DiscoverService {
  constructor(private readonly matching: MatchingService) {}

  async getDeck(userId: string, query: DiscoverQuery): Promise<DeckCardDto[]> {
    const me = await this.matching.loadUser(userId);
    if (!me) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }
    if (!me.onboarded) {
      throw new ConflictException({
        code: 'ONBOARDING_REQUIRED',
        message: 'Finish onboarding to see matches.',
      });
    }

    const wanted = query.mode;
    const fits = (c: ScoredCandidate) =>
      !wanted ||
      wanted === Mode.BOTH ||
      c.user.mode === Mode.BOTH ||
      c.user.mode === wanted;

    const ranked = (await this.matching.findScoredCandidates(me))
      .filter(fits)
      .filter((c) => !query.swapOnly || c.result.type === 'SWAP')
      .sort(
        (a, b) =>
          rankKey(b) - rankKey(a) ||
          b.result.score - a.result.score ||
          a.user.id.localeCompare(b.user.id),
      )
      .slice(0, query.limit ?? DEFAULT_LIMIT);

    return ranked.map((c) => this.toCard(me, c));
  }

  private toCard(
    me: MatchUser,
    { user, result }: ScoredCandidate,
  ): DeckCardDto {
    // What they teach me is one of THEIR haves; what I teach them is one of MY haves.
    const learn = user.haves.find(
      (h) => h.skillId === result.learnSkillId,
    )?.skill;
    if (!learn)
      throw new Error(
        `learn skill ${result.learnSkillId} missing on candidate ${user.id}`,
      );
    const teach = result.teachSkillId
      ? (me.haves.find((h) => h.skillId === result.teachSkillId)?.skill ?? null)
      : null;

    return {
      user: toUserCard(user),
      score: result.score,
      type: result.type,
      breakdown: result.parts,
      reasons: buildReasons({
        learnSkillName: learn.name,
        teachSkillName: teach?.name ?? null,
        sharedHoursPerWeek: result.sharedHoursPerWeek,
        sameCity: result.sameCity,
        city: user.city,
        sharedLanguages: result.sharedLanguages,
      }),
      learnSkill: ref(learn),
      teachSkill: teach ? ref(teach) : null,
    };
  }
}
