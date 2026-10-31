import { buildReasons } from './reasons';

const base = {
  learnSkillName: 'Excel',
  teachSkillName: 'English',
  sharedHoursPerWeek: 6,
  sameCity: true,
  city: 'Haridwar',
  sharedLanguages: ['English', 'Hindi', 'Tamil'],
};

describe('buildReasons', () => {
  it('lists every reason for a rich match', () => {
    expect(buildReasons(base)).toEqual([
      'Teaches Excel (you want)',
      'Wants English (you teach)',
      '6 shared hrs/week',
      'Both in Haridwar',
      'Both speak English and Hindi',
    ]);
  });

  it('leaves out what does not apply', () => {
    expect(
      buildReasons({
        ...base,
        teachSkillName: null,
        sharedHoursPerWeek: 0,
        sameCity: false,
        sharedLanguages: [],
      }),
    ).toEqual(['Teaches Excel (you want)']);
  });

  it('formats hours: singular and one decimal', () => {
    expect(buildReasons({ ...base, sharedHoursPerWeek: 1 })).toContain(
      '1 shared hr/week',
    );
    expect(buildReasons({ ...base, sharedHoursPerWeek: 2.54 })).toContain(
      '2.5 shared hrs/week',
    );
  });
});
