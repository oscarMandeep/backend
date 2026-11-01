/**
 * Cache tags of the website's ISR pages (docs/04-api-contract.md §6).
 * Pure functions, so the rules are easy to test.
 */
export interface UserTagInput {
  username: string;
  city: string | null;
  haveSlugs: string[];
  wantSlugs: string[];
}

/** Profile or skills changed: that profile page, every skill page it appears on, its city. */
export function tagsForUser(u: UserTagInput): string[] {
  const tags = new Set<string>([`user:${u.username}`]);
  for (const slug of [...u.haveSlugs, ...u.wantSlugs])
    tags.add(`skill:${slug}`);
  if (u.city) tags.add(`city:${u.city.trim().toLowerCase()}`);
  return [...tags].sort();
}

/** A brand-new skill: the skills index, its own page, and the sitemap. */
export function tagsForNewSkill(slug: string): string[] {
  return ['sitemap', `skill:${slug}`, 'skills'].sort();
}
