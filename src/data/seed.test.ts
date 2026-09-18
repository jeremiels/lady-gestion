import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./__tests__/factories.ts";
import { db } from "./db.ts";
import { SEEDED_PROFILE_ID, seedIfEmpty, seedProfileIfEmpty } from "./seed.ts";
import { ACCOUNT } from "./account.ts";
import * as profileRepo from "./repositories/profile.repo.ts";

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
      name: "Déjà là",
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

describe("seedProfileIfEmpty", () => {
  it("writes the identity that used to be hardcoded into a real row", async () => {
    // The point of the row: it is what lets `ACCOUNT` be emptied in a later
    // release without the user's own name vanishing from the page.
    await seedProfileIfEmpty();

    const profile = await profileRepo.get();
    expect(profile?.firstName).toBe(ACCOUNT.firstName);
    expect(profile?.email).toBe(ACCOUNT.email);
  });

  it("stamps a fixed id, so two installs seed one row rather than a pair", async () => {
    await seedProfileIfEmpty();

    expect((await db.profiles.toArray())[0]?.id).toBe(SEEDED_PROFILE_ID);
  });

  it("leaves it untouched as a seed, so a restore can still override it", async () => {
    await seedProfileIfEmpty();

    const profile = await profileRepo.get();
    expect(profile?.createdAt).toBe(profile?.updatedAt);
  });

  it("never overwrites a profile the user has already saved", async () => {
    await profileRepo.save({
      firstName: "Autre",
      lastName: "Personne",
      email: "autre@example.com",
    });

    await seedProfileIfEmpty();

    expect(await db.profiles.count()).toBe(1);
    expect((await profileRepo.get())?.firstName).toBe("Autre");
  });

  it("is a no-op on the second launch", async () => {
    await seedProfileIfEmpty();
    const first = await profileRepo.get();

    await seedProfileIfEmpty();

    expect(await db.profiles.count()).toBe(1);
    expect(await profileRepo.get()).toStrictEqual(first);
  });

  it("runs from seedIfEmpty on a device that already has a horse", async () => {
    // The install that needs this is an existing one — it has a horse, so it
    // never reaches the demo-seed branch. The call has to sit before that gate.
    await seedIfEmpty();
    await db.profiles.clear();
    expect(await db.horses.count()).toBeGreaterThan(0);

    await seedIfEmpty();

    expect(await db.profiles.count()).toBe(1);
  });
});
