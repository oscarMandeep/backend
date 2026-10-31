import {
  levelFit,
  scoreMatch,
  sharedHours,
  trustScore,
  WEIGHTS,
  type Profile,
  type SimilarityFn,
} from './score';

const noSimilarity: SimilarityFn = () => 0;

/** Me: teaches Python (4), wants Spanish (1 -> 3, HIGH). Free Mon 18-20 + Sat 10-12 (4 h). */
const me = (over: Partial<Profile> = {}): Profile => ({
  id: 'me',
  mode: 'BOTH',
  city: 'Dehradun',
  languages: ['English', 'Hindi'],
  ratingAvg: 0,
  ratingCount: 0,
  sessionsDone: 0,
  noShowCount: 0,
  haves: [{ skillId: 'python', level: 4 }],
  wants: [
    { skillId: 'spanish', currentLevel: 1, goalLevel: 3, priority: 'HIGH' },
  ],
  availability: [
    { dayOfWeek: 1, startMin: 1080, endMin: 1200 },
    { dayOfWeek: 6, startMin: 600, endMin: 720 },
  ],
  ...over,
});

/** Candidate: teaches Spanish (4), wants Python (1 -> 3, MEDIUM). Same city, same hours. */
const them = (over: Partial<Profile> = {}): Profile => ({
  ...me(),
  id: 'them',
  languages: ['English'],
  haves: [{ skillId: 'spanish', level: 4 }],
  wants: [
    { skillId: 'python', currentLevel: 1, goalLevel: 3, priority: 'MEDIUM' },
  ],
  ...over,
});

describe('scoreMatch', () => {
  it('weights add up to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores a perfect two-way swap between new users', () => {
    // 35 + 25 + 10 + 10 + 8 + 5*0.7 (one shared language) + 7*0.6 (new user) = 95.7
    const r = scoreMatch(me(), them(), noSimilarity)!;
    expect(r.score).toBe(96);
    expect(r.type).toBe('SWAP');
    expect(r.learnSkillId).toBe('spanish');
    expect(r.teachSkillId).toBe('python');
    expect(r.parts).toEqual({
      skill: 1,
      reciprocity: 1,
      priority: 1,
      availability: 1,
      mode: 1,
      language: 0.7,
      trust: 0.6,
    });
    expect(r.sharedLanguages).toEqual(['English']);
    expect(r.sharedHoursPerWeek).toBe(4);
    expect(r.sameCity).toBe(true);
  });

  it('is a CREDIT match when they want nothing I teach (reciprocity 0)', () => {
    const r = scoreMatch(
      me(),
      them({
        wants: [
          { skillId: 'guitar', currentLevel: 1, goalLevel: 3, priority: 'LOW' },
        ],
      }),
      noSimilarity,
    )!;
    expect(r.type).toBe('CREDIT');
    expect(r.teachSkillId).toBeNull();
    expect(r.parts.reciprocity).toBe(0);
    expect(r.score).toBe(71); // 95.7 - 25
  });

  it('level gap: a teacher only partly above me scores lower; not above me = no match', () => {
    const partial = scoreMatch(
      me(),
      them({ haves: [{ skillId: 'spanish', level: 2 }] }),
      noSimilarity,
    )!;
    expect(partial.parts.skill).toBe(0.5); // (2-1)/(3-1)
    expect(partial.score).toBe(78); // 95.7 - 35*0.5

    const same = scoreMatch(
      me(),
      them({ haves: [{ skillId: 'spanish', level: 1 }] }),
      noSimilarity,
    );
    expect(same).toBeNull(); // level 1 cannot teach someone already at level 1
  });

  it('hard filter: no shared language means no match (case-insensitive otherwise)', () => {
    expect(
      scoreMatch(me(), them({ languages: ['Tamil'] }), noSimilarity),
    ).toBeNull();
    expect(
      scoreMatch(me(), them({ languages: ['english'] }), noSimilarity),
    ).not.toBeNull();
  });

  it('two or more shared languages give the full language score', () => {
    const r = scoreMatch(
      me(),
      them({ languages: ['English', 'Hindi'] }),
      noSimilarity,
    )!;
    expect(r.parts.language).toBe(1);
    expect(r.score).toBe(97); // 95.7 + 5*0.3 = 97.2
  });

  it('availability: 4 h/week is full, 2 h is half, none is zero', () => {
    const half = scoreMatch(
      me(),
      them({ availability: [{ dayOfWeek: 1, startMin: 1080, endMin: 1200 }] }),
      noSimilarity,
    )!;
    expect(half.parts.availability).toBe(0.5);
    expect(half.score).toBe(91); // 95.7 - 5

    const none = scoreMatch(
      me(),
      them({ availability: [{ dayOfWeek: 3, startMin: 600, endMin: 660 }] }),
      noSimilarity,
    )!;
    expect(none.parts.availability).toBe(0);
    expect(none.score).toBe(86); // 95.7 - 10
  });

  it('mode: in person in different cities scores 0; online-capable pairs score 0.7', () => {
    const farInPerson = scoreMatch(
      me({ mode: 'IN_PERSON' }),
      them({ mode: 'IN_PERSON', city: 'Mumbai' }),
      noSimilarity,
    )!;
    expect(farInPerson.parts.mode).toBe(0);
    expect(farInPerson.sameCity).toBe(false);
    expect(farInPerson.score).toBe(88); // 95.7 - 8

    const bothOnline = scoreMatch(
      me({ mode: 'ONLINE' }),
      them({ city: 'Mumbai' }),
      noSimilarity,
    )!;
    expect(bothOnline.parts.mode).toBe(0.7);

    const online_vs_inPerson = scoreMatch(
      me({ mode: 'ONLINE' }),
      them({ mode: 'IN_PERSON' }),
      noSimilarity,
    )!;
    expect(online_vs_inPerson.parts.mode).toBe(0);
  });

  it('priority: a LOW-priority want contributes less than HIGH', () => {
    const low = scoreMatch(
      me({
        wants: [
          {
            skillId: 'spanish',
            currentLevel: 1,
            goalLevel: 3,
            priority: 'LOW',
          },
        ],
      }),
      them(),
      noSimilarity,
    )!;
    expect(low.parts.priority).toBe(0.3);
    expect(low.score).toBe(89); // 95.7 - 7
  });

  it('new user trust is 0.6; an established, reliable user scores higher', () => {
    const veteran = scoreMatch(
      me(),
      them({ ratingAvg: 5, ratingCount: 10, sessionsDone: 10 }),
      noSimilarity,
    )!;
    expect(veteran.parts.trust).toBe(1);
    expect(veteran.score).toBe(99); // 98.5

    const flaky = scoreMatch(
      me(),
      them({ ratingAvg: 5, ratingCount: 10, sessionsDone: 8, noShowCount: 2 }),
      noSimilarity,
    )!;
    expect(flaky.parts.trust).toBe(0.8);
    expect(flaky.score).toBe(97); // 97.1
  });

  it('uses skill similarity: a close skill counts, a distant one does not', () => {
    const closeSkill = them({ haves: [{ skillId: 'castellano', level: 4 }] });
    const close = scoreMatch(me(), closeSkill, (a, b) =>
      [a, b].sort().join() === 'castellano,spanish' ? 0.8 : 0,
    )!;
    expect(close.parts.skill).toBe(0.8);
    expect(close.learnSkillId).toBe('castellano');
    expect(close.score).toBe(89); // 95.7 - 35*0.2

    const far = scoreMatch(me(), closeSkill, () => 0.5);
    expect(far).toBeNull(); // below the 0.65 similarity threshold
  });

  it('picks the best-fitting skill when the candidate teaches several', () => {
    const r = scoreMatch(
      me(),
      them({
        haves: [
          { skillId: 'spanish', level: 2 }, // fit 0.5
          { skillId: 'spanish', level: 5 }, // fit 1
        ],
      }),
      noSimilarity,
    )!;
    expect(r.parts.skill).toBe(1);
  });

  it('is deterministic and always inside 0..100', () => {
    const a = scoreMatch(me(), them(), noSimilarity)!;
    const b = scoreMatch(me(), them(), noSimilarity)!;
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});

describe('helpers', () => {
  it('levelFit', () => {
    expect(levelFit(4, 1, 3)).toBe(1);
    expect(levelFit(3, 1, 3)).toBe(1);
    expect(levelFit(2, 1, 5)).toBe(0.4); // floor of 0.4 once the teacher helps at all
    expect(levelFit(1, 1, 3)).toBe(0);
    expect(levelFit(1, 2, 3)).toBe(0);
  });

  it('sharedHours only counts same-day overlap', () => {
    const a = [{ dayOfWeek: 1, startMin: 600, endMin: 720 }];
    expect(sharedHours(a, [{ dayOfWeek: 1, startMin: 660, endMin: 780 }])).toBe(
      1,
    );
    expect(sharedHours(a, [{ dayOfWeek: 2, startMin: 600, endMin: 720 }])).toBe(
      0,
    );
    expect(sharedHours(a, [{ dayOfWeek: 1, startMin: 720, endMin: 800 }])).toBe(
      0,
    ); // touching
  });

  it('trustScore: new = 0.6, rated = rating/5 times reliability', () => {
    expect(trustScore(me())).toBe(0.6);
    expect(
      trustScore(me({ ratingAvg: 4, ratingCount: 5, sessionsDone: 5 })),
    ).toBe(0.8);
    expect(trustScore(me({ sessionsDone: 3, noShowCount: 1 }))).toBeCloseTo(
      0.6 * 0.75,
    );
  });
});
