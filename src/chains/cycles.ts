/**
 * Pure helpers for swap-chain loops (no I/O).
 *
 * The recursive SQL returns a loop as `path` (users, first = last) and `skills`
 * (skills[i] = what path[i] teaches path[i+1]). Every member finds the same loop
 * starting from themselves, so the same loop arrives as several rotations.
 */
export interface Loop {
  /** Users in order; member i teaches `teaches[i]` to member i+1 (the last teaches the first). */
  members: string[];
  teaches: string[];
}

/** Drops the repeated closing user and rotates so the smallest user id comes first. */
export function toLoop(path: string[], skills: string[]): Loop {
  const members =
    path.length > 1 && path[0] === path[path.length - 1]
      ? path.slice(0, -1)
      : [...path];
  if (skills.length !== members.length) {
    throw new Error(
      `a loop of ${members.length} people needs ${members.length} skills, got ${skills.length}`,
    );
  }
  const start = members.indexOf([...members].sort()[0]);
  const rotate = <T>(list: T[]) => [
    ...list.slice(start),
    ...list.slice(0, start),
  ];
  return { members: rotate(members), teaches: rotate(skills) };
}

/** The same loop however it was found: used to avoid proposing it twice. */
export function loopKey(loop: Loop): string {
  return loop.members.map((m, i) => `${m}>${loop.teaches[i]}`).join('|');
}

export function sameMembers(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** Every unordered pair of members, which is who could directly swap or have blocked each other. */
export function pairsOf<T>(items: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]);
  }
  return pairs;
}

/** Collapses the rotations of the same loop into one, keeping the order found. */
export function uniqueLoops(
  rows: { path: string[]; skills: string[] }[],
): Loop[] {
  const seen = new Set<string>();
  const out: Loop[] = [];
  for (const row of rows) {
    const loop = toLoop(row.path, row.skills);
    const key = loopKey(loop);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(loop);
    }
  }
  return out;
}

export const meanScore = (scores: readonly number[]): number =>
  scores.length === 0
    ? 0
    : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
