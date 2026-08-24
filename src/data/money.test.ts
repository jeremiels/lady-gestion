import { describe, expect, it } from 'vitest';
import { formatCents, fromCents, sumCents, toCents } from './money.ts';

/** Intl inserts a narrow no-break space before the currency symbol. */
const normalize = (value: string) => value.replace(/\s/g, ' ');

describe('toCents', () => {
  it('accepts a French decimal comma', () => {
    expect(toCents('12,5')).toBe(1250);
  });

  it('accepts a decimal point', () => {
    expect(toCents('12.5')).toBe(1250);
  });

  it('accepts a number', () => {
    expect(toCents(12.5)).toBe(1250);
  });

  it('rounds rather than truncating', () => {
    expect(toCents(12.345)).toBe(1235);
    expect(toCents(12.344)).toBe(1234);
  });

  it('does not drift on values that are not representable in binary', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it.each([[null], [undefined], ['']])('returns null for %s', (value) => {
    expect(toCents(value)).toBeNull();
  });

  it('returns null for non-numeric input rather than NaN', () => {
    expect(toCents('abc')).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('handles negative amounts', () => {
    expect(toCents('-12,5')).toBe(-1250);
  });
});

describe('fromCents', () => {
  it('round-trips through toCents', () => {
    for (const amount of [0, 1, 12.5, 350, 1234.56, -99.99]) {
      expect(fromCents(toCents(amount) as number)).toBeCloseTo(amount, 10);
    }
  });
});

describe('formatCents', () => {
  it('renders euros in French', () => {
    expect(normalize(formatCents(1250))).toBe('12,50 €');
  });

  it('renders an em dash for a missing amount', () => {
    expect(formatCents(null)).toBe('—');
  });

  it('honours a different currency', () => {
    expect(normalize(formatCents(1250, 'USD'))).toContain('12,50');
  });

  it('renders zero as an amount, not as missing', () => {
    expect(normalize(formatCents(0))).toBe('0,00 €');
  });
});

describe('sumCents', () => {
  it('treats null as zero', () => {
    expect(sumCents([1000, null, 250, null])).toBe(1250);
  });

  it('is zero for an empty list', () => {
    expect(sumCents([])).toBe(0);
  });
});
