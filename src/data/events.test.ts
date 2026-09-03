import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_INTERVALS,
  activityChoices,
  followUpValue,
  formatFollowUpInterval,
  formatWorkActivity,
  isFollowUpInterval,
  matchActivity,
  parseFollowUpValue,
  statusForDate,
  workActivityByDate,
  workSessionByDate,
} from './events.ts';
import { makeEvent } from './__tests__/factories.ts';

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


describe('workActivityByDate', () => {
  it('answers with the activity of a day that has a session', () => {
    const byDate = workActivityByDate([
      makeEvent({ id: 'a', type: 'travail', date: '2026-08-10', activity: 'longe' }),
    ]);

    expect(byDate.get('2026-08-10')).toBe('longe');
  });

  it('ignores everything that is not a live work session', () => {
    const byDate = workActivityByDate([
      makeEvent({ id: 'care', type: 'veto', date: '2026-08-10' }),
      // A `travail` row with no activity cannot exist through the form, but a
      // restored backup predating schema v4 carries exactly that.
      makeEvent({ id: 'blank', type: 'travail', date: '2026-08-11', activity: null }),
      makeEvent({
        id: 'cancelled',
        type: 'travail',
        date: '2026-08-12',
        activity: 'plat',
        status: 'cancelled',
      }),
    ]);

    expect(byDate.size).toBe(0);
  });

  it('keeps the first session of a day: all-day before timed', () => {
    const byDate = workActivityByDate([
      makeEvent({ id: 'timed', type: 'travail', date: '2026-08-10', time: '09:00', activity: 'plat' }),
      makeEvent({ id: 'all-day', type: 'travail', date: '2026-08-10', time: null, activity: 'longe' }),
    ]);

    expect(byDate.get('2026-08-10')).toBe('longe');
  });

  it('then keeps the earlier of two timed sessions, whatever order they arrive in', () => {
    const byDate = workActivityByDate([
      makeEvent({ id: 'late', type: 'travail', date: '2026-08-10', time: '17:30', activity: 'plat' }),
      makeEvent({ id: 'early', type: 'travail', date: '2026-08-10', time: '08:15', activity: 'tap' }),
    ]);

    expect(byDate.get('2026-08-10')).toBe('tap');
  });
});

describe('workSessionByDate', () => {
  it('answers with the row, not just its activity', () => {
    const session = makeEvent({ id: 'a', type: 'travail', date: '2026-08-10', activity: 'longe' });

    expect(workSessionByDate([session]).get('2026-08-10')?.id).toBe('a');
  });

  it('picks the same session the activity map reports', () => {
    // The two must not be able to disagree: the strip draws one and its sheet
    // writes to the other, so a day would edit a row it never showed.
    const events = [
      makeEvent({ id: 'timed', type: 'travail', date: '2026-08-10', time: '09:00', activity: 'plat' }),
      makeEvent({ id: 'all-day', type: 'travail', date: '2026-08-10', activity: 'longe' }),
    ];

    const session = workSessionByDate(events).get('2026-08-10');
    expect(session?.id).toBe('all-day');
    expect(session?.activity).toBe(workActivityByDate(events).get('2026-08-10'));
  });
});

describe('formatWorkActivity', () => {
  it('resolves a built-in key to its French label', () => {
    expect(formatWorkActivity('balade')).toBe('Balade à pied');
  });

  it('gives back an activity the user added, which is stored as its own label', () => {
    expect(formatWorkActivity('Carrière')).toBe('Carrière');
  });
});

describe('activityChoices', () => {
  it('offers the six built-ins first, in table order', () => {
    expect(activityChoices([])).toEqual(['balade', 'longe', 'tap', 'liberte', 'plat', 'trotting']);
  });

  it('appends the user’s own in the order they were added', () => {
    expect(activityChoices(['Carrière', 'Repos']).slice(-2)).toEqual(['Carrière', 'Repos']);
  });

  it('drops a label that only repeats a built-in’s wording', () => {
    // The built-in stores `trotting` and reads "Trotting"; a row spelling the
    // label out would render a second chip identical to the first.
    expect(activityChoices(['Trotting'])).not.toContain('Trotting');
    expect(activityChoices(['Trotting'])).toHaveLength(6);
  });

  it('ignores case, surrounding space and accents when comparing', () => {
    expect(activityChoices(['  liberte ', 'LIBERTÉ', 'Carrière', 'carriere'])).toEqual([
      ...activityChoices([]),
      'Carrière',
    ]);
  });

  it('skips a blank label rather than offering an unlabelled chip', () => {
    expect(activityChoices(['   '])).toHaveLength(6);
  });
});

describe('matchActivity', () => {
  const choices = activityChoices(['Carrière']);

  it('resolves a typed label to the chip already offering it', () => {
    expect(matchActivity('carriere', choices)).toBe('Carrière');
  });

  it('resolves a built-in by its label, not by its storage key', () => {
    expect(matchActivity('Balade à pied', choices)).toBe('balade');
  });

  it('answers null for a label nothing offers yet', () => {
    expect(matchActivity('Repos', choices)).toBe(null);
  });

  it('answers null for a blank label rather than matching the first chip', () => {
    expect(matchActivity('  ', choices)).toBe(null);
  });
});
