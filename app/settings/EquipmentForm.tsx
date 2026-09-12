'use client';

import { useActionState, useState } from 'react';
import type { EquipmentTag } from '@/src/db/equipment';
import { nextSelectAll, selectAllState } from '@/src/catalogue/selection';
import type { OwnedEquipment } from './equipment-props';
import { saveEquipment } from './actions';
import { EMPTY_SETTINGS_FORM, type SettingsFormState } from './form-state';

/**
 * What equipment the user has, and how heavy it goes — ADR 0029.
 *
 * WHY this exists at all: `availableExercises` returns an empty list for a user
 * with no `user_equipment` rows, and invariant #5 means the planner may only
 * choose from that list. Until this shipped, `scripts/seed.ts` was the only
 * writer of that table, so nobody outside the five demo accounts could be given
 * a plan or shown an exercise.
 *
 * WHY the ceiling is here and not omitted: `max_load_kg` feeds `load_ceiling`,
 * one of the six deterministic rules. Collecting only WHICH gear somebody owns
 * would leave every real user uncapped and that rule would never fire for
 * anybody outside the seed — silently, while still passing its own tests.
 *
 * WHY it appears only once an item is checked: twelve number boxes on a phone is
 * how a form gets abandoned, and most gear has no meaningful cap. Blank is null
 * is "no ceiling", which is the column's own meaning.
 *
 * Nothing here is a control. The selection is re-filtered against the shared
 * catalogue on the server, and RLS scopes the write.
 */
export function EquipmentForm({ tags, owned }: { tags: EquipmentTag[]; owned: OwnedEquipment[] }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    saveEquipment,
    EMPTY_SETTINGS_FORM
  );

  const ownedById = new Map(owned.map((o) => [o.tagId, o]));

  /*
   * Which boxes are ticked, in client state, because the ceiling input renders
   * against it. The server does not trust this — it re-reads the checkboxes from
   * the submitted form — so this is presentation only.
   */
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(tags.filter((t) => ownedById.has(t.id)).map((t) => t.slug))
  );

  const toggle = (slug: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  /*
   * Select-all, asked for on the welcome flow and useful on both surfaces — the
   * catalogue runs to a dozen tags and a gym member owns nearly all of them.
   *
   * It carries NO `name`, so it is not part of the submission: it drives the
   * real checkboxes, which are what the server reads. A control that posted its
   * own value would be a second, wider answer to the same question.
   *
   * The two decisions behind it — what partial means, and what an empty
   * catalogue shows — live in `src/catalogue/selection.ts` with their tests.
   * Nothing under `app/` is in the unit suite, so a rule written here is a rule
   * nothing can fail on. FOUND IN REVIEW, against this PR's own argument for
   * `isCompleteBody` and `openingCoach`.
   */
  const boxState = selectAllState(tags.length, checked.size);

  const toggleAll = () =>
    setChecked((current) =>
      nextSelectAll(
        tags.map((t) => t.slug),
        current
      )
    );

  return (
    <form action={formAction} className="settings-form">
      <fieldset className="equipment-set">
        <legend className="label">What can you train with?</legend>

        {tags.length > 0 ? (
          <label className="check-row check-all">
            <input
              type="checkbox"
              checked={boxState === 'all'}
              /*
               * The third state, and it has to be set imperatively — there is no
               * `indeterminate` attribute in HTML, only a DOM property. Without
               * it a partial selection renders as an empty box, which reads as
               * "nothing is selected" while five things are.
               *
               * AI-NOTE: this arrow must stay INLINE. A fresh identity each
               *          render is what makes React detach and re-attach the ref,
               *          which is what keeps `indeterminate` in step with state.
               *          Hoisting it into a `useCallback` would freeze the third
               *          state at whatever it was on mount.
               */
              ref={(node) => {
                if (node) node.indeterminate = boxState === 'some';
              }}
              onChange={toggleAll}
              disabled={pending}
            />
            <span>{boxState === 'all' ? 'Clear all' : 'Select all'}</span>
          </label>
        ) : null}

        {tags.map((tag) => {
          const isChecked = checked.has(tag.slug);
          const existing = ownedById.get(tag.id);

          return (
            // A plain div: it groups the checkbox with its optional weight and
            // needs no rule of its own.
            <div key={tag.id}>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="equipment"
                  value={tag.slug}
                  checked={isChecked}
                  onChange={() => toggle(tag.slug)}
                  disabled={pending}
                />
                <span>{tag.name}</span>
              </label>

              {isChecked ? (
                <label className="equipment-load">
                  {/* Named per item: twelve inputs all called "Heaviest" give a
                      screen reader no way to tell them apart. */}
                  <span className="muted small">Heaviest {tag.name} (kg, optional)</span>
                  {/*
                   * `text`, not `number`, and the same choice the biometrics
                   * inputs make. FOUND IN REVIEW: `<input type="number">`
                   * sanitises anything it cannot parse to an EMPTY STRING, so
                   * "30 kg" would have arrived as blank — and blank means no
                   * ceiling, which is the cap silently coming off. Text lets the
                   * raw value reach the server, where the grammar can refuse it
                   * and say so.
                   */}
                  <input
                    type="text"
                    name={`max_load_${tag.slug}`}
                    inputMode="decimal"
                    defaultValue={existing?.maxLoadKg ?? ''}
                    placeholder="no limit"
                    disabled={pending}
                  />
                </label>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <p className="muted small">
        Leave the weight blank where there is no limit. Where there is one — dumbbells that stop at
        30 kg — the planner is held to it: a plan that prescribes more is rejected before you ever
        see it, by arithmetic rather than by the coach&apos;s judgement.
      </p>

      <div className="settings-submit">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save equipment'}
        </button>
        {state.saved ? <span className="saved">Saved</span> : null}
      </div>

      {state.error ? <p className="error small">{state.error}</p> : null}

      {checked.size === 0 ? (
        /*
         * Saving nothing is allowed — ADR 0029 — and it is the state every
         * non-seeded user is already in, so this says what it costs rather than
         * refusing it.
         */
        <p className="muted small">
          With nothing selected the app cannot suggest an exercise or write you a plan: both choose
          from what you can actually train with, and that would be nothing.
        </p>
      ) : null}
    </form>
  );
}
