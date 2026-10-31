import type { SkillRefDto } from '../skills/dto/skill-ref.dto';
import type { UserCardDto } from '../users/dto/user-card.dto';
import type { MatchUser } from './matching.service';

export function toSkillRef(s: SkillRefDto): SkillRefDto {
  return { id: s.id, name: s.name, slug: s.slug, category: s.category };
}

/** The public view of a user: never email, credits, coordinates or availability. */
export function toUserCard(u: MatchUser): UserCardDto {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    city: u.city,
    mode: u.mode,
    languages: u.languages,
    ratingAvg: u.ratingAvg,
    ratingCount: u.ratingCount,
    sessionsDone: u.sessionsDone,
    isNew: u.sessionsDone === 0,
    haves: u.haves.map((h) => ({
      skill: toSkillRef(h.skill),
      level: h.level,
      verified: h.verified,
    })),
    wants: u.wants.map((w) => ({
      skill: toSkillRef(w.skill),
      goalLevel: w.goalLevel,
      priority: w.priority,
    })),
  };
}
