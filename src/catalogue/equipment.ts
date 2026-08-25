/**
 * Canonical equipment vocabulary.
 *
 * INVARIANT: the planner selects only from a pre-filtered candidate list, and
 *            the filtering happens in SQL — CLAUDE.md #5. That join is only
 *            sound if two sources calling the same object different names end up
 *            on the same tag, which is what this file is for.
 *
 * WHY a lookup table rather than string munging: `e-z curl bar` and `SZ-Bar` are
 *      the same steel. No normalisation function derives that; only a mapping
 *      does. Adding a second source is then a data change, not a code change.
 */

export const EQUIPMENT_TAGS = [
  { slug: 'barbell', name: 'Barbell' },
  { slug: 'dumbbell', name: 'Dumbbell' },
  { slug: 'kettlebell', name: 'Kettlebell' },
  { slug: 'ez-bar', name: 'EZ curl bar' },
  { slug: 'cable-machine', name: 'Cable machine' },
  { slug: 'machine', name: 'Machine' },
  { slug: 'resistance-band', name: 'Resistance band' },
  { slug: 'medicine-ball', name: 'Medicine ball' },
  { slug: 'stability-ball', name: 'Stability ball' },
  { slug: 'foam-roller', name: 'Foam roller' },
  { slug: 'bodyweight', name: 'Bodyweight' },
  { slug: 'other', name: 'Other' },
] as const;

export type EquipmentSlug = (typeof EQUIPMENT_TAGS)[number]['slug'];

const VALID: ReadonlySet<string> = new Set(EQUIPMENT_TAGS.map((t) => t.slug));

/**
 * Source vocabulary → canonical slug.
 *
 * Free Exercise DB uses the lowercase forms. The capitalised entries are wger's
 * names, pre-registered so phase 5 can add that source without touching this
 * logic — they map onto tags that already exist rather than inventing new ones.
 *
 * AI-NOTE: keys are compared lowercased and trimmed. A source value with no
 *          entry here falls back to 'other' and is reported by the ingest script
 *          rather than silently swallowed — an unmapped value means a real piece
 *          of equipment has become invisible to the planner's filter.
 */
export const EQUIPMENT_ALIASES: Readonly<Record<string, EquipmentSlug>> = {
  // Free Exercise DB
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  'e-z curl bar': 'ez-bar',
  cable: 'cable-machine',
  machine: 'machine',
  bands: 'resistance-band',
  'medicine ball': 'medicine-ball',
  'exercise ball': 'stability-ball',
  'foam roll': 'foam-roller',
  'body only': 'bodyweight',
  other: 'other',

  // wger aliases for the same objects.
  'sz-bar': 'ez-bar',
  'swiss ball': 'stability-ball',
  'resistance band': 'resistance-band',
  'cable machine': 'cable-machine',
  kettlebell: 'kettlebell',
  'none (bodyweight exercise)': 'bodyweight',
  'gym mat': 'other',
};

export function isEquipmentSlug(value: string): value is EquipmentSlug {
  return VALID.has(value);
}

/**
 * WHY null input maps to bodyweight rather than 'other': 77 Free Exercise DB
 * records omit equipment, and inspection shows they are overwhelmingly unloaded
 * movements. 'other' would hide them from every equipment filter, so a
 * home-gym user would lose exercises they can actually do.
 */
export function normaliseEquipment(raw: string | null | undefined): EquipmentSlug {
  if (raw === null || raw === undefined || raw.trim() === '') return 'bodyweight';
  return EQUIPMENT_ALIASES[raw.trim().toLowerCase()] ?? 'other';
}

/** True when the source value had no mapping, for the ingest script to report. */
export function isUnmappedEquipment(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined || raw.trim() === '') return false;
  return EQUIPMENT_ALIASES[raw.trim().toLowerCase()] === undefined;
}
