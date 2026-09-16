import { beforeEach, describe, expect, it } from "vitest";
import { HORSE_ID, makeRation, resetDb } from "../__tests__/factories.ts";
import { db } from "../db.ts";
import * as rationsRepo from "../repositories/rations.repo.ts";
import type { RationItem } from "../types.ts";
import {
  RATION_ADD_FIELDS,
  addRation,
  updateRation,
} from "./rations.service.ts";

/**
 * What the ration form writes, and — for an edit — what it must leave alone.
 *
 * The rule worth the most coverage is the one with an invisible consequence: an
 * unchanged line must not be re-saved, because `updatedAt` moving is what makes
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

/** The form as submitted; a blank month is what an untouched select sends. */
const submitted = (fields: {
  label?: string;
  quantity?: string;
  unit?: string;
  seasonFrom?: string;
  seasonTo?: string;
}): FormData => {
  const form = new FormData();
  for (const [key, name] of Object.entries(RATION_ADD_FIELDS)) {
    form.set(name, fields[key as keyof typeof fields] ?? "");
  }
  return form;
};

describe("editing a product", () => {
  it("writes every field that moved", async () => {
    const [ration] = await seed([
      { id: "fib", label: "Fib", quantity: 1.5, unit: "kg", season: null },
    ]);

    const result = await updateRation(
      ration!,
      submitted({
        label: "Fib & Fib",
        quantity: "2,5",
        unit: "L",
        seasonFrom: "11",
        seasonTo: "3",
      }),
    );

    expect(result).toEqual({ ok: true, saved: true });
    expect(await rationsRepo.get("fib")).toMatchObject({
      label: "Fib & Fib",
      quantity: 2.5,
      unit: "L",
      season: { from: 11, to: 3 },
    });
  });

  it("clears the window when both months are blanked", async () => {
    const [ration] = await seed([
      { id: "fib", unit: "g", season: { from: 11, to: 3 } },
    ]);

    await updateRation(
      ration!,
      submitted({ label: ration!.label, quantity: "1", unit: "g" }),
    );

    expect((await rationsRepo.get("fib"))?.season).toBeNull();
  });

  it("touches nothing when submitted unchanged, so the seed purge still knows it", async () => {
    const [ration] = await seed([
      {
        id: "fib",
        label: "Fib",
        quantity: 1.5,
        unit: "kg",
        season: { from: 11, to: 3 },
      },
    ]);

    const result = await updateRation(
      ration!,
      submitted({
        label: "Fib",
        quantity: "1.5",
        unit: "kg",
        seasonFrom: "11",
        seasonTo: "3",
      }),
    );

    expect(result).toEqual({ ok: true, saved: false });
    expect((await rationsRepo.get("fib"))?.updatedAt).toBe(ration!.updatedAt);
  });

  it("keeps a legacy unit the add form no longer offers", async () => {
    const [ration] = await seed([{ id: "vit", unit: "dose", quantity: 1 }]);

    const result = await updateRation(
      ration!,
      submitted({ label: ration!.label, quantity: "2", unit: "dose" }),
    );

    expect(result.ok).toBe(true);
    expect(await rationsRepo.get("vit")).toMatchObject({
      unit: "dose",
      quantity: 2,
    });
  });

  it("reports every problem and writes nothing", async () => {
    const [ration] = await seed([{ id: "fib", quantity: 1.5 }]);

    const result = await updateRation(
      ration!,
      submitted({ label: "", quantity: "-1", unit: "g", seasonFrom: "10" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.label).toBeTruthy();
    expect(result.ok === false && result.errors.quantity).toBeTruthy();
    expect(result.ok === false && result.errors.seasonTo).toBeTruthy();
    expect((await rationsRepo.get("fib"))?.updatedAt).toBe(ration!.updatedAt);
  });
});

describe("adding a product", () => {
  it("appends a line fed all year when no period is picked", async () => {
    await seed([{ id: "fib", quantity: 1.5 }]);

    const result = await addRation(
      HORSE_ID,
      submitted({ label: " Sel ", quantity: "15", unit: "g" }),
    );

    expect(result.ok).toBe(true);
    const plan = await rationsRepo.listByHorse(HORSE_ID);
    expect(plan.map((item) => item.label)).toEqual(["Fib & Fib", "Sel"]);
    expect(plan[1]).toMatchObject({ quantity: 15, unit: "g", season: null });
  });

  it("stores the picked window, including one that wraps the year", async () => {
    const result = await addRation(
      HORSE_ID,
      submitted({
        label: "Huile de lin",
        quantity: "40",
        unit: "mL",
        seasonFrom: "10",
        seasonTo: "4",
      }),
    );

    expect(result.ok && result.item.season).toEqual({ from: 10, to: 4 });
  });

  it("accepts a comma decimal", async () => {
    const result = await addRation(
      HORSE_ID,
      submitted({ label: "Fib", quantity: "1,5", unit: "L" }),
    );

    expect(result.ok && result.item.quantity).toBe(1.5);
  });

  it("rejects a period with only one month, alongside every other problem", async () => {
    const result = await addRation(
      HORSE_ID,
      submitted({ label: "", quantity: "40", unit: "mL", seasonFrom: "10" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.seasonTo).toBeTruthy();
    expect(result.ok === false && result.errors.label).toBeTruthy();
    expect(await rationsRepo.listByHorse(HORSE_ID)).toEqual([]);
  });

  it("rejects a unit the form does not offer, and a missing quantity", async () => {
    const result = await addRation(
      HORSE_ID,
      submitted({ label: "Vitamine E", quantity: "", unit: "dose" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.unit).toBeTruthy();
    expect(result.ok === false && result.errors.quantity).toBeTruthy();
    expect(await rationsRepo.listByHorse(HORSE_ID)).toEqual([]);
  });
});
