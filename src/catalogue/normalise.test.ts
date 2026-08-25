import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_TAGS,
  isEquipmentSlug,
  isUnmappedEquipment,
  normaliseEquipment,
} from './equipment';
import {
  deriveIsUnilateral,
  deriveMovementPattern,
  normaliseAll,
  normaliseExercise,
  slugify,
  type SourceExercise,
} from './normalise';

const source = (over: Partial<SourceExercise> = {}): SourceExercise => ({
  id: 'Barbell_Squat',
  name: 'Barbell Squat',
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  equipment: 'barbell',
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: ['glutes', 'hamstrings'],
  instructions: ['Step one.', 'Step two.'],
  category: 'strength',
  ...over,
});

describe('equipment normalisation', () => {
  it('maps every canonical slug to itself being valid', () => {
    for (const tag of EQUIPMENT_TAGS) expect(isEquipmentSlug(tag.slug)).toBe(true);
    expect(isEquipmentSlug('trebuchet')).toBe(false);
  });

  it('collapses two source names for the same object onto one tag', () => {
    // The whole reason this file exists — no string function derives this.
    expect(normaliseEquipment('e-z curl bar')).toBe('ez-bar');
    expect(normaliseEquipment('SZ-Bar')).toBe('ez-bar');
    expect(normaliseEquipment('exercise ball')).toBe('stability-ball');
    expect(normaliseEquipment('Swiss Ball')).toBe('stability-ball');
    expect(normaliseEquipment('bands')).toBe('resistance-band');
    expect(normaliseEquipment('Resistance band')).toBe('resistance-band');
    expect(normaliseEquipment('kettlebells')).toBe('kettlebell');
  });

  it('is case and whitespace insensitive', () => {
    expect(normaliseEquipment('  BARBELL  ')).toBe('barbell');
  });

  it('treats a missing value as bodyweight, not other', () => {
    // WHY: 77 source records omit equipment and are mostly unloaded work.
    //      'other' would hide them from every equipment filter.
    expect(normaliseEquipment(null)).toBe('bodyweight');
    expect(normaliseEquipment(undefined)).toBe('bodyweight');
    expect(normaliseEquipment('')).toBe('bodyweight');
    expect(normaliseEquipment('body only')).toBe('bodyweight');
  });

  it('falls back to other for an unknown value and flags it', () => {
    expect(normaliseEquipment('hack squat sled')).toBe('other');
    expect(isUnmappedEquipment('hack squat sled')).toBe(true);
    expect(isUnmappedEquipment('barbell')).toBe(false);
    // A blank is a known absence, not an unmapped value.
    expect(isUnmappedEquipment(null)).toBe(false);
  });
});

describe('slugify', () => {
  it('produces stable lowercase slugs', () => {
    expect(slugify('Barbell Squat')).toBe('barbell-squat');
    expect(slugify("Farmer's Walk")).toBe('farmer-s-walk');
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
    expect(slugify('E-Z Curl Bar Curl')).toBe('e-z-curl-bar-curl');
  });
});

describe('deriveMovementPattern', () => {
  it('labels the compound lifts the planner actually programmes', () => {
    // Both of these are "push, compound" in the source; only the name separates them.
    expect(deriveMovementPattern(source({ name: 'Barbell Squat' }))).toBe('squat');
    expect(
      deriveMovementPattern(source({ name: 'Overhead Press', primaryMuscles: ['shoulders'] }))
    ).toBe('push');
  });

  it('recognises hinge, carry and squat families', () => {
    const cases: [string, string][] = [
      ['Romanian Deadlift', 'hinge'],
      ['Kettlebell Swing', 'hinge'],
      ['Barbell Hip Thrust', 'hinge'],
      ['Front Squat', 'squat'],
      ['Walking Lunge', 'squat'],
      ['Leg Press', 'squat'],
      ["Farmer's Walk", 'carry'],
      ['Suitcase Carry', 'carry'],
    ];
    for (const [name, expected] of cases) {
      expect(deriveMovementPattern(source({ name })), name).toBe(expected);
    }
  });

  it('resolves a name that mentions two patterns in favour of squat', () => {
    // Regression: 'Front Squat (Clean Grip)' matched the olympic keyword first
    // and came out 'hinge'. Squat has to win when a name says both.
    expect(deriveMovementPattern(source({ name: 'Front Squat (Clean Grip)' }))).toBe('squat');
    expect(deriveMovementPattern(source({ name: 'Squat Clean' }))).toBe('squat');
    // A name with only the olympic keyword is still a hinge.
    expect(deriveMovementPattern(source({ name: 'Hang Clean' }))).toBe('hinge');
    expect(deriveMovementPattern(source({ name: 'Snatch Deadlift' }))).toBe('hinge');
  });

  it('treats abdominal work as core regardless of force', () => {
    expect(
      deriveMovementPattern(
        source({ name: 'Crunch', primaryMuscles: ['abdominals'], force: 'pull' })
      )
    ).toBe('core');
  });

  it('falls back to mechanic then force', () => {
    expect(
      deriveMovementPattern(
        source({ name: 'Bicep Curl', mechanic: 'isolation', primaryMuscles: ['biceps'] })
      )
    ).toBe('isolation');
    expect(
      deriveMovementPattern(
        source({
          name: 'Bent Over Row',
          force: 'pull',
          mechanic: 'compound',
          primaryMuscles: ['lats'],
        })
      )
    ).toBe('pull');
  });

  it('returns null rather than guessing on a static movement', () => {
    // WHY: a stretch mislabelled 'push' becomes a candidate on a pressing day.
    expect(
      deriveMovementPattern(
        source({
          name: 'Calf Stretch',
          force: 'static',
          mechanic: null,
          primaryMuscles: ['calves'],
        })
      )
    ).toBeNull();
  });

  it('only emits values the exercises CHECK constraint accepts', () => {
    const allowed = new Set(['push', 'pull', 'squat', 'hinge', 'carry', 'core', 'isolation']);
    const names = ['Barbell Squat', 'Deadlift', 'Crunch', 'Bicep Curl', 'Row', 'Yoke Walk'];
    for (const name of names) {
      const pattern = deriveMovementPattern(source({ name }));
      if (pattern !== null) expect(allowed.has(pattern), `${name} → ${pattern}`).toBe(true);
    }
  });
});

describe('deriveIsUnilateral', () => {
  it('detects single-side movements', () => {
    for (const name of [
      'Single-Arm Dumbbell Row',
      'One Arm Kettlebell Press',
      'Walking Lunge',
      'Bulgarian Split Squat',
      'Alternating Curl',
    ]) {
      expect(deriveIsUnilateral(name), name).toBe(true);
    }
  });

  it('leaves bilateral movements alone', () => {
    for (const name of ['Barbell Squat', 'Bench Press', 'Deadlift']) {
      expect(deriveIsUnilateral(name), name).toBe(false);
    }
  });
});

describe('normaliseExercise', () => {
  it('produces a row matching the exercises schema', () => {
    const exercise = normaliseExercise(source());
    expect(exercise).toMatchObject({
      slug: 'barbell-squat',
      name: 'Barbell Squat',
      primaryMuscle: 'quadriceps',
      secondaryMuscles: ['glutes', 'hamstrings'],
      movementPattern: 'squat',
      isUnilateral: false,
      category: 'strength',
      source: 'free-exercise-db',
      sourceId: 'Barbell_Squat',
      equipment: 'barbell',
    });
    expect(exercise.instructions).toBe('Step one.\n\nStep two.');
  });

  it('supplies a primary muscle when the source has none', () => {
    // The column is NOT NULL; a placeholder beats dropping the exercise.
    expect(normaliseExercise(source({ primaryMuscles: [] })).primaryMuscle).toBe('unspecified');
  });

  it('nulls empty instructions rather than storing an empty string', () => {
    expect(normaliseExercise(source({ instructions: [] })).instructions).toBeNull();
  });

  it('de-duplicates secondary muscles', () => {
    expect(
      normaliseExercise(source({ secondaryMuscles: ['glutes', 'glutes', 'calves'] }))
        .secondaryMuscles
    ).toEqual(['glutes', 'calves']);
  });
});

describe('normaliseAll', () => {
  it('sorts by slug and reports duplicates instead of colliding', () => {
    // WHY: exercises has a unique (user_id, slug) constraint, so a collision
    //      would abort the seed halfway through.
    const result = normaliseAll([
      source({ id: 'B', name: 'Bench Press' }),
      source({ id: 'A', name: 'Barbell Squat' }),
      source({ id: 'C', name: 'Bench Press' }),
    ]);
    expect(result.exercises.map((e) => e.slug)).toEqual(['barbell-squat', 'bench-press']);
    expect(result.duplicates).toEqual(['bench-press']);
  });

  it('drops records that cannot make a valid row', () => {
    const result = normaliseAll([source({ id: 'X', name: '' }), source({ id: 'Y', name: '!!!' })]);
    expect(result.exercises).toEqual([]);
    expect(result.dropped).toEqual(['X', 'Y']);
  });
});
