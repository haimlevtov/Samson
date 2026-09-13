import { describe, expect, it } from 'vitest';
import { deliveredBy } from './coach';

const personas = [
  { slug: 'analyst', name: 'The Analyst' },
  { slug: 'physio', name: 'The Physio' },
];

describe('deliveredBy', () => {
  it('names the coach the delivery came from, not whoever the menu shows now', () => {
    // Delivered as the Analyst; the menu has since moved to the Physio.
    expect(deliveredBy(personas, 'analyst')).toBe('The Analyst');
  });

  it('says "the coach" when the delivering row is not listed', () => {
    expect(deliveredBy(personas, 'retired-coach')).toBe('the coach');
    expect(deliveredBy(personas, null)).toBe('the coach');
  });
});
