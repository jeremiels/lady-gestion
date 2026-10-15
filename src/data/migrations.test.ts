import { describe, expect, it } from "vitest";
import { horseFullName } from "./horses.ts";
import {
  categoryRowToV16,
  documentRowToV15,
  horseRowToV14,
} from "./migrations.ts";
import type { Horse } from "./types.ts";

describe("horseRowToV14", () => {
  it("reads the first word as the prénom and the rest as the nom", () => {
    expect(horseRowToV14({ id: "h", name: "Ladympala Coupe Chêne" })).toEqual({
      id: "h",
      firstName: "Ladympala",
      lastName: "Coupe Chêne",
    });
  });

  it("leaves a one-word name without a nom", () => {
    expect(horseRowToV14({ id: "h", name: "  Étoile " })).toEqual({
      id: "h",
      firstName: "Étoile",
      lastName: null,
    });
  });

  it("shows the same name the v13 row did", () => {
    const row = horseRowToV14({ name: "Ladympala Coupe Chêne" });
    expect(horseFullName(row as Pick<Horse, "firstName" | "lastName">)).toBe(
      "Ladympala Coupe Chêne",
    );
  });

  it("is replay-safe: a second run changes nothing", () => {
    const once = horseRowToV14({ id: "h", name: "Ladympala Coupe Chêne" });
    expect(horseRowToV14(once)).toEqual(once);
  });

  it("leaves a row without a string name for validation to refuse", () => {
    const row = { id: "h", name: 42 };
    expect(horseRowToV14(row)).toBe(row);
  });
});

describe("documentRowToV15", () => {
  it("drops a v14 document, filed by category", () => {
    expect(
      documentRowToV15({ id: "d", category: "compte-rendu", postId: "p" }),
    ).toBe(null);
  });

  it("is replay-safe: a v15 document, filed by folder, passes through", () => {
    const row = { id: "d", folderId: "osteo", postId: "p" };
    expect(documentRowToV15(row)).toBe(row);
  });
});

describe("categoryRowToV16", () => {
  const v15 = {
    id: "veto",
    updatedAt: "2026-09-01T00:00:00.000Z",
    fields: [
      { id: "title", control: "text", label: "Nom", required: true },
      {
        id: "counterparty",
        control: "text",
        label: "Practicien",
        required: false,
        defaultValue: "Dr. X",
      },
      { id: "amountCents", control: "money", label: "Budget", required: false },
      {
        id: "followUp",
        control: "checkbox",
        label: "Planifier",
        required: false,
        role: "followUp",
      },
    ],
  };

  it("names the budget and the intervenant, and nothing else", () => {
    const row = categoryRowToV16(v15) as typeof v15 & {
      fields: { id: string; role?: string }[];
    };
    expect(row.fields.map((field) => field.role)).toEqual([
      undefined,
      "counterparty",
      "budget",
      "followUp",
    ]);
    // Everything else about each field is kept, default value included.
    expect(row.fields[1]).toEqual({ ...v15.fields[1], role: "counterparty" });
  });

  it("leaves updatedAt alone", () => {
    expect(categoryRowToV16(v15).updatedAt).toBe(v15.updatedAt);
  });

  it("is replay-safe: a second run changes nothing", () => {
    const once = categoryRowToV16(v15);
    expect(categoryRowToV16(once)).toBe(once);
  });

  it("keeps a role a field already has", () => {
    const row = {
      fields: [{ id: "amountCents", control: "money", role: "counterparty" }],
    };
    expect(categoryRowToV16(row)).toBe(row);
  });

  it("returns a row with no field to name untouched", () => {
    const row = { id: "pension", fields: [{ id: "constructor" }] };
    expect(categoryRowToV16(row)).toBe(row);
  });

  it("leaves a row without a fields array for validation to refuse", () => {
    const row = { id: "x", fields: "nope" };
    expect(categoryRowToV16(row)).toBe(row);
  });
});
