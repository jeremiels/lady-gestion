import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { DEFAULT_SEASON } from "../data/index.ts";
import { makeHorse, makeRation, resetDb } from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./HorseView.ts";
import type { HorseView } from "./HorseView.ts";

const mount = () => fixture<HorseView>(html`<horse-view></horse-view>`);

/**
 * The form field for one ration line's quantity, or its seasonal checkbox.
 *
 * `name` is a plain reactive property, not a reflected attribute — it exists
 * only on the shadow-root native control, not as a light-DOM `app-input`
 * attribute — so this has to filter by the property instead of a CSS
 * attribute selector.
 */
const quantityField = (el: HorseView, rationId: string) =>
  [...el.querySelectorAll("app-input")].find(
    (input) => input.name === `quantity-${rationId}`,
  )!;
const seasonalField = (el: HorseView, rationId: string) =>
  [...el.querySelectorAll("app-checkbox")].find(
    (checkbox) => checkbox.name === `seasonal-${rationId}`,
  )!;

const setQuantity = async (el: HorseView, rationId: string, value: string) => {
  const field = quantityField(el, rationId);
  const input = field.renderRoot.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(field);
};

const toggleSeasonal = async (el: HorseView, rationId: string) => {
  const field = seasonalField(el, rationId);
  field.renderRoot.querySelector("input")!.click();
  await settled(field);
};

const submitRationSheet = async (el: HorseView) => {
  el.querySelector<HTMLFormElement>("#ration-form")!.requestSubmit();
  await settled(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settled(el);
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse({ breed: "Selle Français" }));
});

describe("horse-view", () => {
  it("shows the identity card, falling back to — for what is unknown", async () => {
    const el = await mount();
    await waitFor(el, () => el.textContent!.includes("Selle Français"));

    const identity = el.querySelectorAll(".horse-view__meta")[0]!;
    const values = [...identity.querySelectorAll(".meta-value")].map((node) =>
      node.textContent?.trim(),
    );

    // Sexe, Âge, Race, N° Sire, in that order.
    expect(values[0]).toBe("Jument");
    expect(values[2]).toBe("Selle Français");
    expect(values[3]).toBe("—"); // sireNumber is null in the factory default
  });

  it("shows the empty ration state and disables editing when there are no rations", async () => {
    const el = await mount();
    await waitFor(el, () => el.textContent!.includes("Ration quotidienne"));

    expect(el.textContent).toContain(
      "Aucune ration enregistrée pour le moment.",
    );
    expect(
      el.querySelector<HTMLButtonElement>(".horse-view__edit-button")?.disabled,
    ).toBe(true);
  });

  /**
   * This is the exact bug `AGENTS.md` records against `HorseView`: the sheet
   * used to hardcode five product names and read four different keys, so
   * saving wrote one unlabeled row and silently dropped the rest. Building
   * both the schema and the field names from the same `rations` list is what
   * fixed it — this pins that a row nobody touched stays untouched, and a row
   * that was edited is the only one re-saved.
   */
  it("writes only the ration lines that were actually changed", async () => {
    await db.rationItems.bulkAdd([
      makeRation({
        id: "ration-a",
        label: "Fib & Fib",
        quantity: 1.5,
        unit: "L",
        sortOrder: 0,
      }),
      makeRation({
        id: "ration-b",
        label: "CMV Minéral",
        quantity: 2,
        unit: "kg",
        sortOrder: 1,
      }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll(".ration-item").length === 2);

    el.querySelector<HTMLButtonElement>(".horse-view__edit-button")!.click();
    await settled(el);

    await setQuantity(el, "ration-a", "2,5");
    await submitRationSheet(el);

    const a = await db.rationItems.get("ration-a");
    const b = await db.rationItems.get("ration-b");

    expect(a?.quantity).toBe(2.5);
    expect(a?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    // Untouched: same quantity, and — the point of the fix — the same
    // `updatedAt`, which is what tells a re-saved seed row from a real edit.
    expect(b?.quantity).toBe(2);
    expect(b?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ticking Saisonnier stores the default window, and unticking clears it", async () => {
    await db.rationItems.bulkAdd([
      makeRation({
        id: "ration-a",
        label: "Fib & Fib",
        quantity: 1.5,
        unit: "L",
        season: null,
        sortOrder: 0,
      }),
      makeRation({
        id: "ration-b",
        label: "Huile de lin",
        quantity: 0.1,
        unit: "L",
        season: DEFAULT_SEASON,
        sortOrder: 1,
      }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll(".ration-item").length === 2);

    el.querySelector<HTMLButtonElement>(".horse-view__edit-button")!.click();
    await settled(el);

    await toggleSeasonal(el, "ration-a");
    await toggleSeasonal(el, "ration-b");
    await submitRationSheet(el);

    const a = await db.rationItems.get("ration-a");
    const b = await db.rationItems.get("ration-b");

    expect(a?.season).toEqual(DEFAULT_SEASON);
    expect(b?.season).toBeNull();
  });
});
