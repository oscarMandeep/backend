import type { AvailabilitySlotDto } from './dto/me.dto';

/** Returns human-readable problems; empty when the slots are valid. */
export function findSlotProblems(
  slots: readonly AvailabilitySlotDto[],
): string[] {
  const problems: string[] = [];
  slots.forEach((s, i) => {
    if (s.startMin >= s.endMin)
      problems.push(`slot ${i + 1}: start must be before end`);
  });
  for (let day = 0; day <= 6; day++) {
    const sorted = slots
      .filter((s) => s.dayOfWeek === day && s.startMin < s.endMin)
      .sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startMin < sorted[i - 1].endMin) {
        problems.push(`day ${day}: slots overlap`);
        break;
      }
    }
  }
  return problems;
}
