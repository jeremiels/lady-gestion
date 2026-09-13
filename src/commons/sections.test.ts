import { describe, expect, it } from "vitest";
import {
  horseRouteOf,
  horseTransitionType,
  isLateral,
  SECTIONS,
  sectionOf,
} from "./sections.ts";

/**
 * The section table decides two things the user sees: which nav item is lit,
 * and whether a route change fades sideways or slides forward. Both are pure
 * functions of a path, and both were wrong in ways nothing here would have
 * caught before this file existed.
 */

/** Every section root, app-relative — what `Router` passes `isLateral`. */
const ROOTS = ["/", "/events", "/budget", "/documents"];

describe("sectionOf", () => {
  it("claims each section root for its own section", () => {
    expect(ROOTS.map((path) => sectionOf(path)?.id)).toEqual([
      "home",
      "events",
      "budget",
      "documents",
    ]);
  });

  it("keeps a drill-down in the section it was reached from", () => {
    expect(sectionOf("/horse")?.id).toBe("home");
    expect(sectionOf("/horse/abc")?.id).toBe("home");
    expect(sectionOf("/events/abc")?.id).toBe("events");
  });

  it("claims no section for a path outside the table", () => {
    expect(sectionOf("/nope")).toBeUndefined();
  });

  /**
   * The regression that lit Accueil and Budget at once: `matches` predicates
   * have to partition the paths, because the nav asks each one independently
   * while `sectionOf` stops at the first. Asserted over every root rather than
   * over `/budget` alone, so a fifth section cannot reintroduce the overlap
   * somewhere else.
   */
  it("has exactly one section claiming each root", () => {
    for (const path of ROOTS) {
      expect(
        SECTIONS.filter((section) => section.matches(path)).map((s) => s.id),
      ).toHaveLength(1);
    }
  });
});

describe("isLateral", () => {
  it("is true between any two different section roots", () => {
    const pairs = ROOTS.flatMap((from) =>
      ROOTS.filter((to) => to !== from).map((to) => [from, to]),
    );

    for (const [from, to] of pairs) {
      expect(isLateral(from!, to!), `${from} -> ${to}`).toBe(true);
    }
  });

  it("is false landing a level down, even across sections", () => {
    // The deep-link case the predicate's "onto a root" half exists for.
    expect(isLateral("/documents", "/events/abc")).toBe(false);
    expect(isLateral("/", "/horse/abc")).toBe(false);
  });

  it("is false within one section", () => {
    expect(isLateral("/horse", "/")).toBe(false);
    expect(isLateral("/events/abc", "/events")).toBe(false);
  });

  it("is false leaving a path that belongs to no section", () => {
    expect(isLateral("/nope", "/events")).toBe(false);
  });
});

describe("horseRouteOf", () => {
  it("defaults to the first tab, so horse-card's plain link still lands", () => {
    expect(horseRouteOf("/horse")).toEqual({ horseId: null, tab: "ration" });
    expect(horseRouteOf("/horse/abc")).toEqual({
      horseId: "abc",
      tab: "ration",
    });
  });

  it("reads a known tab", () => {
    expect(horseRouteOf("/horse/abc/cheval")).toEqual({
      horseId: "abc",
      tab: "cheval",
    });
  });

  it("refuses an unknown tab or a deeper path, so the 404 gets them", () => {
    expect(horseRouteOf("/horse/abc/nope")).toBeNull();
    expect(horseRouteOf("/horse/abc/cheval/extra")).toBeNull();
    expect(horseRouteOf("/horses")).toBeNull();
  });
});

describe("horseTransitionType", () => {
  it("morphs the card only on the way in or out of the horse page", () => {
    expect(horseTransitionType("/", "/horse/abc")).toBe("horse");
    expect(horseTransitionType("/horse/abc/cures", "/")).toBe("horse");
  });

  it("keeps the page still between two of its sub-pages", () => {
    expect(horseTransitionType("/horse/abc", "/horse/abc/cheval")).toBe(
      "horse-subpage",
    );
  });

  it("is nothing for a navigation that never touches the horse", () => {
    expect(horseTransitionType("/", "/events")).toBeNull();
  });
});
