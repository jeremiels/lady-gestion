import { beforeEach, describe, expect, it } from 'vitest';
import { db, SCHEMA_VERSION } from '../db.ts';
import { getOwnerId, setOwnerId } from '../owner.ts';
import { DEFAULT_SEASON } from '../seasons.ts';
import type { Horse, HorseEvent, RationItem } from '../types.ts';
import { exportBackup, importBackup, type BackupSnapshot } from './snapshot.ts';

const LOCAL_OWNER = 'owner-local';
const REMOTE_OWNER = 'owner-remote';

const horse = (over: Partial<Horse> = {}): Horse => ({
  id: 'horse-1',
  ownerId: REMOTE_OWNER,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
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
  ...over,
});

const ration = (over: Partial<RationItem> = {}): RationItem => ({
  id: 'ration-1',
  ownerId: REMOTE_OWNER,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  horseId: 'horse-1',
  label: 'Fib & fib',
  quantity: 2,
  unit: 'kg',
  season: null,
  sortOrder: 0,
  ...over,
});

const event = (over: Partial<HorseEvent> = {}): HorseEvent => ({
  id: 'event-1',
  ownerId: REMOTE_OWNER,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  horseId: 'horse-1',
  type: 'veto',
  title: 'Contrôle œil',
  date: '2026-06-15',
  time: null,
  status: 'planned',
  amountCents: null,
  currency: 'EUR',
  providerName: null,
  vendor: null,
  location: null,
  notes: null,
  recurrenceId: null,
  followUpInterval: null,
  activity: null,
  ...over,
});

const snapshot = (over: Partial<BackupSnapshot> = {}): BackupSnapshot => ({
  app: 'lady-gestion',
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-08-11T00:00:00.000Z',
  ownerId: REMOTE_OWNER,
  tables: { horses: [], events: [], documents: [], rationItems: [] },
  ...over,
});

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.horses.clear(),
    db.events.clear(),
    db.documents.clear(),
    db.documentBlobs.clear(),
    db.rationItems.clear(),
    db.meta.clear(),
  ]);
  await setOwnerId(LOCAL_OWNER);
});

describe('exportBackup', () => {
  it('writes an envelope carrying the schema version and owner', async () => {
    const backup = await exportBackup();

    expect(backup.app).toBe('lady-gestion');
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.ownerId).toBe(LOCAL_OWNER);
    expect(Object.keys(backup.tables).sort()).toEqual([
      'documents',
      'events',
      'horses',
      'rationItems',
    ]);
  });

  it('includes tombstones — a deletion has to be able to propagate', async () => {
    await db.horses.put(horse({ id: 'gone', deletedAt: '2026-02-01T00:00:00.000Z' }));

    const backup = await exportBackup();

    expect(backup.tables.horses.map((row) => row.id)).toContain('gone');
  });
});

describe('importBackup — merge semantics', () => {
  it('writes rows that do not exist locally', async () => {
    const result = await importBackup(snapshot({
      tables: { horses: [horse()], events: [], documents: [], rationItems: [ration()] },
    }));

    expect(result).toEqual({ imported: 2, skipped: 0 });
    expect(await db.horses.get('horse-1')).toMatchObject({ name: 'Ladympala' });
  });

  it('overwrites a local row when the snapshot is newer', async () => {
    await db.horses.put(horse({ name: 'Ancien nom', updatedAt: '2026-01-01T00:00:00.000Z' }));

    const result = await importBackup(snapshot({
      tables: {
        horses: [horse({ name: 'Nouveau nom', updatedAt: '2026-06-01T00:00:00.000Z' })],
        events: [],
        documents: [],
        rationItems: [],
      },
    }));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(await db.horses.get('horse-1')).toMatchObject({ name: 'Nouveau nom' });
  });

  it('keeps a newer local edit when restoring an older backup', async () => {
    await db.horses.put(horse({ name: 'Édité depuis', updatedAt: '2026-06-01T00:00:00.000Z' }));

    const result = await importBackup(snapshot({
      tables: {
        horses: [horse({ name: 'Vieille sauvegarde', updatedAt: '2026-01-01T00:00:00.000Z' })],
        events: [],
        documents: [],
        rationItems: [],
      },
    }));

    expect(result).toEqual({ imported: 0, skipped: 1 });
    expect(await db.horses.get('horse-1')).toMatchObject({ name: 'Édité depuis' });
  });

  it('is idempotent — importing the same file twice changes nothing', async () => {
    const file = snapshot({
      tables: { horses: [horse()], events: [], documents: [], rationItems: [ration()] },
    });

    const first = await importBackup(structuredClone(file));
    const second = await importBackup(structuredClone(file));

    expect(first).toEqual({ imported: 2, skipped: 0 });
    expect(second).toEqual({ imported: 0, skipped: 2 });
    expect(await db.horses.count()).toBe(1);
    expect(await db.rationItems.count()).toBe(1);
  });

  it('counts every table, not just the first', async () => {
    const result = await importBackup(snapshot({
      tables: {
        horses: [horse({ id: 'h1' }), horse({ id: 'h2' })],
        events: [],
        documents: [],
        rationItems: [ration({ id: 'r1' }), ration({ id: 'r2' }), ration({ id: 'r3' })],
      },
    }));

    expect(result).toEqual({ imported: 5, skipped: 0 });
  });
});

describe('importBackup — owner adoption', () => {
  it("adopts the snapshot's owner id so the database does not end up split", async () => {
    expect(getOwnerId()).toBe(LOCAL_OWNER);

    await importBackup(snapshot({ tables: { horses: [horse()], events: [], documents: [], rationItems: [] } }));

    expect(getOwnerId()).toBe(REMOTE_OWNER);
    expect(await db.meta.get('ownerId')).toMatchObject({ value: REMOTE_OWNER });
  });
});

describe('importBackup — rejects bad input', () => {
  it('rejects a file that is not a Ladympala.cc backup', async () => {
    await expect(importBackup({ app: 'autre-chose' })).rejects.toThrow(
      "Ce fichier n'est pas une sauvegarde Ladympala.cc.",
    );
    await expect(importBackup(null)).rejects.toThrow(/sauvegarde Ladympala.cc/);
  });

  it('rejects a file with no header', async () => {
    await expect(importBackup({ app: 'lady-gestion' })).rejects.toThrow(
      'Sauvegarde illisible : en-tête manquant.',
    );
  });

  it('rejects a backup written by a newer build', async () => {
    await expect(
      importBackup(snapshot({ schemaVersion: SCHEMA_VERSION + 1 })),
    ).rejects.toThrow(/version plus récente/);
  });

  it('rejects an empty tables object with a readable message, not a TypeError', async () => {
    // Regression: `assertSnapshot` used to check only that `tables` existed, so
    // this reached the merge and threw "undefined is not iterable".
    const broken = { ...snapshot(), tables: {} };

    await expect(importBackup(broken)).rejects.toThrow(/la table « horses » est absente/);
  });

  it('rejects a table that is not an array', async () => {
    const broken = { ...snapshot(), tables: { ...snapshot().tables, events: 'nope' } };

    await expect(importBackup(broken)).rejects.toThrow(/la table « events » est absente/);
  });

  it('rejects rows missing the fields the merge relies on', async () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, horses: [{ name: 'Sans id' }] },
    };

    await expect(importBackup(broken)).rejects.toThrow(/« horses » contient des enregistrements invalides/);
  });

  it('upgrades a v1 ration row, turning the seasonal flag into a window', async () => {
    // A v1 export predates `season` entirely and carries `seasonal` instead.
    const { season: _season, ...rest } = ration();
    const legacy = { ...rest, seasonal: true };

    await importBackup({
      ...snapshot(),
      schemaVersion: 1,
      tables: { ...snapshot().tables, rationItems: [legacy] },
    });

    const stored = await db.rationItems.get('ration-1');
    expect(stored?.season).toEqual(DEFAULT_SEASON);
    // The old flag must not survive alongside the new field — a stale duplicate
    // is what the next reader trusts by mistake.
    expect(stored).not.toHaveProperty('seasonal');
  });

  it('reads a v1 non-seasonal row as fed all year', async () => {
    const { season: _season, ...rest } = ration();

    await importBackup({
      ...snapshot(),
      schemaVersion: 1,
      tables: { ...snapshot().tables, rationItems: [{ ...rest, seasonal: false }] },
    });

    expect((await db.rationItems.get('ration-1'))?.season).toBe(null);
  });

  it('fills a pre-v3 event’s new columns with null', async () => {
    // A v2 export has no `vendor` and no `followUpInterval` at all.
    const { vendor: _vendor, followUpInterval: _interval, ...legacy } = event();

    await importBackup({
      ...snapshot(),
      schemaVersion: 2,
      tables: { ...snapshot().tables, events: [legacy] },
    });

    const stored = await db.events.get('event-1');
    expect(stored).toHaveProperty('vendor', null);
    expect(stored).toHaveProperty('followUpInterval', null);
  });

  it('fills a pre-v4 event’s activity with null', async () => {
    // A v3 export has the two v3 columns but no `activity` at all.
    const { activity: _activity, ...legacy } = event();

    await importBackup({
      ...snapshot(),
      schemaVersion: 3,
      tables: { ...snapshot().tables, events: [legacy] },
    });

    expect(await db.events.get('event-1')).toHaveProperty('activity', null);
  });

  it('keeps the values a current-version snapshot carries', async () => {
    const current = event({
      vendor: "google",
      followUpInterval: { amount: 6, unit: "week" },
      activity: 'longe',
    });

    await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, events: [current] },
    });

    const stored = await db.events.get('event-1');
    expect(stored?.vendor).toBe('google');
    expect(stored?.followUpInterval).toEqual({ amount: 6, unit: 'week' });
    expect(stored?.activity).toBe('longe');
  });

  it('leaves a current-version snapshot untouched', async () => {
    const seasonal = ration({ season: { from: 11, to: 3 } });

    await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, rationItems: [seasonal] },
    });

    expect((await db.rationItems.get('ration-1'))?.season).toEqual({ from: 11, to: 3 });
  });

  it('writes nothing at all when validation fails', async () => {
    const broken = {
      ...snapshot(),
      tables: {
        horses: [horse()],
        events: [],
        documents: [],
        rationItems: [{ label: 'sans id' }],
      },
    };

    await expect(importBackup(broken)).rejects.toThrow(/rationItems/);
    // The valid horse must not have landed: validation runs before the
    // transaction opens, so a bad file is rejected whole.
    expect(await db.horses.count()).toBe(0);
  });
});
