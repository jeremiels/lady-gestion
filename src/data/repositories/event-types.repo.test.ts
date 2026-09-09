import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db.ts";
import { makeEventType, resetDb } from "../__tests__/factories.ts";
import { BUILT_IN_EVENT_TYPES } from "../event-types.ts";
import * as eventTypesRepo from "./event-types.repo.ts";

/**
 * The catalogue's own writes. What is worth guarding here is everything the
 * pure helpers in `event-types.ts` cannot check on their own: that the depth
 * cap survives a write, and that removing or detaching a parent leaves its
 * children looking exactly as they did — `resolveCatalogue` treats a dangling
 * parent as a root, but only as a safety net, and a test that relied on it
 * would not notice the repair going missing.
 */

beforeEach(resetDb);

/** Replaces `resetDb`'s 14 built-ins with just what a case is about. */
const seed = async (types: Parameters<typeof makeEventType>[0][]) => {
  await db.eventTypes.clear();
  await db.eventTypes.bulkAdd(types.map((over) => makeEventType(over)));
};

const PARENT = {
  id: "p",
  key: "soins",
  label: "Soins",
  icon: "firstAidKit",
  theme: "pink",
  order: 0,
} as const;

describe("listResolved", () => {
  it("fills a child's theme in from its parent", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p", icon: "pawPrint", theme: null },
    ]);

    const types = await eventTypesRepo.listResolved();

    expect(types.find((type) => type.id === "c")).toMatchObject({
      icon: "pawPrint",
      theme: "pink",
    });
  });

  it("resolves the shipped catalogue, roots and the four nested types alike", async () => {
    const types = await eventTypesRepo.listResolved();

    expect(types).toHaveLength(14);
    expect(
      types
        .filter((type) => type.parentId !== null)
        .map((type) => type.key)
        .sort(),
    ).toEqual(["cures", "massage", "osteo", "traitement"]);

    // What a nested type resolves to is asserted against its *parent's* own
    // row rather than a copy of the palette: these four carry `null` for the
    // values they inherit, and stating the literal here would mean every
    // re-theming or re-iconing of a built-in breaks a test that is not about
    // either. The relationship is the rule; the colours are a design decision.
    const shipped = (key: string) =>
      BUILT_IN_EVENT_TYPES.find((type) => type.key === key)!;
    const resolved = (key: string) => types.find((type) => type.key === key)!;

    const inherits = (childKey: string, parentKey: string) => {
      const child = shipped(childKey);
      const parent = shipped(parentKey);
      expect(resolved(childKey)).toMatchObject({
        // A child's own icon wins when it has one — `osteo` keeps `pawPrint`
        // — and falls back to its parent's when it is `null`. Theme is always
        // the parent's: a group reads as one colour in the budget ring.
        icon: child.icon ?? parent.icon,
        theme: parent.theme,
      });
    };

    inherits("cures", "alimentation");
    inherits("traitement", "veto");
    inherits("osteo", "soins");
    inherits("massage", "soins");

    // A root still answers with its own.
    expect(resolved("travail")).toMatchObject({
      icon: shipped("travail").icon,
      theme: shipped("travail").theme,
    });
  });
});

describe("setParent", () => {
  it("attaches a type and clears its theme, so the group reads as one colour", async () => {
    await seed([PARENT, { id: "c", key: "veto", theme: "green" }]);

    const updated = await eventTypesRepo.setParent("c", "p");

    expect(updated).toMatchObject({ parentId: "p", theme: null });
    const resolved = await eventTypesRepo.listResolved();
    expect(resolved.find((type) => type.id === "c")?.theme).toBe("pink");
  });

  it("leaves the icon alone — it is what tells a child from its siblings", async () => {
    await seed([PARENT, { id: "c", key: "veto", icon: "pawPrint" }]);

    const updated = await eventTypesRepo.setParent("c", "p");

    expect(updated?.icon).toBe("pawPrint");
  });

  it("refuses a parent that is itself a child rather than writing a three-deep chain", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p" },
      { id: "x", key: "cours" },
    ]);

    expect(await eventTypesRepo.setParent("x", "c")).toBeUndefined();
    expect((await db.eventTypes.get("x"))?.parentId).toBeNull();
  });

  it("refuses a type as its own parent", async () => {
    await seed([PARENT]);

    expect(await eventTypesRepo.setParent("p", "p")).toBeUndefined();
    expect((await db.eventTypes.get("p"))?.parentId).toBeNull();
  });

  it("refuses to give a parent to a type that already has children", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p" },
      { id: "x", key: "cours" },
    ]);

    expect(await eventTypesRepo.setParent("p", "x")).toBeUndefined();
  });

  it("answers undefined for a type that is not there", async () => {
    await seed([PARENT]);

    expect(await eventTypesRepo.setParent("gone", "p")).toBeUndefined();
  });

  it("materialises the inherited presentation when detaching, so nothing repaints", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p", icon: null, theme: null },
    ]);

    const detached = await eventTypesRepo.setParent("c", null);

    expect(detached).toMatchObject({
      parentId: null,
      icon: "firstAidKit",
      theme: "pink",
    });
  });

  it("does not re-stamp a root that is already detached", async () => {
    await seed([PARENT]);
    const before = await db.eventTypes.get("p");

    await eventTypesRepo.setParent("p", null);

    expect((await db.eventTypes.get("p"))?.updatedAt).toBe(before?.updatedAt);
  });
});

describe("remove", () => {
  it("promotes a deleted parent's children to roots", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p", icon: null, theme: null },
    ]);

    await eventTypesRepo.remove("p");

    expect((await db.eventTypes.get("c"))?.parentId).toBeNull();
  });

  it("keeps a promoted child looking exactly as it did", async () => {
    await seed([
      PARENT,
      { id: "c", key: "veto", parentId: "p", icon: null, theme: null },
    ]);

    await eventTypesRepo.remove("p");

    // Not `resolveCatalogue` falling back — the values are on the row now, so
    // a backup carrying both rows cannot merge them back into disagreement.
    expect(await db.eventTypes.get("c")).toMatchObject({
      icon: "firstAidKit",
      theme: "pink",
    });
  });

  it("writes the parent's tombstone rather than dropping the row", async () => {
    await seed([PARENT]);

    await eventTypesRepo.remove("p");

    expect((await db.eventTypes.get("p"))?.deletedAt).not.toBeNull();
    expect(await eventTypesRepo.get("p")).toBeUndefined();
  });

  it("is a no-op on a type that is already gone", async () => {
    await seed([PARENT]);
    await eventTypesRepo.remove("p");
    const tombstoned = await db.eventTypes.get("p");

    await eventTypesRepo.remove("p");

    expect((await db.eventTypes.get("p"))?.deletedAt).toBe(
      tombstoned?.deletedAt,
    );
  });
});
