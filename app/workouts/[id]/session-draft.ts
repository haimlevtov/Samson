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
 * Templates have landed, and the note this file carried has been done: a
 * template's pending rows come from `workout_template_items` on the server
 * (`pendingTargets`), not from here. What this file stores for them is only
 * what the server cannot know — the edits a user made to a target before
 * ticking it, and the targets they decided to skip.
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
  /** Rows the user added by hand, keyed by exercise. */
  rows: Record<string, DraftRow[]>;
  /**
   * Edits to a template's target rows, keyed by `TargetRow.key`.
   *
   * WHY overrides rather than copying the targets in here on first open: a copy
   * goes stale the moment the template changes, and it exists only on the
   * device that made it. The server stays the source of what was prescribed;
   * this records only the divergence — the day the 60 kg said 57.5.
   */
  overrides: Record<string, Partial<DraftRow>>;
  /** Target keys the user removed. A prescription is not an obligation. */
  dismissed: string[];
}

export const EMPTY_DRAFT: SessionDraft = { added: [], rows: {}, overrides: {}, dismissed: [] };

/** Target rows carry this prefix — see `pendingTargets` in src/templates. */
export function isTargetKey(key: string): boolean {
  return key.startsWith('t:');
}

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

    // Every field is checked separately: a draft written before templates
    // existed has no overrides, and must still open.
    const { added, rows, overrides, dismissed } = parsed as Partial<SessionDraft>;
    return {
      added: Array.isArray(added) ? added.filter((a) => typeof a?.id === 'string') : [],
      rows: typeof rows === 'object' && rows !== null ? rows : {},
      overrides: typeof overrides === 'object' && overrides !== null ? overrides : {},
      dismissed: Array.isArray(dismissed) ? dismissed.filter((d) => typeof d === 'string') : [],
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
