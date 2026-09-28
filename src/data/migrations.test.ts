import { describe, expect, it } from "vitest";
import { horseFullName } from "./horses.ts";
import { documentRowToV14, horseRowToV14 } from "./migrations.ts";
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

describe("documentRowToV14", () => {
  it("drops a v13 document, filed by category", () => {
    expect(
      documentRowToV14({ id: "d", category: "compte-rendu", postId: "p" }),
    ).toBe(null);
  });

  it("is replay-safe: a v14 document, filed by folder, passes through", () => {
    const row = { id: "d", folderId: "osteo", postId: "p" };
    expect(documentRowToV14(row)).toBe(row);
  });
});
