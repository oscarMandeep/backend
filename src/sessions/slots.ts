/**
 * Suggested session times: the overlap of two people's weekly availability.
 * Pure functions (no I/O). Everything in the middle is epoch milliseconds, so
 * time zones only matter at the edges, when weekly "Monday 18:00" slots are
 * turned into real moments in time.
 */
export interface Interval {
  start: number; // epoch ms, inclusive
  end: number; // epoch ms, exclusive
}

export interface WeeklySlot {
  dayOfWeek: number; // 0 = Sunday
  startMin: number; // minutes from local midnight
  endMin: number;
}

export interface Person {
  timeZone: string;
  slots: WeeklySlot[];
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** local time minus UTC, at the given instant, for the zone (DST aware). */
function offsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads `y-m-d` + `minutes`. */
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  minutes: number,
  timeZone: string,
): number {
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes: the offset at the guess can differ from the offset at the answer around DST changes.
  const first = naive - offsetMs(timeZone, naive);
  return naive - offsetMs(timeZone, first);
}

/** The calendar date (and weekday) in `timeZone` at a given instant. */
function localDate(timeZone: string, utcMs: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Weekly slots -> concrete intervals between `from` and `to`, in the person's own zone. */
export function expandAvailability(
  person: Person,
  from: number,
  to: number,
): Interval[] {
  const start = localDate(person.timeZone, from);
  const out: Interval[] = [];
  const days = Math.ceil((to - from) / DAY) + 2; // a day of slack on each side, clipped below
  for (let offset = -1; offset < days; offset++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + offset));
    const [y, m, d, dow] = [
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      day.getUTCDay(),
    ];
    for (const slot of person.slots) {
      if (slot.dayOfWeek !== dow) continue;
      out.push({
        start: Math.max(
          from,
          zonedToUtc(y, m, d, slot.startMin, person.timeZone),
        ),
        end: Math.min(to, zonedToUtc(y, m, d, slot.endMin, person.timeZone)),
      });
    }
  }
  return mergeIntervals(out);
}

/** Overlap of two sorted, merged interval lists. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

/** Removes the busy periods from the free intervals. */
export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  let result = free;
  for (const b of mergeIntervals(busy)) {
    result = result.flatMap((f) => {
      if (b.end <= f.start || b.start >= f.end) return [f];
      const pieces: Interval[] = [];
      if (b.start > f.start) pieces.push({ start: f.start, end: b.start });
      if (b.end < f.end) pieces.push({ start: b.end, end: f.end });
      return pieces;
    });
  }
  return result;
}

export interface FindSlotsInput {
  a: Person;
  b: Person;
  /** Existing PROPOSED/CONFIRMED sessions of either person. */
  busy: Interval[];
  now: number;
  days: number;
  durationMin: number;
  /** Start times fall on multiples of this many minutes (UTC). */
  stepMin?: number;
  /** Do not suggest anything starting sooner than this many minutes from now. */
  leadMin?: number;
  limit?: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export function findCommonSlots(input: FindSlotsInput): Slot[] {
  const {
    a,
    b,
    busy,
    now,
    days,
    durationMin,
    stepMin = 30,
    leadMin = 60,
    limit = 60,
  } = input;
  const earliest = now + leadMin * MIN;
  const horizon = now + days * DAY;
  const free = subtract(
    intersect(
      expandAvailability(a, now, horizon),
      expandAvailability(b, now, horizon),
    ),
    busy,
  );

  const step = stepMin * MIN;
  const length = durationMin * MIN;
  const slots: Slot[] = [];
  for (const interval of free) {
    let start = Math.ceil(Math.max(interval.start, earliest) / step) * step;
    for (; start + length <= interval.end; start += step) {
      slots.push({
        startsAt: new Date(start),
        endsAt: new Date(start + length),
      });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}
