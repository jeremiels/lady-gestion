import { describe, expect, it } from "vitest";
import {
  customizeRouteOf,
  customizeTransitionType,
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

/**
 * Every nav item's destination, app-relative — what `Router` passes
 * `isLateral`. Cheval's carries the horse's id, so its landing is not its
 * `root`; that asymmetry is the whole reason `Section.landsOn` exists.
 */
const LANDINGS = ["/", "/posts", "/budget", "/horse/abc"];

/** Every `SECTIONS[].root`, in table order. */
const ROOTS = ["/", "/posts", "/budget", "/horse"];

describe("sectionOf", () => {
  it("claims each section root for its own section", () => {
    expect(ROOTS.map((path) => sectionOf(path)?.id)).toEqual([
      "home",
      "posts",
      "budget",
      "horses",
    ]);
  });

  it("keeps a drill-down in the section it was reached from", () => {
    expect(sectionOf("/horse/abc")?.id).toBe("horses");
    expect(sectionOf("/horse/abc/cheval")?.id).toBe("horses");
    expect(sectionOf("/posts/abc")?.id).toBe("posts");
  });

  it("leaves the dashboard unlit once the user is on the horse's page", () => {
    expect(sectionOf("/horse/abc")?.id).not.toBe("home");
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
    for (const path of [...ROOTS, ...LANDINGS]) {
      expect(
        SECTIONS.filter((section) => section.matches(path)).map((s) => s.id),
      ).toHaveLength(1);
    }
  });
});

describe("isLateral", () => {
  it("is true between any two different nav destinations", () => {
    const pairs = LANDINGS.flatMap((from) =>
      LANDINGS.filter((to) => to !== from).map((to) => [from, to]),
    );

    for (const [from, to] of pairs) {
      expect(isLateral(from!, to!), `${from} -> ${to}`).toBe(true);
    }
  });

  it("is false landing a level down, even across sections", () => {
    // The deep-link case the predicate's "onto a landing" half exists for.
    expect(isLateral("/budget", "/posts/abc")).toBe(false);
    // A horse tab is below the landing, so it pushes like any other sub-page.
    expect(isLateral("/", "/horse/abc/cheval")).toBe(false);
  });

  it("is false within one section", () => {
    expect(isLateral("/horse/abc", "/horse/abc/cures")).toBe(false);
    expect(isLateral("/posts/abc", "/posts")).toBe(false);
  });

  it("is false leaving a path that belongs to no section", () => {
    expect(isLateral("/nope", "/posts")).toBe(false);
  });
});

describe("customizeRouteOf", () => {
  it("defaults to the Profil tab", () => {
    expect(customizeRouteOf("/profile/interface")).toEqual({ tab: "profil" });
  });

  it("reads a known tab", () => {
    expect(customizeRouteOf("/profile/interface/categories")).toEqual({
      tab: "categories",
    });
  });

  it("rejects an unknown tab, a deeper path and an unrelated one", () => {
    expect(customizeRouteOf("/profile/interface/nope")).toBeNull();
    expect(customizeRouteOf("/profile/interface/ration/x")).toBeNull();
    expect(customizeRouteOf("/profile/interfaces")).toBeNull();
    expect(customizeRouteOf("/profile")).toBeNull();
  });

  it("tags only moves between two of its tabs", () => {
    expect(
      customizeTransitionType(
        "/profile/interface",
        "/profile/interface/ration",
      ),
    ).toBe("customize-subpage");
    expect(
      customizeTransitionType("/profile", "/profile/interface"),
    ).toBeNull();
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
  it("morphs the card on the way in or out of the horse page", () => {
    expect(horseTransitionType("/", "/horse/abc")).toBe("horse");
    expect(horseTransitionType("/horse/abc/cures", "/")).toBe("horse");
  });

  it("keeps the page still between two of its sub-pages", () => {
    expect(horseTransitionType("/horse/abc", "/horse/abc/cheval")).toBe(
      "horse-subpage",
    );
  });

  it("is nothing for a navigation that never touches the horse", () => {
    expect(horseTransitionType("/", "/posts")).toBeNull();
  });
});
