import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, SCHEMA_VERSION } from './db.ts';
import { DEFAULT_SEASON } from './seasons.ts';

/**
 * The schema upgrades, exercised against databases that really were written by
 * the previous version rather than ones built with the current schema.
 *
 * This is the only code path in the app that runs on an install already holding
 * the user's data, and it gets exactly one chance: if it throws, Dexie leaves
 * the database unopenable and the app boots to an empty screen with the only
 * copy of the data stranded behind a failed version change.
 */

const DB_NAME = 'lady-gestion';

/**
 * The stores as v1..v4 declared them — no index changed across those four, only
 * row shapes, and v5 adds a table none of them had. **Do not** update this to
 * track `STORES`, or the upgrades end up tested against themselves.
 */
const LEGACY_STORES = {
  horses: 'id, name, updatedAt',
  events: 'id, horseId, date, type, status, [horseId+date], [horseId+type], updatedAt',
  documents: 'id, horseId, eventId, category, [horseId+category], updatedAt',
  documentBlobs: 'documentId',
  rationItems: 'id, horseId, [horseId+sortOrder], updatedAt',
  meta: 'key',
};

const stamps = {
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/** A ration row as v1 wrote it: a `seasonal` flag and no `season`. */
const v1Ration = (id: string, seasonal: boolean) => ({
  ...stamps,
  id,
  horseId: 'horse-1',
  label: id,
  quantity: 2,
  unit: 'kg',
  seasonal,
  sortOrder: 0,
});

/** An event row as v1 and v2 wrote it: no `vendor`, no `followUpInterval`. */
const preV3Event = (id: string) => ({
  ...stamps,
  id,
  horseId: 'horse-1',
  type: 'veto',
  title: id,
  date: '2026-06-15',
  time: null,
  status: 'planned',
  amountCents: null,
  currency: 'EUR',
  providerName: null,
  location: null,
  notes: null,
  recurrenceId: null,
});

/** An event row as v3 wrote it: the two v3 columns, but no `activity`. */
const preV4Event = (id: string) => ({
  ...preV3Event(id),
  vendor: null,
  followUpInterval: null,
});

/** An event row as v4 wrote it: complete, with a session on it. */
const v4Event = (id: string) => ({ ...preV4Event(id), activity: 'longe' });

/** Writes a database at `version`, then closes it so `db` can upgrade it. */
const writeLegacyDatabase = async (
  version: number,
  rows: { events?: unknown[]; rationItems?: unknown[]; horses?: unknown[] },
) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(version).stores(LEGACY_STORES);
  await legacy.open();

  for (const [table, values] of Object.entries(rows)) {
    if (values?.length) await legacy.table(table).bulkAdd(values);
  }
  legacy.close();
};

beforeEach(async () => {
  // Every test starts from no database at all, so opening `db` afterwards is a
  // real version change rather than a no-op on an already-current store.
  db.close();
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

describe('v1 -> v2: seasonal flag becomes a window', () => {
  it('gives a seasonal row the default window', async () => {
    await writeLegacyDatabase(1, { rationItems: [v1Ration('seasonal-row', true)] });

    await db.open();

    expect((await db.rationItems.get('seasonal-row'))?.season).toEqual(DEFAULT_SEASON);
  });

  it('reads a non-seasonal row as fed all year', async () => {
    await writeLegacyDatabase(1, { rationItems: [v1Ration('year-round', false)] });

    await db.open();

    expect((await db.rationItems.get('year-round'))?.season).toBe(null);
  });

  it('drops the old flag instead of leaving it beside the new field', async () => {
    await writeLegacyDatabase(1, { rationItems: [v1Ration('seasonal-row', true)] });

    await db.open();

    // A stale duplicate is what the next reader trusts by mistake — and
    // `exportBackup` copies whatever is on the row into the backup file.
    expect(await db.rationItems.get('seasonal-row')).not.toHaveProperty('seasonal');
  });

  it('migrates every row, not just the first', async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration('a', true), v1Ration('b', false), v1Ration('c', true)],
    });

    await db.open();

    const rows = await db.rationItems.orderBy('id').toArray();
    expect(rows.map((row) => row.season)).toEqual([DEFAULT_SEASON, null, DEFAULT_SEASON]);
  });
});

describe('v2 -> v3: events gain vendor and followUpInterval', () => {
  it('fills both columns with null rather than leaving them absent', async () => {
    await writeLegacyDatabase(2, { events: [preV3Event('event-1')] });

    await db.open();

    const event = await db.events.get('event-1');
    // `undefined` would contradict the declared type *and* be dropped entirely
    // by JSON.stringify when the row is exported to a backup.
    expect(event).toHaveProperty('vendor', null);
    expect(event).toHaveProperty('followUpInterval', null);
  });

  it('migrates every event', async () => {
    await writeLegacyDatabase(2, {
      events: [preV3Event('a'), preV3Event('b'), preV3Event('c')],
    });

    await db.open();

    const events = await db.events.orderBy('id').toArray();
    expect(events.every((event) => event.vendor === null)).toBe(true);
    expect(events.every((event) => event.followUpInterval === null)).toBe(true);
  });

  it('leaves the rest of the row untouched', async () => {
    await writeLegacyDatabase(2, { events: [preV3Event('event-1')] });

    await db.open();

    expect(await db.events.get('event-1')).toMatchObject({
      title: 'event-1',
      date: '2026-06-15',
      currency: 'EUR',
      status: 'planned',
    });
  });
});

describe('v3 -> v4: events gain activity', () => {
  it('fills the column with null rather than leaving it absent', async () => {
    await writeLegacyDatabase(3, { events: [preV4Event('event-1')] });

    await db.open();

    expect(await db.events.get('event-1')).toHaveProperty('activity', null);
  });

  it('migrates every event', async () => {
    await writeLegacyDatabase(3, {
      events: [preV4Event('a'), preV4Event('b'), preV4Event('c')],
    });

    await db.open();

    const events = await db.events.orderBy('id').toArray();
    expect(events.every((event) => event.activity === null)).toBe(true);
  });

  it('leaves the rest of the row untouched', async () => {
    await writeLegacyDatabase(3, { events: [preV4Event('event-1')] });

    await db.open();

    expect(await db.events.get('event-1')).toMatchObject({
      title: 'event-1',
      date: '2026-06-15',
      currency: 'EUR',
      status: 'planned',
    });
  });
});

describe('v4 -> v5: the activities table appears', () => {
  it('creates the store on a database that never had it', async () => {
    await writeLegacyDatabase(4, { events: [v4Event('event-1')] });

    await db.open();

    // Reaching the table at all is the assertion: on a database whose object
    // stores predate it, `db.activities` throws rather than returning empty.
    expect(await db.activities.count()).toBe(0);
  });

  it('leaves the existing rows alone', async () => {
    await writeLegacyDatabase(4, { events: [v4Event('event-1')] });

    await db.open();

    // A new store means no rows to rewrite, and so no `.upgrade()` — which is
    // exactly what could silently drop data if one were added later.
    expect(await db.events.get('event-1')).toMatchObject({
      title: 'event-1',
      date: '2026-06-15',
      activity: 'longe',
    });
  });
});

describe('a v1 database upgrading all the way', () => {
  it('runs every upgrade in sequence', async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration('ration-1', true)],
      events: [preV3Event('event-1')],
    });

    await db.open();

    expect((await db.rationItems.get('ration-1'))?.season).toEqual(DEFAULT_SEASON);
    expect(await db.events.get('event-1')).toHaveProperty('vendor', null);
    expect(await db.events.get('event-1')).toHaveProperty('activity', null);
    expect(await db.activities.count()).toBe(0);
  });

  it('opens at the version the backup envelope advertises', async () => {
    await writeLegacyDatabase(1, {});

    await db.open();

    // `exportBackup` stamps `SCHEMA_VERSION` onto every file it writes; if the
    // constant and the live database drift, a restore reads the wrong shape.
    expect(db.verno).toBe(SCHEMA_VERSION);
  });
});
