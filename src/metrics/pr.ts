/**
 * Personal record detection.
 *
 * WHY computed from set history rather than stored: a stored PR is a cache, and
 * a cache can disagree with the log it summarises. Editing or deleting a
 * mislogged set has to move the PR with it, which a materialised row will not do
 * unless something remembers to recompute it. This is cheap enough to derive.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 */
import { compareDates } from './dates';
import { setE1rm } from './e1rm';
import type { LocalDate, SetRecord } from './types';

export interface ExerciseBests {
  exerciseId: string;
  /** Best estimated 1RM, null when no set qualified (see e1rm.ts). */
  bestE1rm: number | null;
  bestE1rmDate: LocalDate | null;
  /** Heaviest load moved for at least one rep. */
  bestWeightKg: number | null;
  bestWeightDate: LocalDate | null;
  /** Heaviest load per rep count, e.g. best 5-rep set. */
  bestWeightByReps: Map<number, number>;
}

export type PrKind = 'e1rm' | 'weight' | 'reps-at-weight';

export interface PrEvent {
  exerciseId: string;
  kind: PrKind;
  localDate: LocalDate;
  value: number;
  /** The record this beat, or null if it is the first qualifying set. */
  previous: number | null;
}

function qualifies(set: SetRecord): boolean {
  // Warmups never set records — see e1rm.ts for why that matters.
  if (set.isWarmup) return false;
  if (set.weightKg === null || set.reps === null) return false;
  return set.weightKg > 0 && set.reps > 0;
}

/** Bests per exercise across the whole history supplied. */
export function exerciseBests(sets: readonly SetRecord[]): Map<string, ExerciseBests> {
  const bests = new Map<string, ExerciseBests>();

  for (const set of sets) {
    if (!qualifies(set)) continue;

    let entry = bests.get(set.exerciseId);
    if (!entry) {
      entry = {
        exerciseId: set.exerciseId,
        bestE1rm: null,
        bestE1rmDate: null,
        bestWeightKg: null,
        bestWeightDate: null,
        bestWeightByReps: new Map(),
      };
      bests.set(set.exerciseId, entry);
    }

    const estimate = setE1rm(set);
    if (estimate !== null && (entry.bestE1rm === null || estimate > entry.bestE1rm)) {
      entry.bestE1rm = estimate;
      entry.bestE1rmDate = set.localDate;
    }

    const weight = set.weightKg!;
    if (entry.bestWeightKg === null || weight > entry.bestWeightKg) {
      entry.bestWeightKg = weight;
      entry.bestWeightDate = set.localDate;
    }

    const reps = set.reps!;
    const bestAtReps = entry.bestWeightByReps.get(reps);
    if (bestAtReps === undefined || weight > bestAtReps) {
      entry.bestWeightByReps.set(reps, weight);
    }
  }

  return bests;
}

/**
 * Replays history in date order and emits a PR event the first time each record
 * is beaten.
 *
 * WHY a replay rather than comparing against current bests: this is what lets a
 * badge fire on the day it was earned, and what makes phase 5's calendar
 * achievements testable against a seeded history.
 */
export function detectPrs(sets: readonly SetRecord[]): PrEvent[] {
  const ordered = [...sets]
    .filter(qualifies)
    .sort((a, b) => compareDates(a.localDate, b.localDate));

  const bestE1rmSoFar = new Map<string, number>();
  const bestWeightSoFar = new Map<string, number>();
  const bestByReps = new Map<string, Map<number, number>>();
  const events: PrEvent[] = [];

  for (const set of ordered) {
    const { exerciseId, localDate } = set;
    const weight = set.weightKg!;
    const reps = set.reps!;

    const estimate = setE1rm(set);
    if (estimate !== null) {
      const previous = bestE1rmSoFar.get(exerciseId) ?? null;
      if (previous === null || estimate > previous) {
        bestE1rmSoFar.set(exerciseId, estimate);
        events.push({ exerciseId, kind: 'e1rm', localDate, value: estimate, previous });
      }
    }

    const previousWeight = bestWeightSoFar.get(exerciseId) ?? null;
    if (previousWeight === null || weight > previousWeight) {
      bestWeightSoFar.set(exerciseId, weight);
      events.push({
        exerciseId,
        kind: 'weight',
        localDate,
        value: weight,
        previous: previousWeight,
      });
    }

    let repMap = bestByReps.get(exerciseId);
    if (!repMap) {
      repMap = new Map();
      bestByReps.set(exerciseId, repMap);
    }
    const previousAtReps = repMap.get(reps) ?? null;
    if (previousAtReps === null || weight > previousAtReps) {
      repMap.set(reps, weight);
      // Only a genuine improvement counts; the first set at a new rep count is
      // already covered by the weight record above.
      if (previousAtReps !== null) {
        events.push({
          exerciseId,
          kind: 'reps-at-weight',
          localDate,
          value: weight,
          previous: previousAtReps,
        });
      }
    }
  }

  return events;
}
