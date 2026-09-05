/**
 * The one shape every template form returns.
 *
 * WHY a shared state rather than a thrown error: all three creation paths can
 * fail for reasons the user can act on — a name that is blank, a session with
 * nothing prescribable in it, a plan naming an exercise the catalogue does not
 * have. An error page says none of that. On success the action redirects, so
 * this only ever carries a failure.
 */
export interface TemplateFormState {
  error: string | null;
}

export const EMPTY_TEMPLATE_FORM: TemplateFormState = { error: null };
