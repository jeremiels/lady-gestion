import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.ts";
import { BUILT_IN_CATEGORIES, seedCategories } from "./categories.ts";
import { resetDb } from "./__tests__/factories.ts";
import { seedIfEmpty } from "./seed.ts";

/**
 * A device seeded by an older build, launched on a newer one.
 *
 * This is the case that broke the entry form in the browser while every test
 * passed: the suite always started from an empty table, so it only ever
 * exercised the insert. A row seeded before `fields` changed shape rendered an
 * empty form, because nothing ever wrote the new shape over it.
 */
beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The catalogue as a build two shapes ago left it. */
const staleRows = () =>
  seedCategories("owner-1", "2026-01-01T00:00:00.000Z").map((type) => ({
    ...type,
    label: `${type.label} (ancien)`,
    fields: [
      { id: "counterparty", kind: "text", label: "Vieux", required: false },
    ],
  })) as unknown as Parameters<typeof db.categories.bulkAdd>[0];

describe("seed — reconciling the built-in types", () => {
  it("rewrites a stale built-in's fields to the shape this build ships", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(staleRows());

    await seedIfEmpty();

    const achat = await db.categories.get({ key: "achat" });
    const shipped = BUILT_IN_CATEGORIES.find((type) => type.key === "achat")!;
    expect(achat?.label).toBe(shipped.label);
    expect(achat?.fields.map((field) => field.id)).toEqual(
      shipped.fields.map((field) => field.id),
    );
    expect(achat?.fields.every((field) => field.control !== undefined)).toBe(
      true,
    );
  });

  it("keeps the row's identity, so events still resolve and a restore still arbitrates", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(staleRows());
    const before = await db.categories.get({ key: "achat" });

    await seedIfEmpty();

    const after = await db.categories.get({ key: "achat" });
    expect(after?.id).toBe(before?.id);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("keeps a category the user switched off switched off", async () => {
    await seedIfEmpty();
    const veto = (await db.categories.get({ key: "veto" }))!;
    await db.categories.put({ ...veto, enabled: false });

    await seedIfEmpty();

    expect((await db.categories.get({ key: "veto" }))?.enabled).toBe(false);
  });

  it("does not resurrect a built-in the user deleted", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(staleRows());
    const achat = await db.categories.get({ key: "achat" });
    await db.categories.put({
      ...achat!,
      deletedAt: "2026-02-01T00:00:00.000Z",
    });

    await seedIfEmpty();

    expect(
      (await db.categories.get({ key: "achat" }))?.deletedAt,
    ).not.toBeNull();
  });

  it("leaves a type the user made themselves alone", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(staleRows());
    const mine = {
      ...(await db.categories.get({ key: "achat" }))!,
      isBuiltIn: false,
    };
    await db.categories.put(mine);

    await seedIfEmpty();

    expect((await db.categories.get({ key: "achat" }))?.label).toBe(mine.label);
  });

  it("writes nothing when every built-in already matches what this build ships", async () => {
    await seedIfEmpty();
    const bulkPut = vi.spyOn(db.categories, "bulkPut");

    await seedIfEmpty();

    expect(bulkPut).not.toHaveBeenCalled();
  });

  it("does not count a row stored with its keys in another order as changed", async () => {
    await seedIfEmpty();
    const veto = (await db.categories.get({ key: "veto" }))!;
    await db.categories.put(
      Object.fromEntries(Object.entries(veto).reverse()) as typeof veto,
    );
    const bulkPut = vi.spyOn(db.categories, "bulkPut");

    await seedIfEmpty();

    expect(bulkPut).not.toHaveBeenCalled();
  });

  it("rewrites only the built-in that drifted", async () => {
    await seedIfEmpty();
    const veto = (await db.categories.get({ key: "veto" }))!;
    await db.categories.put({ ...veto, label: "Vieux libellé" });
    const bulkPut = vi.spyOn(db.categories, "bulkPut");

    await seedIfEmpty();

    expect(bulkPut).toHaveBeenCalledTimes(1);
    expect(bulkPut.mock.calls[0]![0].map((row) => row.key)).toEqual(["veto"]);
    const shipped = BUILT_IN_CATEGORIES.find((type) => type.key === "veto")!;
    expect((await db.categories.get({ key: "veto" }))?.label).toBe(
      shipped.label,
    );
  });

  it("still rewrites a built-in carrying a key this build no longer ships", async () => {
    await seedIfEmpty();
    const veto = (await db.categories.get({ key: "veto" }))!;
    await db.categories.put({ ...veto, legacy: "gone" } as typeof veto);

    await seedIfEmpty();

    expect("legacy" in (await db.categories.get({ key: "veto" }))!).toBe(false);
  });

  it("inserts a built-in the device has never had, with its parent resolved", async () => {
    await db.categories.clear();
    await db.categories.bulkAdd(
      staleRows().filter((type) => type.key !== "massage"),
    );

    await seedIfEmpty();

    const massage = await db.categories.get({ key: "massage" });
    const soins = await db.categories.get({ key: "soins" });
    expect(massage).toBeDefined();
    expect(massage?.parentId).toBe(soins?.id);
  });
});
