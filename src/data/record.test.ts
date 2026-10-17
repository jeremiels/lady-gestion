import { describe, expect, it } from "vitest";
import { isLive, liveOnly } from "./record.ts";
import type { BaseRecord } from "./types.ts";

const record = (over: Partial<BaseRecord> = {}): BaseRecord => ({
  id: "a",
  ownerId: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...over,
});

describe("isLive / liveOnly", () => {
  it("treats a null deletedAt as live", () => {
    expect(isLive(record({ deletedAt: null }))).toBe(true);
  });

  it("treats a timestamped deletedAt as deleted", () => {
    expect(isLive(record({ deletedAt: "2026-01-01T00:00:00.000Z" }))).toBe(
      false,
    );
  });

  it("filters tombstones out of a list", () => {
    const rows = [
      record({ id: "a" }),
      record({ id: "b", deletedAt: "2026-01-01T00:00:00.000Z" }),
      record({ id: "c" }),
    ];

    expect(liveOnly(rows).map((row) => row.id)).toEqual(["a", "c"]);
  });
});
