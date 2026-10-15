import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.ts";
import { BUILT_IN_CATEGORIES, seedCategories } from "./categories.ts";
import { resetDb } from "./__tests__/factories.ts";
import { seedIfEmpty } from "./seed.ts";

/**
 * The built-in categories are a model for a first install, and hers from
 * then on: a later launch never writes this build's catalogue over the rows a
 * device already holds.
 */
beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The catalogue as she might have left it — or as an older build shipped it. */
const editedRows = () =>
  seedCategories("owner-1", "2026-01-01T00:00:00.000Z").map((type) => ({
    ...type,
    label: `${type.label} (à moi)`,
    fields: type.fields.filter((field) => field.id !== "notes"),
  }));

describe("seed — the built-in categories", () => {
  it("seeds every built-in on a device that has none", async () => {
    await db.categories.clear();

    await seedIfEmpty();

    const keys = (await db.categories.toArray()).map((type) => type.key);
    expect(keys.sort()).toEqual(
      BUILT_IN_CATEGORIES.map((type) => type.key).sort(),
    );
  });

  it("never writes over a category the device already has", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(editedRows());
    const before = await db.categories.toArray();

    await seedIfEmpty();

    expect(await db.categories.toArray()).toStrictEqual(before);
  });

  it("does not add a built-in the device does not have", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(
      editedRows().filter((type) => type.key !== "massage"),
    );

    await seedIfEmpty();

    expect(await db.categories.get({ key: "massage" })).toBeUndefined();
  });

  it("does not resurrect a built-in she deleted", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(
      editedRows().map((type) =>
        type.key === "achat"
          ? { ...type, deletedAt: "2026-02-01T00:00:00.000Z" }
          : type,
      ),
    );

    await seedIfEmpty();

    expect(
      (await db.categories.get({ key: "achat" }))?.deletedAt,
    ).not.toBeNull();
  });

  it("writes nothing at all on a later launch", async () => {
    await seedIfEmpty();
    const bulkAdd = vi.spyOn(db.categories, "bulkAdd");
    const bulkPut = vi.spyOn(db.categories, "bulkPut");

    await seedIfEmpty();

    expect(bulkAdd).not.toHaveBeenCalled();
    expect(bulkPut).not.toHaveBeenCalled();
  });
});
