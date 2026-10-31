export interface ReasonInput {
  learnSkillName: string;
  teachSkillName: string | null;
  sharedHoursPerWeek: number;
  sameCity: boolean;
  city: string | null;
  sharedLanguages: string[];
}

/** The "why you matched" lines on a card. */
export function buildReasons(i: ReasonInput): string[] {
  const reasons = [`Teaches ${i.learnSkillName} (you want)`];
  if (i.teachSkillName) reasons.push(`Wants ${i.teachSkillName} (you teach)`);
  if (i.sharedHoursPerWeek > 0) {
    const hours = Math.round(i.sharedHoursPerWeek * 10) / 10;
    reasons.push(`${hours} shared ${hours === 1 ? 'hr' : 'hrs'}/week`);
  }
  if (i.sameCity && i.city) reasons.push(`Both in ${i.city}`);
  if (i.sharedLanguages.length > 0) {
    reasons.push(`Both speak ${i.sharedLanguages.slice(0, 2).join(' and ')}`);
  }
  return reasons;
}
