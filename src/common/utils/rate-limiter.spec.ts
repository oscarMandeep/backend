import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  let time = 0;
  const make = (limit = 3, windowMs = 1000) =>
    new RateLimiter(limit, windowMs, () => time);
  beforeEach(() => {
    time = 0;
  });

  it('allows up to the limit, then blocks', () => {
    const rl = make();
    expect([1, 2, 3, 4].map(() => rl.consume('u'))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('is a sliding window: old hits expire one by one', () => {
    const rl = make();
    time = 0;
    rl.consume('u');
    time = 400;
    rl.consume('u');
    time = 800;
    rl.consume('u');
    time = 900;
    expect(rl.consume('u')).toBe(false);
    time = 1000; // the hit at t=0 is now outside the window
    expect(rl.consume('u')).toBe(true);
    expect(rl.consume('u')).toBe(false);
  });

  it('blocked calls do not extend the block', () => {
    const rl = make(1, 1000);
    rl.consume('u');
    time = 500;
    expect(rl.consume('u')).toBe(false);
    time = 1001;
    expect(rl.consume('u')).toBe(true);
  });

  it('keys are independent', () => {
    const rl = make(1);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('b')).toBe(true);
    expect(rl.consume('a')).toBe(false);
  });

  it('prune forgets expired keys', () => {
    const rl = make();
    rl.consume('a');
    rl.consume('b');
    expect(rl.size).toBe(2);
    time = 5000;
    rl.prune();
    expect(rl.size).toBe(0);
  });
});
