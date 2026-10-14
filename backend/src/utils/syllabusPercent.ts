/**
 * The one syllabus-completion formula used everywhere (syllabus page, oversight,
 * session plans, dashboards, tender salary).
 *
 * Every unit carries equal weight; inside a unit, each leaf sub-unit carries an
 * equal share of that unit. So 1 of 7 units done = 14.29%, no matter how many
 * sub-units each unit was broken into. (Counting raw leaves let one large unit
 * read as 30% of the subject.)
 *
 * Units with no leaves are ignored, as before.
 */
export interface UnitLeaf {
  /** Identifies the unit (topic) the leaf belongs to — unique across syllabi. */
  unitKey: string;
}

/** Fraction 0–1 of the syllabus covered by leaves matching `counts`. */
export const unitWeightedFraction = <T extends UnitLeaf>(
  leaves: readonly T[],
  counts: (leaf: T) => boolean
): number => {
  const byUnit = new Map<string, { total: number; done: number }>();
  for (const leaf of leaves) {
    const bucket = byUnit.get(leaf.unitKey) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (counts(leaf)) bucket.done += 1;
    byUnit.set(leaf.unitKey, bucket);
  }
  if (byUnit.size === 0) return 0;
  let sum = 0;
  for (const { total, done } of byUnit.values()) sum += done / total;
  return sum / byUnit.size;
};

/** Same as {@link unitWeightedFraction}, from per-unit counts already tallied. */
export const unitWeightedFractionFromCounts = (
  units: ReadonlyArray<{ total: number; done: number }>
): number => {
  const withLeaves = units.filter((unit) => unit.total > 0);
  if (withLeaves.length === 0) return 0;
  return withLeaves.reduce((sum, unit) => sum + unit.done / unit.total, 0) / withLeaves.length;
};
