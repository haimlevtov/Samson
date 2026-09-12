'use client';

import { useActionState, useState } from 'react';
import { MAX_LOAD_KG, type EquipmentTag, type OwnedEquipment } from '@/src/db/equipment';
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

  return (
    <form action={formAction} className="settings-form">
      <fieldset className="equipment-set">
        <legend className="label">What can you train with?</legend>

        {tags.map((tag) => {
          const isChecked = checked.has(tag.slug);
          const existing = ownedById.get(tag.id);

          return (
            <div key={tag.id} className="equipment-item">
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
                  <span className="muted small">Heaviest (kg, optional)</span>
                  <input
                    type="number"
                    name={`max_load_${tag.slug}`}
                    min={1}
                    max={MAX_LOAD_KG}
                    step="0.5"
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
