import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import { HORSE_ID, makeHorse, resetDb } from '../__tests__/factories.ts';
import * as horsesRepo from './horses.repo.ts';

/**
 * `getActive()` is the seam the whole UI reads through — every view starts by
 * asking which horse it is looking at. Its fallback behaviour is what keeps a
 * stale or dangling `activeHorseId` from blanking the app, so that is the part
 * worth pinning.
 */

beforeEach(resetDb);

const seedHorses = (horses: Parameters<typeof makeHorse>[0][]) =>
  db.horses.bulkAdd(horses.map((over) => makeHorse(over)));

describe('list', () => {
  it('orders by name', async () => {
    await seedHorses([
      { id: 'b', name: 'Zephyr' },
      { id: 'a', name: 'Ladympala' },
    ]);

    expect((await horsesRepo.list()).map((horse) => horse.name)).toEqual(['Ladympala', 'Zephyr']);
  });

  it('excludes archived horses, which are not deleted', async () => {
    await seedHorses([
      { id: 'active', name: 'A' },
      { id: 'archived', name: 'B', archivedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect((await horsesRepo.list()).map((horse) => horse.id)).toEqual(['active']);
  });

  it('excludes soft-deleted horses', async () => {
    await seedHorses([
      { id: 'live', name: 'A' },
      { id: 'gone', name: 'B', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect((await horsesRepo.list()).map((horse) => horse.id)).toEqual(['live']);
  });
});

describe('getActive', () => {
  it('returns the horse named by activeHorseId', async () => {
    await seedHorses([
      { id: 'first', name: 'A' },
      { id: 'chosen', name: 'Z' },
    ]);
    await horsesRepo.setActive('chosen');

    expect((await horsesRepo.getActive())?.id).toBe('chosen');
  });

  it('falls back to the first horse when nothing has been chosen', async () => {
    await seedHorses([
      { id: 'b', name: 'Zephyr' },
      { id: 'a', name: 'Ladympala' },
    ]);

    expect((await horsesRepo.getActive())?.id).toBe('a');
  });

  it('falls back when activeHorseId points at a deleted horse', async () => {
    // Otherwise deleting the active horse blanks every view until the user
    // works out that they have to pick another one — with no UI to do it.
    await seedHorses([
      { id: 'gone', name: 'A', deletedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'survivor', name: 'B' },
    ]);
    await horsesRepo.setActive('gone');

    expect((await horsesRepo.getActive())?.id).toBe('survivor');
  });

  it('falls back when activeHorseId points at nothing at all', async () => {
    await seedHorses([{ id: 'survivor', name: 'B' }]);
    await horsesRepo.setActive('never-existed');

    expect((await horsesRepo.getActive())?.id).toBe('survivor');
  });

  it('returns undefined on an empty database rather than throwing', async () => {
    // `LiveQuery` renders this tick as an empty state; a throw would surface as
    // an unhandled rejection with no UI at all.
    expect(await horsesRepo.getActive()).toBeUndefined();
  });
});

describe('write path', () => {
  it('stamps a created horse', async () => {
    const created = await horsesRepo.create({
      name: 'Ladympala',
      sex: 'jument',
      birthDate: '2021-05-01',
      breed: null,
      coat: null,
      sireNumber: null,
      sireName: null,
      damName: null,
      photoDocumentId: null,
      archivedAt: null,
    });

    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.deletedAt).toBe(null);
  });

  it('cannot have identity fields rewritten through a patch', async () => {
    await seedHorses([{ id: HORSE_ID }]);

    const updated = await horsesRepo.update(HORSE_ID, { name: 'Renommée' });

    expect(updated?.id).toBe(HORSE_ID);
    expect(updated?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated?.name).toBe('Renommée');
  });

  it('soft-deletes, keeping the row as a tombstone', async () => {
    await seedHorses([{ id: HORSE_ID }]);

    await horsesRepo.remove(HORSE_ID);

    expect(await horsesRepo.get(HORSE_ID)).toBeUndefined();
    expect(await db.horses.get(HORSE_ID)).toMatchObject({ deletedAt: expect.any(String) });
  });
});
