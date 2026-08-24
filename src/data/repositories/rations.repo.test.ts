import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import { DEFAULT_SEASON } from '../seasons.ts';
import { HORSE_ID, makeRation, resetDb } from '../__tests__/factories.ts';
import * as rationsRepo from './rations.repo.ts';

/**
 * The feed plan is an ordered list edited as a whole, so the parts worth
 * guarding are the ordering (`sortOrder` is what the list renders by) and the
 * all-or-nothing write the sheet depends on.
 */

beforeEach(resetDb);

const seedRations = (rations: Parameters<typeof makeRation>[0][]) =>
  db.rationItems.bulkAdd(rations.map((over) => makeRation(over)));

describe('listByHorse', () => {
  it('returns lines in sortOrder, not insertion order', async () => {
    await seedRations([
      { id: 'c', sortOrder: 2 },
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
    ]);

    const items = await rationsRepo.listByHorse(HORSE_ID);

    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes soft-deleted lines and other horses', async () => {
    await seedRations([
      { id: 'keep', sortOrder: 0 },
      { id: 'gone', sortOrder: 1, deletedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'other', sortOrder: 2, horseId: 'horse-2' },
    ]);

    const items = await rationsRepo.listByHorse(HORSE_ID);

    expect(items.map((item) => item.id)).toEqual(['keep']);
  });
});

describe('add', () => {
  it('appends after the highest existing sortOrder', async () => {
    await seedRations([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 5 },
    ]);

    const added = await rationsRepo.add({
      horseId: HORSE_ID,
      label: 'Sel',
      quantity: 15,
      unit: 'g',
      season: null,
    });

    expect(added.sortOrder).toBe(6);
  });

  it('starts at 0 for the first line', async () => {
    const added = await rationsRepo.add({
      horseId: HORSE_ID,
      label: 'Sel',
      quantity: 15,
      unit: 'g',
      season: null,
    });

    expect(added.sortOrder).toBe(0);
  });

  it('does not reuse the slot left by a soft-deleted line', async () => {
    // `nextSortOrder` reads through `listByHorse`, which filters tombstones —
    // so a deleted last line would hand its index to the next one added and the
    // two would collide if the delete were ever undone.
    await seedRations([{ id: 'gone', sortOrder: 3, deletedAt: '2026-02-01T00:00:00.000Z' }]);

    const added = await rationsRepo.add({
      horseId: HORSE_ID,
      label: 'Sel',
      quantity: 15,
      unit: 'g',
      season: null,
    });

    expect(added.sortOrder).toBe(0);
  });

  it('stores a season window verbatim', async () => {
    const added = await rationsRepo.add({
      horseId: HORSE_ID,
      label: 'Huile de lin',
      quantity: 40,
      unit: 'mL',
      season: DEFAULT_SEASON,
    });

    expect((await rationsRepo.get(added.id))?.season).toEqual({ from: 10, to: 4 });
  });
});

describe('updateMany', () => {
  it('applies every patch in one call', async () => {
    await seedRations([
      { id: 'a', sortOrder: 0, quantity: 1 },
      { id: 'b', sortOrder: 1, quantity: 2 },
    ]);

    await rationsRepo.updateMany([
      { id: 'a', patch: { quantity: 10 } },
      { id: 'b', patch: { quantity: 20, season: DEFAULT_SEASON } },
    ]);

    const items = await rationsRepo.listByHorse(HORSE_ID);
    expect(items.map((item) => item.quantity)).toEqual([10, 20]);
    expect(items[1]?.season).toEqual(DEFAULT_SEASON);
  });

  it('restamps updatedAt only on the rows it touches', async () => {
    await seedRations([
      { id: 'touched', sortOrder: 0 },
      { id: 'untouched', sortOrder: 1 },
    ]);

    await rationsRepo.updateMany([{ id: 'touched', patch: { quantity: 99 } }]);

    const items = await rationsRepo.listByHorse(HORSE_ID);
    // `clearUntouchedSeedData` tells demo rows from real ones by this equality,
    // so a blanket save would make the whole seed look hand-entered.
    expect(items[0]?.createdAt === items[0]?.updatedAt).toBe(false);
    expect(items[1]?.createdAt === items[1]?.updatedAt).toBe(true);
  });

  it('skips unknown ids rather than throwing', async () => {
    await seedRations([{ id: 'a', sortOrder: 0 }]);

    await expect(
      rationsRepo.updateMany([
        { id: 'a', patch: { quantity: 7 } },
        { id: 'deleted-in-another-tab', patch: { quantity: 7 } },
      ]),
    ).resolves.toBeUndefined();

    expect((await rationsRepo.get('a'))?.quantity).toBe(7);
  });

  it('accepts an empty list', async () => {
    await expect(rationsRepo.updateMany([])).resolves.toBeUndefined();
  });

  it('writes nothing when a patch throws mid-way', async () => {
    await seedRations([
      { id: 'a', sortOrder: 0, quantity: 1 },
      { id: 'b', sortOrder: 1, quantity: 2 },
    ]);

    // A Blob is not structured-cloneable into a number column in a way Dexie
    // will accept; the point is that the second write fails after the first.
    await expect(
      rationsRepo.updateMany([
        { id: 'a', patch: { quantity: 10 } },
        { id: 'b', patch: { unit: Symbol('nope') as never } },
      ]),
    ).rejects.toThrow();

    // The transaction must have rolled the first write back — a feed plan that
    // is partly yesterday's is worse than one that failed outright.
    expect((await rationsRepo.get('a'))?.quantity).toBe(1);
  });
});

describe('reorder', () => {
  it('rewrites sortOrder to match the given sequence', async () => {
    await seedRations([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ]);

    await rationsRepo.reorder(['c', 'a', 'b']);

    const items = await rationsRepo.listByHorse(HORSE_ID);
    expect(items.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe('remove', () => {
  it('soft-deletes, keeping the row as a tombstone', async () => {
    await seedRations([{ id: 'a', sortOrder: 0 }]);

    await rationsRepo.remove('a');

    expect(await rationsRepo.get('a')).toBeUndefined();
    expect(await db.rationItems.get('a')).toMatchObject({ deletedAt: expect.any(String) });
  });
});
