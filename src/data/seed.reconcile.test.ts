import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import { BUILT_IN_EVENT_TYPES, seedEventTypeDefs } from "./event-types.ts";
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

/** The catalogue as a build two shapes ago left it. */
const staleRows = () =>
  seedEventTypeDefs("owner-1", "2026-01-01T00:00:00.000Z").map((type) => ({
    ...type,
    label: `${type.label} (ancien)`,
    fields: [
      { id: "counterparty", kind: "text", label: "Vieux", required: false },
    ],
  })) as unknown as Parameters<typeof db.eventTypes.bulkAdd>[0];

describe("seed — reconciling the built-in types", () => {
  it("rewrites a stale built-in's fields to the shape this build ships", async () => {
    await db.eventTypes.clear();
    await db.eventTypes.bulkAdd(staleRows());

    await seedIfEmpty();

    const achat = await db.eventTypes.get({ key: "achat" });
    const shipped = BUILT_IN_EVENT_TYPES.find((type) => type.key === "achat")!;
    expect(achat?.label).toBe(shipped.label);
    expect(achat?.fields.map((field) => field.id)).toEqual(
      shipped.fields.map((field) => field.id),
    );
    expect(achat?.fields.every((field) => field.control !== undefined)).toBe(
      true,
    );
  });

  it("keeps the row's identity, so events still resolve and a restore still arbitrates", async () => {
    await db.eventTypes.clear();
    await db.eventTypes.bulkAdd(staleRows());
    const before = await db.eventTypes.get({ key: "achat" });

    await seedIfEmpty();

    const after = await db.eventTypes.get({ key: "achat" });
    expect(after?.id).toBe(before?.id);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("does not resurrect a built-in the user deleted", async () => {
    await db.eventTypes.clear();
    await db.eventTypes.bulkAdd(staleRows());
    const achat = await db.eventTypes.get({ key: "achat" });
    await db.eventTypes.put({
      ...achat!,
      deletedAt: "2026-02-01T00:00:00.000Z",
    });

    await seedIfEmpty();

    expect(
      (await db.eventTypes.get({ key: "achat" }))?.deletedAt,
    ).not.toBeNull();
  });

  it("leaves a type the user made themselves alone", async () => {
    await db.eventTypes.clear();
    await db.eventTypes.bulkAdd(staleRows());
    const mine = {
      ...(await db.eventTypes.get({ key: "achat" }))!,
      isBuiltIn: false,
    };
    await db.eventTypes.put(mine);

    await seedIfEmpty();

    expect((await db.eventTypes.get({ key: "achat" }))?.label).toBe(mine.label);
  });

  it("inserts a built-in the device has never had, with its parent resolved", async () => {
    await db.eventTypes.clear();
    await db.eventTypes.bulkAdd(
      staleRows().filter((type) => type.key !== "massage"),
    );

    await seedIfEmpty();

    const massage = await db.eventTypes.get({ key: "massage" });
    const soins = await db.eventTypes.get({ key: "soins" });
    expect(massage).toBeDefined();
    expect(massage?.parentId).toBe(soins?.id);
  });
});
