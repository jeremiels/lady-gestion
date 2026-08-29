import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import { addDays, todayISO } from '../dates.ts';
import { HORSE_ID, makeEvent, resetDb } from '../__tests__/factories.ts';
import * as eventsRepo from './events.repo.ts';

/**
 * The unified events table is read through the `[horseId+date]` compound index,
 * and every list in the app is a different slice of it. The parts worth pinning
 * are the ones a type checker cannot see: the sort direction each caller
 * assumes, the open-ended range sentinels, and which rows get filtered out.
 */

beforeEach(resetDb);

const seedEvents = (events: Parameters<typeof makeEvent>[0][]) =>
  db.events.bulkAdd(events.map((over) => makeEvent(over)));

describe('listByHorse', () => {
  it('returns newest first — the order the list view groups on', async () => {
    await seedEvents([
      { id: 'old', date: '2026-01-10' },
      { id: 'new', date: '2026-09-01' },
      { id: 'mid', date: '2026-05-20' },
    ]);

    const events = await eventsRepo.listByHorse(HORSE_ID);

    expect(events.map((event) => event.id)).toEqual(['new', 'mid', 'old']);
  });

  it('spans the whole range, including dates outside any plausible bound', async () => {
    // The repo uses '' and '￿' as open-ended sentinels. A date sorting
    // before or after every realistic value must still come back.
    await seedEvents([
      { id: 'ancient', date: '1900-01-01' },
      { id: 'distant', date: '2999-12-31' },
    ]);

    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(2);
  });

  it('excludes soft-deleted rows', async () => {
    await seedEvents([
      { id: 'live', date: '2026-05-01' },
      { id: 'gone', date: '2026-05-02', deletedAt: '2026-06-01T00:00:00.000Z' },
    ]);

    const events = await eventsRepo.listByHorse(HORSE_ID);

    expect(events.map((event) => event.id)).toEqual(['live']);
  });

  it('excludes other horses', async () => {
    await seedEvents([
      { id: 'mine', date: '2026-05-01' },
      { id: 'theirs', date: '2026-05-02', horseId: 'horse-2' },
    ]);

    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(1);
  });
});

describe('listInRange', () => {
  it('is inclusive at both ends and oldest first', async () => {
    await seedEvents([
      { id: 'before', date: '2026-05-31' },
      { id: 'start', date: '2026-06-01' },
      { id: 'middle', date: '2026-06-15' },
      { id: 'end', date: '2026-06-30' },
      { id: 'after', date: '2026-07-01' },
    ]);

    const events = await eventsRepo.listInRange(HORSE_ID, '2026-06-01', '2026-06-30');

    expect(events.map((event) => event.id)).toEqual(['start', 'middle', 'end']);
  });
});

describe('listUpcoming', () => {
  it('includes today and excludes yesterday', async () => {
    const today = todayISO();
    await seedEvents([
      { id: 'yesterday', date: addDays(today, -1) },
      { id: 'today', date: today },
      { id: 'tomorrow', date: addDays(today, 1) },
    ]);

    const events = await eventsRepo.listUpcoming(HORSE_ID);

    expect(events.map((event) => event.id)).toEqual(['today', 'tomorrow']);
  });

  it('returns soonest first — the opposite of listByHorse', async () => {
    const today = todayISO();
    await seedEvents([
      { id: 'far', date: addDays(today, 30) },
      { id: 'near', date: addDays(today, 2) },
    ]);

    const events = await eventsRepo.listUpcoming(HORSE_ID);

    expect(events.map((event) => event.id)).toEqual(['near', 'far']);
  });

  it('keeps only planned events — done and cancelled are not upcoming', async () => {
    const today = todayISO();
    await seedEvents([
      { id: 'planned', date: addDays(today, 1), status: 'planned' },
      { id: 'done', date: addDays(today, 2), status: 'done' },
      { id: 'cancelled', date: addDays(today, 3), status: 'cancelled' },
    ]);

    const events = await eventsRepo.listUpcoming(HORSE_ID);

    expect(events.map((event) => event.id)).toEqual(['planned']);
  });

  it('applies the limit after filtering, not before', async () => {
    // A `done` event sitting first must not consume one of the limit's slots —
    // the dashboard would then show fewer appointments than it asked for.
    const today = todayISO();
    await seedEvents([
      { id: 'done', date: addDays(today, 1), status: 'done' },
      { id: 'a', date: addDays(today, 2) },
      { id: 'b', date: addDays(today, 3) },
    ]);

    const events = await eventsRepo.listUpcoming(HORSE_ID, 2);

    expect(events.map((event) => event.id)).toEqual(['a', 'b']);
  });
});

describe('listBudget', () => {
  it('keeps only rows that cost something', async () => {
    await seedEvents([
      { id: 'free', date: '2026-05-01', amountCents: null },
      { id: 'paid', date: '2026-05-02', amountCents: 9000 },
      { id: 'zero', date: '2026-05-03', amountCents: 0 },
    ]);

    const budget = await eventsRepo.listBudget(HORSE_ID);

    // A zero-cost row is still an budget: it was recorded deliberately, and
    // `null` is the value that means "costs nothing".
    expect(budget.map((event) => event.id).sort()).toEqual(['paid', 'zero']);
  });

  it('drops cancelled rows — a cancelled visit was never paid for', async () => {
    await seedEvents([
      { id: 'kept', date: '2026-05-01', amountCents: 5000 },
      { id: 'cancelled', date: '2026-05-02', amountCents: 5000, status: 'cancelled' },
    ]);

    const budget = await eventsRepo.listBudget(HORSE_ID);

    expect(budget.map((event) => event.id)).toEqual(['kept']);
  });
});

describe('totalSpent', () => {
  it('sums cents as integers', async () => {
    await seedEvents([
      { id: 'a', date: '2026-05-01', amountCents: 9000 },
      { id: 'b', date: '2026-05-02', amountCents: 35000 },
      { id: 'c', date: '2026-05-03', amountCents: 7500 },
    ]);

    expect(await eventsRepo.totalSpent(HORSE_ID)).toBe(51500);
  });

  it('sums amounts that would drift as floats', async () => {
    // 0.1 + 0.2 in euros; the whole reason amounts are stored in cents.
    await seedEvents([
      { id: 'a', date: '2026-05-01', amountCents: 10 },
      { id: 'b', date: '2026-05-02', amountCents: 20 },
    ]);

    expect(await eventsRepo.totalSpent(HORSE_ID)).toBe(30);
  });

  it('honours the date range', async () => {
    await seedEvents([
      { id: 'inside', date: '2026-06-15', amountCents: 1000 },
      { id: 'outside', date: '2026-07-15', amountCents: 9999 },
    ]);

    expect(await eventsRepo.totalSpent(HORSE_ID, '2026-06-01', '2026-06-30')).toBe(1000);
  });

  it('is 0, not NaN, when there is nothing to sum', async () => {
    expect(await eventsRepo.totalSpent(HORSE_ID)).toBe(0);
  });
});

describe('totalSpentByType', () => {
  it('groups cents by category and omits types with no spend', async () => {
    await seedEvents([
      { id: 'a', date: '2026-05-01', type: 'marechal', amountCents: 9000 },
      { id: 'b', date: '2026-05-02', type: 'marechal', amountCents: 1000 },
      { id: 'c', date: '2026-05-03', type: 'pension', amountCents: 35000 },
    ]);

    expect(await eventsRepo.totalSpentByType(HORSE_ID)).toEqual({
      marechal: 10000,
      pension: 35000,
    });
  });
});

describe('write path', () => {
  it('stamps a created event and reads it back', async () => {
    const created = await eventsRepo.create({
      horseId: HORSE_ID,
      type: 'veto',
      title: 'Vaccins',
      date: '2026-09-01',
      time: '09:30',
      status: 'planned',
      amountCents: null,
      currency: 'EUR',
      providerName: null,
      vendor: null,
      location: null,
      notes: null,
      recurrenceId: null,
      followUpInterval: null,
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.deletedAt).toBe(null);
    expect(await eventsRepo.get(created.id)).toMatchObject({ title: 'Vaccins' });
  });

  it('advances updatedAt on update but leaves createdAt alone', async () => {
    await seedEvents([{ id: 'event-1' }]);

    const updated = await eventsRepo.update('event-1', { title: 'Renommé' });
    if (!updated) throw new Error('update returned undefined');

    expect(updated.title).toBe('Renommé');
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    // Lexicographic, which is exactly what the backup merge's last-write-wins
    // relies on — ISO timestamps sort as strings.
    expect(updated.updatedAt > updated.createdAt).toBe(true);
  });

  it('returns undefined when updating a row that is already deleted', async () => {
    await seedEvents([{ id: 'event-1', deletedAt: '2026-02-01T00:00:00.000Z' }]);

    expect(await eventsRepo.update('event-1', { title: 'Zombie' })).toBeUndefined();
  });

  it('soft-deletes, leaving a tombstone a backup can propagate', async () => {
    await seedEvents([{ id: 'event-1' }]);

    await eventsRepo.remove('event-1');

    expect(await eventsRepo.get('event-1')).toBeUndefined();
    // The row itself must survive — an absence cannot be synced.
    expect(await db.events.get('event-1')).toMatchObject({ deletedAt: expect.any(String) });
  });

  it('is a no-op when removing an unknown id', async () => {
    await expect(eventsRepo.remove('nope')).resolves.toBeUndefined();
  });
});
