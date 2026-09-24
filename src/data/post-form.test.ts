import { describe, expect, it } from "vitest";
import { readForm } from "./forms.ts";
import { BUILT_IN_CATEGORY_ROWS } from "./__tests__/factories.ts";
import {
  controlsOf,
  crossFieldErrors,
  fieldSchema,
  pairErrorsOf,
  splitUnitValue,
  unitNameOf,
  valueOf,
} from "./post-form.ts";
import type { CustomFieldDef } from "./types.ts";

/**
 * The layer that turns a category's `fields` into a form and its answers back
 * into the scalars a record holds.
 *
 * It had no tests at all until this file. What it replaced — a bespoke
 * quantity/follow-up pair in `posts.ts` — had forty lines of them, and they
 * kept passing long after nothing called the code they covered. So these are
 * written against the behaviour the *live* path has, and several are ported
 * straight from those deleted blocks: the round trip, the both-or-neither
 * pair rule, the French decimal comma.
 */

const field = (
  over: Partial<CustomFieldDef> & { id: string },
): CustomFieldDef => ({
  label: "Champ",
  required: false,
  control: "text",
  ...over,
});

describe("unitNameOf / controlsOf", () => {
  it("derives the unit control's name so no caller spells it", () => {
    expect(unitNameOf(field({ id: "quantity" }))).toBe("quantity-unit");
  });

  it("names one control for a plain field", () => {
    expect(controlsOf(field({ id: "title" }))).toEqual(["title"]);
  });

  it("names the unit picker alongside the value", () => {
    expect(
      controlsOf(field({ id: "quantity", control: "number", units: ["kg"] })),
    ).toEqual(["quantity", "quantity-unit"]);
  });

  it("descends into what a checkbox reveals", () => {
    const followUp = field({
      id: "followUp",
      control: "checkbox",
      reveals: [field({ id: "followUp-interval", control: "select" })],
    });

    expect(controlsOf(followUp)).toEqual(["followUp", "followUp-interval"]);
  });
});

describe("fieldSchema", () => {
  const parse = (definition: CustomFieldDef, entries: [string, string][]) => {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return readForm(data, fieldSchema(definition));
  };

  it("parses a required text field, and rejects it blank", () => {
    const title = field({ id: "title", required: true });

    expect(parse(title, [["title", "Ferrure"]])).toEqual({
      ok: true,
      value: { title: "Ferrure" },
    });
    expect(parse(title, [["title", "  "]]).ok).toBe(false);
  });

  it("reads money as integer cents", () => {
    const amount = field({ id: "amountCents", control: "money" });

    expect(parse(amount, [["amountCents", "12,50"]])).toEqual({
      ok: true,
      value: { amountCents: 1250 },
    });
  });

  it("accepts the French decimal comma on a number", () => {
    const dosage = field({ id: "dosage", control: "number" });

    expect(parse(dosage, [["dosage", "1,5"]])).toEqual({
      ok: true,
      value: { dosage: 1.5 },
    });
  });

  it("holds a select to its own options", () => {
    const result = field({
      id: "result",
      control: "select",
      options: [{ value: "4pts", label: "4 pts" }],
    });

    expect(parse(result, [["result", "4pts"]]).ok).toBe(true);
    expect(parse(result, [["result", "inventé"]]).ok).toBe(false);
  });

  it("lets a combobox through as free text, options or not", () => {
    // The whole point of a combobox over a select: the user can name something
    // the catalogue has never seen.
    const activity = field({
      id: "activity",
      control: "combobox",
      options: [{ value: "plat", label: "Plat" }],
    });

    expect(parse(activity, [["activity", "Séance dressage"]])).toEqual({
      ok: true,
      value: { activity: "Séance dressage" },
    });
  });

  it("never marks a units field required on its own", () => {
    // A value and its unit are required together — only the pair can decide,
    // which is `pairErrorsOf`'s job.
    const quantity = field({
      id: "quantity",
      control: "number",
      required: true,
      units: ["kg", "L"],
    });

    expect(parse(quantity, []).ok).toBe(true);
  });

  it("declares a revealed field optional however it describes itself", () => {
    // It is only in the DOM while its checkbox is ticked; the checkbox decides
    // whether its answer counts.
    const followUp = field({
      id: "followUp",
      control: "checkbox",
      reveals: [
        field({
          id: "followUp-interval",
          control: "select",
          required: true,
          options: [{ value: "6w", label: "6 semaines" }],
        }),
      ],
    });

    expect(parse(followUp, []).ok).toBe(true);
  });
});

describe("valueOf", () => {
  it("folds an amount and a unit into one French-formatted scalar", () => {
    // Ported from the deleted `formatQuantity` block: `customFields` values
    // have to survive a JSON round trip, so the pair collapses rather than
    // nests.
    const quantity = field({ id: "quantity", control: "number", units: ["L"] });

    expect(valueOf(quantity, { quantity: 1.5, "quantity-unit": "L" })).toBe(
      "1,5 L",
    );
    expect(valueOf(quantity, { quantity: 40, "quantity-unit": "mL" })).toBe(
      "40 mL",
    );
  });

  it("stores nothing for a half-filled units pair", () => {
    const quantity = field({ id: "quantity", control: "number", units: ["L"] });

    expect(valueOf(quantity, { quantity: 40 })).toBe(null);
    expect(valueOf(quantity, { "quantity-unit": "L" })).toBe(null);
  });

  it("stores what a ticked checkbox revealed, under the checkbox's own id", () => {
    const followUp = field({
      id: "followUp",
      control: "checkbox",
      reveals: [
        field({
          id: "followUp-interval",
          control: "select",
          options: [{ value: "6w", label: "6 semaines" }],
        }),
      ],
    });

    expect(
      valueOf(followUp, { followUp: true, "followUp-interval": "6w" }),
    ).toBe("6w");
  });

  it("stores null when the checkbox is unticked, whatever it revealed", () => {
    const followUp = field({
      id: "followUp",
      control: "checkbox",
      reveals: [field({ id: "followUp-interval", control: "select" })],
    });

    expect(
      valueOf(followUp, { followUp: false, "followUp-interval": "6w" }),
    ).toBe(null);
  });

  it("refuses a value a closed list does not offer", () => {
    // What the follow-up's bespoke round trip used to guarantee for one field,
    // stated over `options` so it holds for every field that has them —
    // including a value restored from a backup written by another build.
    const result = field({
      id: "result",
      control: "select",
      options: [{ value: "4pts", label: "4 pts" }],
    });

    expect(valueOf(result, { result: "4pts" })).toBe("4pts");
    expect(valueOf(result, { result: "8pts" })).toBe(null);
  });

  it("reads a blank or absent answer as null, never as an empty string", () => {
    const notes = field({ id: "notes" });

    expect(valueOf(notes, {})).toBe(null);
    expect(valueOf(notes, { notes: "" })).toBe(null);
  });
});

describe("pairErrorsOf", () => {
  const quantity = field({ id: "quantity", control: "number", units: ["kg"] });

  it("is fine with both present, or neither", () => {
    expect(
      pairErrorsOf(quantity, { quantity: 40, "quantity-unit": "kg" }),
    ).toEqual({});
    expect(pairErrorsOf(quantity, {})).toEqual({});
  });

  it("blames the amount when only the unit is picked", () => {
    expect(pairErrorsOf(quantity, { "quantity-unit": "kg" })).toEqual({
      quantity: "Indiquez une quantité.",
    });
  });

  it("blames the unit when only the amount is typed", () => {
    expect(pairErrorsOf(quantity, { quantity: 40 })).toEqual({
      "quantity-unit": "Choisissez une unité.",
    });
  });

  it("has nothing to say about a field with no units", () => {
    expect(pairErrorsOf(field({ id: "title" }), { title: "x" })).toEqual({});
  });
});

describe("splitUnitValue", () => {
  it("splits a stored scalar back into its amount and unit for prefill", () => {
    expect(splitUnitValue("40 mL")).toEqual({ amount: "40", unit: "mL" });
  });

  it("normalises the French comma back to a dot for the input", () => {
    expect(splitUnitValue("1,5 L")).toEqual({ amount: "1.5", unit: "L" });
  });

  it("round-trips whatever valueOf wrote", () => {
    const quantity = field({ id: "quantity", control: "number", units: ["L"] });
    const stored = valueOf(quantity, { quantity: 1.5, "quantity-unit": "L" });

    expect(splitUnitValue(stored)).toEqual({ amount: "1.5", unit: "L" });
  });

  it("gives an empty pair for anything it cannot read, rather than a guess", () => {
    expect(splitUnitValue("")).toEqual({ amount: "", unit: "" });
    expect(splitUnitValue("40")).toEqual({ amount: "", unit: "" });
    expect(splitUnitValue(null)).toEqual({ amount: "", unit: "" });
    expect(splitUnitValue(42)).toEqual({ amount: "", unit: "" });
  });
});

describe("crossFieldErrors", () => {
  const cures = BUILT_IN_CATEGORY_ROWS.find((type) => type.key === "cures")!;

  it("puts a ticked reminder with no time under the time control", () => {
    expect(
      crossFieldErrors(cures, {
        date: "2026-06-15",
        reminder: true,
        "reminder-offset": "1h",
      }),
    ).toEqual({ time: "Indiquez une heure pour la notification." });
  });

  it("lets a course have a time and no reminder, or neither", () => {
    expect(
      crossFieldErrors(cures, { date: "2026-06-15", time: "08:30" }),
    ).toEqual({});
    expect(crossFieldErrors(cures, { date: "2026-06-15" })).toEqual({});
  });
});
