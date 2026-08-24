import { describe, expect, it } from 'vitest';
import { isLive, liveOnly, newerOf } from './record.ts';
import type { BaseRecord } from './types.ts';

const record = (over: Partial<BaseRecord> = {}): BaseRecord => ({
  id: 'a',
  ownerId: 'owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

describe('newerOf', () => {
  it('takes the incoming row when there is no local one', () => {
    const incoming = record();
    expect(newerOf(undefined, incoming)).toBe(incoming);
  });

  it('takes the incoming row when it is newer', () => {
    const local = record({ updatedAt: '2026-01-01T00:00:00.000Z' });
    const incoming = record({ updatedAt: '2026-06-01T00:00:00.000Z' });
    expect(newerOf(local, incoming)).toBe(incoming);
  });

  it('keeps the local row when it is newer', () => {
    const local = record({ updatedAt: '2026-06-01T00:00:00.000Z' });
    const incoming = record({ updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(newerOf(local, incoming)).toBe(local);
  });

  it('keeps the local row on an exact tie', () => {
    // Restoring the same backup twice must be a no-op, not a rewrite.
    const local = record({ updatedAt: '2026-06-01T00:00:00.000Z' });
    const incoming = record({ updatedAt: '2026-06-01T00:00:00.000Z' });
    expect(newerOf(local, incoming)).toBe(local);
  });

  it('compares ISO timestamps lexicographically, which matches chronologically', () => {
    const local = record({ updatedAt: '2026-09-01T00:00:00.000Z' });
    const incoming = record({ updatedAt: '2026-10-01T00:00:00.000Z' });
    expect(newerOf(local, incoming)).toBe(incoming);
  });
});

describe('isLive / liveOnly', () => {
  it('treats a null deletedAt as live', () => {
    expect(isLive(record({ deletedAt: null }))).toBe(true);
  });

  it('treats a timestamped deletedAt as deleted', () => {
    expect(isLive(record({ deletedAt: '2026-01-01T00:00:00.000Z' }))).toBe(false);
  });

  it('filters tombstones out of a list', () => {
    const rows = [
      record({ id: 'a' }),
      record({ id: 'b', deletedAt: '2026-01-01T00:00:00.000Z' }),
      record({ id: 'c' }),
    ];

    expect(liveOnly(rows).map((row) => row.id)).toEqual(['a', 'c']);
  });
});
