/**
 * What the coach remembers about the caller — ADR 0030.
 *
 * The queries only. What a note may BE is `src/chat/notes.ts`, which is pure and
 * runs in the unit suite; this file is the I/O half.
 *
 * INVARIANT: RLS scopes every statement here to the caller — CLAUDE.md #10.
 *            `coach_notes_own` is `for all to authenticated` with
 *            `user_id = auth.uid()` on both `using` and `with check`. No service
 *            role, and `user_id` is never read from a form.
 */
import { MAX_NOTES } from '../chat/notes';
import type { Db } from './client';

/** One note, as Settings renders it. */
export interface CoachNote {
  id: string;
  text: string;
  createdAt: string;
}

/**
 * The caller's notes, newest first.
 *
 * INVARIANT: the LIMIT is the bound that matters — ADR 0030 §3. A trigger also
 *            evicts beyond `MAX_NOTES`, but a trigger is a thing that can be
 *            dropped by a migration; this is what keeps the prompt bounded even
 *            if the table is not.
 */
export async function loadNotes(db: Db): Promise<CoachNote[]> {
  const { data, error } = await db
    .from('coach_notes')
    .select('id, text, created_at')
    /*
     * `created_at` IS the right order here, and ADR 0021's last Consequences
     * bullet is why: the tables it clears are the ones "written one row per
     * transaction", and `coach_notes` is one — at most one note per coach turn.
     * `sets` broke because it is bulk-written; this is not.
     *
     * `id` is a second key only so the order is TOTAL, which matters for a list
     * a user is pruning: two rows with one timestamp must not swap places
     * between renders. It is a `gen_random_uuid()`, so among same-timestamp rows
     * it is stable and arbitrary rather than newest-first — and ADR 0021's own
     * warning is that a total order is not the same as the right order, so this
     * comment says which of the two it is buying.
     */
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MAX_NOTES);

  if (error) throw new Error(`reading coach_notes: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
}

/**
 * Stores one note.
 *
 * INVARIANT: `userId` comes from the verified session, never from a field, and
 *            the policy independently rejects a write to anyone else's rows.
 *
 * The caller has already decided this note is storable — `acceptableNote`. This
 * function does not re-check it, because two places deciding what a note may be
 * is how they come to disagree.
 */
export async function rememberNote(db: Db, userId: string, text: string): Promise<void> {
  const { error } = await db.from('coach_notes').insert({ user_id: userId, text });
  if (error) throw new Error(`writing coach_notes: ${error.message}`);
}

/**
 * Deletes one note.
 *
 * The `user_id` filter is redundant under RLS and is there anyway: it makes the
 * statement say what it means, and it is what fails loudly if the policy is ever
 * loosened. A missing row is not an error — a second press on a note already
 * gone is not a failure the user needs to hear about.
 */
export async function forgetNote(db: Db, userId: string, id: string): Promise<void> {
  const { error } = await db.from('coach_notes').delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error(`deleting coach_notes: ${error.message}`);
}
