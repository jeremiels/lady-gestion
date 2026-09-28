import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./__tests__/factories.ts";
import { db } from "./db.ts";
import { seedIfEmpty } from "./seed.ts";

/**
 * The event-type catalogue's first-run seeding.
 *
 * A brand-new install never runs `db.ts`'s v6 `.upgrade()` — Dexie only fires
 * an upgrade transaction for a database that already exists at an older
 * version, and a fresh `IndexedDB` is created directly at the current schema
 * with every table empty. `seedIfEmpty` is the only code path a first run
 * reaches, so it is what has to seed the 14 built-in types there — a real gap
 * caught by driving the app fresh rather than by the migration tests alone,
 * which only ever exercise an *upgrading* database.
 */

beforeEach(async () => {
  // `resetDb()` seeds the catalogue itself (most suites want it present) —
  // clear it back out so these tests see the state a genuinely fresh install
  // starts from.
  await resetDb();
  await db.categories.clear();
});

describe("seedIfEmpty — event types", () => {
  it("seeds the 14 built-in types on a database with none", async () => {
    await seedIfEmpty();

    expect(await db.categories.count()).toBe(14);
  });

  it("does not duplicate them on a second call", async () => {
    await seedIfEmpty();
    await seedIfEmpty();

    expect(await db.categories.count()).toBe(14);
  });

  it("seeds types even when a horse already exists", async () => {
    // The demo horse/rations/events are gated on `db.horses` being empty, but
    // a device that already has a horse — imagine a future flow that creates
    // one before the type catalogue exists — must still get its types.
    await db.horses.add({
      id: "existing-horse",
      ownerId: "owner-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      firstName: "Déjà là",
      lastName: null,
      sex: "jument",
      birthDate: null,
      breed: null,
      coat: null,
      sireNumber: null,
      sireName: null,
      damName: null,
      photoDocumentId: null,
      archivedAt: null,
    });

    await seedIfEmpty();

    expect(await db.categories.count()).toBe(14);
    // And it must not have also reseeded the demo horse/events on top of the
    // one already there.
    expect(await db.horses.count()).toBe(1);
  });
});

describe("seedIfEmpty — the demo", () => {
  it("writes all of it or none of it", async () => {
    // The first bookkeeping write, which comes after the horse and its posts.
    vi.spyOn(db.meta, "put").mockRejectedValueOnce(new Error("full"));

    await expect(seedIfEmpty()).rejects.toThrow();

    expect(await db.horses.count()).toBe(0);
    expect(await db.posts.count()).toBe(0);
    expect(await db.meta.get("seedRecordIds")).toBeUndefined();
  });
});
