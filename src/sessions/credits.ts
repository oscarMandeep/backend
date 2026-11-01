/** One credit per started hour of teaching: 30 min or 60 min = 1, 90 min = 2. */
export function creditCost(durationMin: number): number {
  return Math.max(1, Math.ceil(durationMin / 60));
}
