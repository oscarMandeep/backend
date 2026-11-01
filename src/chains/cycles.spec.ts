import {
  loopKey,
  meanScore,
  pairsOf,
  sameMembers,
  toLoop,
  uniqueLoops,
} from './cycles';

describe('toLoop', () => {
  it('drops the closing user and rotates so the smallest id is first', () => {
    // b teaches y to c, c teaches z to a, a teaches x to b
    const loop = toLoop(['b', 'c', 'a', 'b'], ['y', 'z', 'x']);
    expect(loop).toEqual({
      members: ['a', 'b', 'c'],
      teaches: ['x', 'y', 'z'],
    });
  });

  it('keeps who teaches what to whom, whichever member the search started from', () => {
    const fromA = toLoop(['a', 'b', 'c', 'a'], ['x', 'y', 'z']);
    const fromB = toLoop(['b', 'c', 'a', 'b'], ['y', 'z', 'x']);
    const fromC = toLoop(['c', 'a', 'b', 'c'], ['z', 'x', 'y']);
    expect(fromB).toEqual(fromA);
    expect(fromC).toEqual(fromA);
  });

  it('handles four people', () => {
    expect(toLoop(['d', 'a', 'c', 'b', 'd'], ['1', '2', '3', '4'])).toEqual({
      members: ['a', 'c', 'b', 'd'],
      teaches: ['2', '3', '4', '1'],
    });
  });

  it('refuses mismatched input', () => {
    expect(() => toLoop(['a', 'b', 'c', 'a'], ['x', 'y'])).toThrow();
  });
});

describe('loop identity', () => {
  it('uniqueLoops collapses the rotations that every member finds', () => {
    const rows = [
      { path: ['a', 'b', 'c', 'a'], skills: ['x', 'y', 'z'] },
      { path: ['b', 'c', 'a', 'b'], skills: ['y', 'z', 'x'] },
      { path: ['c', 'a', 'b', 'c'], skills: ['z', 'x', 'y'] },
    ];
    expect(uniqueLoops(rows)).toHaveLength(1);
  });

  it('the same people with different skills are different loops', () => {
    const rows = [
      { path: ['a', 'b', 'c', 'a'], skills: ['x', 'y', 'z'] },
      { path: ['a', 'b', 'c', 'a'], skills: ['x', 'y', 'w'] },
    ];
    expect(uniqueLoops(rows)).toHaveLength(2);
    expect(loopKey(toLoop(rows[0].path, rows[0].skills))).not.toBe(
      loopKey(toLoop(rows[1].path, rows[1].skills)),
    );
  });

  it('sameMembers ignores order', () => {
    expect(sameMembers(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(sameMembers(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false);
    expect(sameMembers(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });
});

describe('helpers', () => {
  it('pairsOf lists every unordered pair', () => {
    expect(pairsOf(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
    expect(pairsOf(['a', 'b', 'c', 'd'])).toHaveLength(6);
    expect(pairsOf(['a'])).toEqual([]);
  });

  it('meanScore rounds the average and copes with nothing', () => {
    expect(meanScore([80, 90, 71])).toBe(80);
    expect(meanScore([])).toBe(0);
  });
});
