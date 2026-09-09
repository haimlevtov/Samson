/**
 * What a DOI looks like, and nothing about what it says.
 *
 * ADR 0023 splits one acceptance criterion — "every claim has a resolvable DOI"
 * — into three checks, because `verify.yml`'s unit job has no network and no
 * database by design. This is the offline third: format only, no rows, no
 * fetch, so it runs in `npm test` anywhere.
 *
 * INVARIANT: this function never decides whether a DOI is REGISTERED, let alone
 *            whether the paper behind it says what a row claims. Both of those
 *            are somebody else's job — `npm run verify:doi` and a human
 *            respectively. See ADR 0023's "what is NOT verified".
 */

/**
 * The registered shape: a `10.` prefix, a registrant code, a slash, a suffix.
 *
 * WHY not the fuller grammar from the DOI handbook: the suffix is deliberately
 * opaque and almost anything is legal in it, so a stricter pattern would reject
 * real DOIs — `10.1186/1550-2783-1-2-12` and
 * `10.1519/JSC.0000000000002917` are both in this project's own sources and look
 * nothing alike. The registrant half is the part with a rule worth enforcing.
 *
 * AI-NOTE: if this ever starts rejecting a DOI that resolves, the pattern is
 *          wrong and the DOI is right. Widen it, and add the case below.
 */
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

/** True when `value` is shaped like a DOI. Says nothing about whether it exists. */
export function isDoi(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed !== value) return false;
  if (trimmed.length > 200) return false;
  return DOI_PATTERN.test(trimmed);
}

/**
 * The URL that resolves a DOI, or null when the value is not one.
 *
 * `doi.org` rather than a publisher's domain: the whole point of storing an
 * identifier instead of a URL is that this redirect is somebody's job to
 * maintain forever — ADR 0023.
 *
 * WHY it validates rather than trusting its caller: FOUND IN REVIEW. Both
 * current callers happen to check first — `src/db/evidence.ts` drops a row whose
 * DOI fails the schema — so the href could never be hostile. But that made the
 * safety a property of two call sites rather than of this function, and the next
 * caller (a search box, a share link) would inherit none of it. The prefix is
 * what pins the origin: with `10.` and a numeric registrant guaranteed, every
 * remaining byte lands in doi.org's PATH and cannot change the host.
 */
export function doiUrl(doi: string): string | null {
  if (!isDoi(doi)) return null;
  return `https://doi.org/${doi}`;
}
