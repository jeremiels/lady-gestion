import { describe, expect, it } from "vitest";
import { horseFullName } from "./horses.ts";

describe("horseFullName", () => {
  it("joins prénom and nom, and drops a missing nom", () => {
    expect(
      horseFullName({ firstName: "Ladympala", lastName: "Coupe Chêne" }),
    ).toBe("Ladympala Coupe Chêne");
    expect(horseFullName({ firstName: "Étoile", lastName: null })).toBe(
      "Étoile",
    );
  });
});
