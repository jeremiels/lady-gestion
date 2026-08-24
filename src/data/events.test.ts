import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_INTERVALS,
  followUpValue,
  formatFollowUpInterval,
  isFollowUpInterval,
  parseFollowUpValue,
  statusForDate,
} from './events.ts';

describe('statusForDate', () => {
  const TODAY = '2026-08-12';

  it('marks a future date as planned', () => {
    expect(statusForDate('2026-08-13', TODAY)).toBe('planned');
    expect(statusForDate('2027-01-01', TODAY)).toBe('planned');
  });

  it('marks a past date as done', () => {
    expect(statusForDate('2026-08-11', TODAY)).toBe('done');
    expect(statusForDate('2020-01-01', TODAY)).toBe('done');
  });

  it('treats today as done — it has happened', () => {
    // The boundary the whole rule turns on: an appointment entered on the day
    // it happened must not sit in "Rendez-vous à venir".
    expect(statusForDate(TODAY, TODAY)).toBe('done');
  });

  it('compares lexicographically across month and year boundaries', () => {
    expect(statusForDate('2026-09-01', '2026-08-31')).toBe('planned');
    expect(statusForDate('2026-01-01', '2025-12-31')).toBe('planned');
    expect(statusForDate('2025-12-31', '2026-01-01')).toBe('done');
  });
});

describe('isFollowUpInterval', () => {
  it('accepts the shapes the form produces', () => {
    expect(isFollowUpInterval({ amount: 6, unit: 'week' })).toBe(true);
    expect(isFollowUpInterval({ amount: 3, unit: 'month' })).toBe(true);
  });

  it('rejects half-built and nonsensical values', () => {
    expect(isFollowUpInterval(null)).toBe(false);
    expect(isFollowUpInterval({ amount: 6 })).toBe(false);
    expect(isFollowUpInterval({ unit: 'week' })).toBe(false);
    expect(isFollowUpInterval({ amount: 0, unit: 'week' })).toBe(false);
    expect(isFollowUpInterval({ amount: -1, unit: 'week' })).toBe(false);
    expect(isFollowUpInterval({ amount: 1.5, unit: 'week' })).toBe(false);
    expect(isFollowUpInterval({ amount: 6, unit: 'day' })).toBe(false);
    expect(isFollowUpInterval({ amount: '6', unit: 'week' })).toBe(false);
  });
});

describe('followUpValue / parseFollowUpValue', () => {
  it('round-trips every interval the form offers', () => {
    // FormData only carries strings, so this round trip is load-bearing.
    for (const interval of FOLLOW_UP_INTERVALS) {
      expect(parseFollowUpValue(followUpValue(interval))).toEqual(interval);
    }
  });

  it('serialises to a short readable code', () => {
    expect(followUpValue({ amount: 6, unit: 'week' })).toBe('6w');
    expect(followUpValue({ amount: 3, unit: 'month' })).toBe('3m');
  });

  it('returns null for anything unrecognised rather than guessing', () => {
    expect(parseFollowUpValue('')).toBe(null);
    expect(parseFollowUpValue('6')).toBe(null);
    expect(parseFollowUpValue('6d')).toBe(null);
    expect(parseFollowUpValue('0w')).toBe(null);
    expect(parseFollowUpValue('-2w')).toBe(null);
    expect(parseFollowUpValue(null)).toBe(null);
    expect(parseFollowUpValue({ amount: 6, unit: 'week' })).toBe(null);
  });
});

describe('formatFollowUpInterval', () => {
  it('renders the label the design shows', () => {
    expect(formatFollowUpInterval({ amount: 6, unit: 'week' })).toBe('6 semaines');
  });

  it('singularises a lone week', () => {
    expect(formatFollowUpInterval({ amount: 1, unit: 'week' })).toBe('1 semaine');
  });

  it('leaves `mois` invariant, because French does', () => {
    expect(formatFollowUpInterval({ amount: 1, unit: 'month' })).toBe('1 mois');
    expect(formatFollowUpInterval({ amount: 3, unit: 'month' })).toBe('3 mois');
  });

  it('says a year rather than twelve months', () => {
    expect(formatFollowUpInterval({ amount: 12, unit: 'month' })).toBe('1 an');
  });
});
