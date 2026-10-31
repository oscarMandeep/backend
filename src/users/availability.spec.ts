import { findSlotProblems } from './availability';

const slot = (dayOfWeek: number, startMin: number, endMin: number) => ({
  dayOfWeek,
  startMin,
  endMin,
});

describe('findSlotProblems', () => {
  it('accepts separate and back-to-back slots', () => {
    expect(
      findSlotProblems([
        slot(1, 600, 660),
        slot(1, 660, 720),
        slot(2, 600, 720),
      ]),
    ).toEqual([]);
  });

  it('rejects overlapping slots on the same day only', () => {
    expect(findSlotProblems([slot(1, 600, 700), slot(1, 650, 720)])).toEqual([
      'day 1: slots overlap',
    ]);
    expect(findSlotProblems([slot(1, 600, 700), slot(2, 650, 720)])).toEqual(
      [],
    );
  });

  it('rejects start >= end', () => {
    expect(findSlotProblems([slot(1, 700, 700)])).toEqual([
      'slot 1: start must be before end',
    ]);
    expect(findSlotProblems([slot(1, 800, 700)])).toHaveLength(1);
  });
});
