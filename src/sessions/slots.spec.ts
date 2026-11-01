import {
  expandAvailability,
  findCommonSlots,
  intersect,
  mergeIntervals,
  subtract,
  zonedToUtc,
  type Person,
} from './slots';
import { creditCost } from './credits';

const utc = (iso: string) => Date.parse(iso);
const iv = (a: string, b: string) => ({ start: utc(a), end: utc(b) });
const show = (list: { start: number; end: number }[]) =>
  list.map(
    (i) =>
      `${new Date(i.start).toISOString().slice(0, 16)}→${new Date(i.end).toISOString().slice(11, 16)}`,
  );

describe('creditCost', () => {
  it.each([
    [15, 1],
    [30, 1],
    [60, 1],
    [61, 2],
    [90, 2],
    [120, 2],
    [180, 3],
  ])('%i min costs %i credit(s)', (min, credits) => {
    expect(creditCost(min)).toBe(credits);
  });
});

describe('zonedToUtc', () => {
  it('converts a fixed-offset zone (India is UTC+5:30, no DST)', () => {
    expect(
      new Date(zonedToUtc(2031, 1, 6, 18 * 60, 'Asia/Kolkata')).toISOString(),
    ).toBe('2031-01-06T12:30:00.000Z');
  });

  it('London: UTC in winter, UTC+1 in summer', () => {
    expect(
      new Date(zonedToUtc(2031, 1, 6, 12 * 60, 'Europe/London')).toISOString(),
    ).toBe('2031-01-06T12:00:00.000Z');
    expect(
      new Date(zonedToUtc(2031, 7, 7, 12 * 60, 'Europe/London')).toISOString(),
    ).toBe('2031-07-07T11:00:00.000Z');
  });

  it('is right on both sides of a DST change (New York, 9 March 2031)', () => {
    // clocks jump from 02:00 to 03:00 that morning: 01:00 is still EST (-5), 04:00 is EDT (-4)
    expect(
      new Date(zonedToUtc(2031, 3, 9, 60, 'America/New_York')).toISOString(),
    ).toBe('2031-03-09T06:00:00.000Z');
    expect(
      new Date(
        zonedToUtc(2031, 3, 9, 4 * 60, 'America/New_York'),
      ).toISOString(),
    ).toBe('2031-03-09T08:00:00.000Z');
  });
});

describe('interval helpers', () => {
  it('mergeIntervals joins overlapping and touching intervals', () => {
    expect(
      show(
        mergeIntervals([
          iv('2031-01-01T10:00Z', '2031-01-01T11:00Z'),
          iv('2031-01-01T11:00Z', '2031-01-01T12:00Z'),
          iv('2031-01-01T14:00Z', '2031-01-01T15:00Z'),
        ]),
      ),
    ).toEqual(['2031-01-01T10:00→12:00', '2031-01-01T14:00→15:00']);
  });

  it('intersect keeps only the overlap', () => {
    const a = [
      iv('2031-01-01T10:00Z', '2031-01-01T12:00Z'),
      iv('2031-01-01T14:00Z', '2031-01-01T16:00Z'),
    ];
    const b = [iv('2031-01-01T11:00Z', '2031-01-01T15:00Z')];
    expect(show(intersect(a, b))).toEqual([
      '2031-01-01T11:00→12:00',
      '2031-01-01T14:00→15:00',
    ]);
  });

  it('subtract cuts busy periods out (middle, edge, outside)', () => {
    const free = [iv('2031-01-01T10:00Z', '2031-01-01T14:00Z')];
    expect(
      show(subtract(free, [iv('2031-01-01T11:00Z', '2031-01-01T12:00Z')])),
    ).toEqual(['2031-01-01T10:00→11:00', '2031-01-01T12:00→14:00']);
    expect(
      show(subtract(free, [iv('2031-01-01T09:00Z', '2031-01-01T11:00Z')])),
    ).toEqual(['2031-01-01T11:00→14:00']);
    expect(
      subtract(free, [iv('2031-01-02T09:00Z', '2031-01-02T11:00Z')]),
    ).toEqual(free);
    expect(
      subtract(free, [iv('2031-01-01T09:00Z', '2031-01-01T15:00Z')]),
    ).toEqual([]);
  });
});

describe('expandAvailability', () => {
  const india: Person = {
    timeZone: 'Asia/Kolkata',
    slots: [{ dayOfWeek: 1, startMin: 18 * 60, endMin: 20 * 60 }],
  };

  it('puts weekly slots on the right dates, one per week', () => {
    // Mon 2031-01-06 and Mon 2031-01-13, 18:00-20:00 IST = 12:30-14:30 UTC
    const out = expandAvailability(
      india,
      utc('2031-01-01T00:00Z'),
      utc('2031-01-15T00:00Z'),
    );
    expect(show(out)).toEqual([
      '2031-01-06T12:30→14:30',
      '2031-01-13T12:30→14:30',
    ]);
  });

  it("uses the person's LOCAL date, not the UTC date", () => {
    // 2031-01-05 20:00 UTC is already Monday 01:30 in India, so Monday's slot is still ahead
    const out = expandAvailability(
      india,
      utc('2031-01-05T20:00Z'),
      utc('2031-01-07T00:00Z'),
    );
    expect(show(out)).toEqual(['2031-01-06T12:30→14:30']);
  });

  it('clips to the requested window', () => {
    const out = expandAvailability(
      india,
      utc('2031-01-06T13:00Z'),
      utc('2031-01-06T14:00Z'),
    );
    expect(show(out)).toEqual(['2031-01-06T13:00→14:00']);
  });
});

describe('findCommonSlots', () => {
  const india: Person = {
    timeZone: 'Asia/Kolkata',
    slots: [{ dayOfWeek: 1, startMin: 18 * 60, endMin: 20 * 60 }],
  };
  const london: Person = {
    timeZone: 'Europe/London',
    slots: [{ dayOfWeek: 1, startMin: 12 * 60, endMin: 14 * 60 }],
  };
  const base = {
    a: india,
    b: london,
    busy: [],
    now: utc('2031-01-01T00:00Z'),
    days: 7,
    durationMin: 60,
  };

  it('finds the overlap across time zones (12:30-14:00 UTC) on a 30-minute grid', () => {
    const slots = findCommonSlots(base);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2031-01-06T12:30:00.000Z',
      '2031-01-06T13:00:00.000Z',
    ]);
    expect(slots[0].endsAt.toISOString()).toBe('2031-01-06T13:30:00.000Z');
  });

  it('a shorter session fits more starts; a longer one may not fit at all', () => {
    expect(findCommonSlots({ ...base, durationMin: 30 })).toHaveLength(3);
    expect(findCommonSlots({ ...base, durationMin: 120 })).toEqual([]);
  });

  it('existing sessions of either person remove the time', () => {
    const busy = [iv('2031-01-06T13:00Z', '2031-01-06T14:00Z')];
    expect(findCommonSlots({ ...base, busy })).toEqual([]); // only 12:30-13:00 is left
    expect(
      findCommonSlots({ ...base, busy, durationMin: 30 }).map((s) =>
        s.startsAt.toISOString(),
      ),
    ).toEqual(['2031-01-06T12:30:00.000Z']);
  });

  it('never suggests times that start sooner than the lead time', () => {
    const slots = findCommonSlots({ ...base, now: utc('2031-01-06T12:10Z') }); // lead 60 min -> 13:10
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([]);
    const lenient = findCommonSlots({
      ...base,
      now: utc('2031-01-06T12:10Z'),
      leadMin: 0,
      durationMin: 30,
    });
    expect(lenient[0].startsAt.toISOString()).toBe('2031-01-06T12:30:00.000Z');
  });

  it('respects the horizon and the limit, and handles people with no availability', () => {
    expect(findCommonSlots({ ...base, days: 3 })).toEqual([]); // Monday is 5 days away
    expect(
      findCommonSlots({ ...base, durationMin: 30, limit: 2 }),
    ).toHaveLength(2);
    expect(
      findCommonSlots({ ...base, a: { timeZone: 'Asia/Kolkata', slots: [] } }),
    ).toEqual([]);
  });
});
