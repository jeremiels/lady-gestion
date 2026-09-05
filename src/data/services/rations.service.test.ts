import { beforeEach, describe, expect, it } from "vitest";
import { HORSE_ID, makeRation, resetDb } from "../__tests__/factories.ts";
import { db } from "../db.ts";
import * as rationsRepo from "../repositories/rations.repo.ts";
import { DEFAULT_SEASON } from "../seasons.ts";
import type { RationItem } from "../types.ts";
import { rationFieldNames, saveRationSheet } from "./rations.service.ts";

/**
 * What the feed sheet writes, and — mostly — what it must leave alone.
 *
 * The rule worth the most coverage is the one with an invisible consequence: an
 * untouched line must not be re-saved, because `updatedAt` moving is what makes
 * `clearUntouchedSeedData` stop recognising a demo row. Getting that wrong
 * costs the user a duplicate feed plan on their next restore, several steps
 * removed from anything they did here.
 */

beforeEach(resetDb);

const seed = async (over: Partial<RationItem>[]): Promise<RationItem[]> => {
  await db.rationItems.bulkAdd(
    over.map((item, index) => makeRation({ sortOrder: index, ...item })),
  );
  return rationsRepo.listByHorse(HORSE_ID);
};

/** The sheet as submitted: a quantity per line, and the ticked checkboxes. */
const submitted = (
  entries: { id: string; quantity: string; seasonal?: boolean }[],
): FormData => {
  const form = new FormData();
  for (const entry of entries) {
    const names = rationFieldNames(entry.id);
    form.set(names.quantity, entry.quantity);
    // An unticked checkbox does not submit at all — that absence is the signal.
    if (entry.seasonal) form.set(names.seasonal, "on");
  }
  return form;
};

describe("field names", () => {
  it("are what the markup and the schema both read", async () => {
    // Pinned because the round trip depends on the exact string: the sheet
    // renders `name=${names.quantity}` and the schema parses the same key.
    expect(rationFieldNames("r1")).toEqual({
      quantity: "quantity-r1",
      seasonal: "seasonal-r1",
    });
  });
});

describe("writing", () => {
  it("saves a changed quantity", async () => {
    const [ration] = await seed([{ id: "fib", quantity: 1.5 }]);

    const result = await saveRationSheet(
      [ration!],
      submitted([{ id: "fib", quantity: "2" }]),
    );

    expect(result).toEqual({ ok: true, saved: 1 });
    expect((await rationsRepo.get("fib"))?.quantity).toBe(2);
  });

  it("accepts a comma decimal — the separator a French keyboard gives", async () => {
    const [ration] = await seed([{ id: "fib", quantity: 1 }]);

    await saveRationSheet(
      [ration!],
      submitted([{ id: "fib", quantity: "1,5" }]),
    );

    expect((await rationsRepo.get("fib"))?.quantity).toBe(1.5);
  });

  it("writes only the lines that moved", async () => {
    const rations = await seed([
      { id: "fib", quantity: 1.5 },
      { id: "cmv", quantity: 100 },
      { id: "sel", quantity: 30 },
    ]);

    const result = await saveRationSheet(
      rations,
      submitted([
        { id: "fib", quantity: "1.5" },
        { id: "cmv", quantity: "150" },
        { id: "sel", quantity: "30" },
      ]),
    );

    expect(result).toEqual({ ok: true, saved: 1 });
  });

  it("leaves an untouched line’s updatedAt alone, so the seed purge still knows it", async () => {
    // `clearUntouchedSeedData` recognises a demo row by createdAt === updatedAt.
    // Restamping one the user never edited makes the whole plan look
    // hand-entered and survive the restore it should have made room for.
    const rations = await seed([
      { id: "fib", quantity: 1.5 },
      { id: "cmv", quantity: 100 },
    ]);
    const before = (await rationsRepo.get("cmv"))!;

    await saveRationSheet(
      rations,
      submitted([
        { id: "fib", quantity: "3" },
        { id: "cmv", quantity: "100" },
      ]),
    );

    const after = (await rationsRepo.get("cmv"))!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.updatedAt).toBe(after.createdAt);
  });

  it("touches nothing at all when the sheet is submitted unchanged", async () => {
    const rations = await seed([{ id: "fib", quantity: 1.5 }]);
    const before = (await rationsRepo.get("fib"))!;

    const result = await saveRationSheet(
      [...rations],
      submitted([{ id: "fib", quantity: "1.5" }]),
    );

    expect(result).toEqual({ ok: true, saved: 0 });
    expect((await rationsRepo.get("fib"))?.updatedAt).toBe(before.updatedAt);
  });
});

describe("seasonality", () => {
  it("ticking the box opens the default window", async () => {
    const [ration] = await seed([{ id: "huile", quantity: 40, season: null }]);

    await saveRationSheet(
      [ration!],
      submitted([{ id: "huile", quantity: "40", seasonal: true }]),
    );

    expect((await rationsRepo.get("huile"))?.season).toEqual(DEFAULT_SEASON);
  });

  it("re-ticking restores the line’s own window rather than the default", async () => {
    // A stored Nov→Mar must not be flattened to Oct→Avr by a round trip through
    // a checkbox that can only say yes or no.
    const own = { from: 11, to: 3 } as const;
    const [ration] = await seed([{ id: "huile", quantity: 40, season: own }]);

    const result = await saveRationSheet(
      [ration!],
      submitted([{ id: "huile", quantity: "40", seasonal: true }]),
    );

    expect(result).toEqual({ ok: true, saved: 0 });
    expect((await rationsRepo.get("huile"))?.season).toEqual(own);
  });

  it("unticking clears the window", async () => {
    const [ration] = await seed([
      { id: "huile", quantity: 40, season: DEFAULT_SEASON },
    ]);

    await saveRationSheet(
      [ration!],
      submitted([{ id: "huile", quantity: "40" }]),
    );

    expect((await rationsRepo.get("huile"))?.season).toBeNull();
  });
});

describe("rejecting", () => {
  it("reports the field and writes nothing when a quantity is not a number", async () => {
    const rations = await seed([
      { id: "fib", quantity: 1.5 },
      { id: "cmv", quantity: 100 },
    ]);

    const result = await saveRationSheet(
      rations,
      submitted([
        { id: "fib", quantity: "3" },
        { id: "cmv", quantity: "beaucoup" },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors["quantity-cmv"]).toBeTruthy();
    // The valid line must not be written either — the plan is saved whole.
    expect((await rationsRepo.get("fib"))?.quantity).toBe(1.5);
  });

  it("rejects a negative quantity", async () => {
    const [ration] = await seed([{ id: "fib", quantity: 1.5 }]);

    const result = await saveRationSheet(
      [ration!],
      submitted([{ id: "fib", quantity: "-1" }]),
    );

    expect(result.ok).toBe(false);
    expect((await rationsRepo.get("fib"))?.quantity).toBe(1.5);
  });

  it("rejects a blank quantity rather than reading it as zero", async () => {
    const [ration] = await seed([{ id: "fib", quantity: 1.5 }]);

    const result = await saveRationSheet(
      [ration!],
      submitted([{ id: "fib", quantity: "" }]),
    );

    expect(result.ok).toBe(false);
    expect((await rationsRepo.get("fib"))?.quantity).toBe(1.5);
  });
});

describe("a line deleted underneath the sheet", () => {
  it("is skipped rather than resurrected", async () => {
    const rations = await seed([
      { id: "fib", quantity: 1.5 },
      { id: "cmv", quantity: 100 },
    ]);
    await rationsRepo.remove("cmv");

    const result = await saveRationSheet(
      rations,
      submitted([
        { id: "fib", quantity: "3" },
        { id: "cmv", quantity: "150" },
      ]),
    );

    // Both counted as patches — the service diffs against the list it was
    // given — but `updateMany` drops the id it can no longer find.
    expect(result).toEqual({ ok: true, saved: 2 });
    expect((await rationsRepo.get("fib"))?.quantity).toBe(3);
    expect(await rationsRepo.get("cmv")).toBeUndefined();
  });
});
