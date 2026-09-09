import { describe, expect, it } from 'vitest';
import { doiUrl, isDoi } from './doi';

/**
 * The shipped DOIs, so a pattern change that would reject one of the project's
 * own sources fails here rather than in a network job somebody has to read.
 * They are deliberately unalike — the two below are both real and share almost
 * no structure.
 */
const SHIPPED = [
  '10.1186/s12970-017-0173-z',
  '10.1186/s12970-020-00383-4',
  '10.1186/s12970-017-0177-8',
  '10.1186/s12970-015-0090-y',
  '10.1186/s12970-021-00458-w',
  '10.1080/15502783.2024.2441775',
  '10.1007/s40279-019-01091-z',
  '10.1080/15502783.2024.2434734',
  '10.1186/s12970-019-0329-0',
  '10.1080/15502783.2023.2263409',
  '10.1186/s12970-017-0184-9',
  '10.1186/1550-2783-1-2-12',
  '10.1038/s41443-023-00763-9',
];

describe('isDoi', () => {
  it('accepts every DOI the table ships', () => {
    for (const doi of SHIPPED) expect(isDoi(doi), doi).toBe(true);
  });

  it('accepts the two shapes that look least alike', () => {
    // A hyphenated legacy suffix and a dotted one with a long numeric tail.
    expect(isDoi('10.1186/1550-2783-1-2-12')).toBe(true);
    expect(isDoi('10.1519/JSC.0000000000002917')).toBe(true);
  });

  it('rejects a URL, which is the mistake this exists to stop', () => {
    // ADR 0023 rejects storing a URL: a publisher redirect is somebody else's
    // to break. Pasting one into the column has to fail rather than half-work.
    expect(isDoi('https://doi.org/10.1186/s12970-017-0173-z')).toBe(false);
    expect(isDoi('doi.org/10.1186/s12970-017-0173-z')).toBe(false);
    expect(isDoi('doi:10.1186/s12970-017-0173-z')).toBe(false);
  });

  it('rejects the near-misses', () => {
    expect(isDoi(''), 'empty').toBe(false);
    expect(isDoi('10.1186'), 'no suffix').toBe(false);
    expect(isDoi('10.1186/'), 'empty suffix').toBe(false);
    expect(isDoi('11.1186/x'), 'wrong prefix').toBe(false);
    expect(isDoi('10.11/x'), 'registrant too short').toBe(false);
    expect(isDoi('10.1234567890/x'), 'registrant too long').toBe(false);
  });

  it('rejects whitespace rather than quietly trimming it', () => {
    /*
     * WHY reject instead of trim: this validates a column, and a value that
     * needs trimming is a value somebody pasted badly. Accepting it would put
     * the untrimmed string in the database, where the link builder would then
     * produce a URL with a space in it.
     */
    expect(isDoi(' 10.1186/s12970-017-0173-z')).toBe(false);
    expect(isDoi('10.1186/s12970-017-0173-z ')).toBe(false);
    expect(isDoi('10.1186/s129 70')).toBe(false);
  });

  it('refuses an absurdly long value', () => {
    expect(isDoi(`10.1186/${'x'.repeat(500)}`)).toBe(false);
  });
});

describe('doiUrl', () => {
  it('resolves through doi.org rather than a publisher', () => {
    expect(doiUrl('10.1186/s12970-017-0173-z')).toBe('https://doi.org/10.1186/s12970-017-0173-z');
  });

  it('returns null rather than building a link from a non-DOI', () => {
    /*
     * FOUND IN REVIEW: this used to interpolate whatever it was given. Both
     * callers validated first, so no bad href could reach a page — but that
     * made the safety a property of the call sites, and the next caller would
     * inherit none of it.
     */
    expect(doiUrl('https://evil.example/10.1186/x')).toBeNull();
    expect(doiUrl('')).toBeNull();
    expect(doiUrl('not a doi')).toBeNull();
  });

  it('keeps a hostile-looking suffix inside the doi.org path', () => {
    // The prefix pins the origin:  plus a numeric registrant means every
    // remaining byte is path, so it cannot change the host.
    const url = doiUrl('10.1186/x@evil.example');
    expect(url).not.toBeNull();
    expect(new URL(url!).origin).toBe('https://doi.org');
  });
});
