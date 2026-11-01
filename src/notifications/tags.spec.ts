import { tagsForNewSkill, tagsForUser } from './tags';

describe('cache tags', () => {
  it("a user change touches their page, their skills' pages and their city", () => {
    expect(
      tagsForUser({
        username: 'riya',
        city: ' Haridwar ',
        haveSlugs: ['excel', 'guitar'],
        wantSlugs: ['spanish', 'excel'],
      }),
    ).toEqual([
      'city:haridwar',
      'skill:excel',
      'skill:guitar',
      'skill:spanish',
      'user:riya',
    ]);
  });

  it('works without a city or skills, and never repeats a tag', () => {
    expect(
      tagsForUser({
        username: 'new',
        city: null,
        haveSlugs: [],
        wantSlugs: [],
      }),
    ).toEqual(['user:new']);
  });

  it('a new skill refreshes the skills index, its page and the sitemap', () => {
    expect(tagsForNewSkill('origami')).toEqual([
      'sitemap',
      'skill:origami',
      'skills',
    ]);
  });
});
