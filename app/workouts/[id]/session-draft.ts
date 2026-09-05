/**
 * The rows on the session screen that are not `sets` rows yet.
 *
 * INVARIANT: a pending row is never written to `sets` — ADR 0010. Every read of
 * that table means "work this person actually did", and a prescribed or
 * half-typed row that looked the same would move tonnage, e1RM and ACWR on work
 * nobody performed.
 *
 * WHY localStorage rather than component state alone: the phone locks between
 * sets, and docs/specs/mobile-interface.md §0 says nothing may live only in
 * memory. Losing three typed rows to a screen timeout is the failure this
 * prevents.
 *
 * AI-NOTE: when templates land, pending rows come from `workout_template_items`
 *          on the server and this file becomes the store for rows the user
 *          added by hand only. The shape below is deliberately the same either
 *          way.
 */
export interface DraftRow {
  /** Stable across re-renders and re-orders; React keys and saving state use it. */
  key: string;
  weightKg: string;
  reps: string;
  rpe: string;
  restSeconds: string;
  isWarmup: boolean;
}

export interface SessionDraft {
  /** Exercises added to the session that may have no performed sets yet. */
  added: { id: string; name: string }[];
  rows: Record<string, DraftRow[]>;
}

export const EMPTY_DRAFT: SessionDraft = { added: [], rows: {} };

export const DEFAULT_REST_SECONDS = 120;

export function newRow(values: Partial<DraftRow> = {}): DraftRow {
  return {
    key: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    weightKg: '',
    reps: '',
    rpe: '',
    restSeconds: String(DEFAULT_REST_SECONDS),
    isWarmup: false,
    ...values,
  };
}

function storageKey(workoutId: string): string {
  return `samson:draft:${workoutId}`;
}

/**
 * Reads are defensive on purpose: private browsing throws on access, and a
 * draft written by an older build may not match this shape. Either way the
 * session must open, empty, rather than break.
 */
export function readDraft(workoutId: string): SessionDraft {
  try {
    const raw = window.localStorage.getItem(storageKey(workoutId));
    if (raw === null) return EMPTY_DRAFT;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT;

    const { added, rows } = parsed as Partial<SessionDraft>;
    return {
      added: Array.isArray(added) ? added.filter((a) => typeof a?.id === 'string') : [],
      rows: typeof rows === 'object' && rows !== null ? rows : {},
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function writeDraft(workoutId: string, draft: SessionDraft): void {
  try {
    window.localStorage.setItem(storageKey(workoutId), JSON.stringify(draft));
  } catch {
    // A full or blocked store must not stop someone logging a set. The rows
    // still live in component state for as long as the page does.
  }
}

export function clearDraft(workoutId: string): void {
  try {
    window.localStorage.removeItem(storageKey(workoutId));
  } catch {
    // See writeDraft.
  }
}
