import { describe, expect, it } from "vitest";
import {
  byDateDescending,
  formatPeriod,
  formatPeriodHeading,
  formatPeriodNote,
  inPeriod,
  periodOf,
  periodOptions,
  sumByType,
  sumSlices,
  type BudgetPeriod,
} from "./budget.ts";
import { BUILT_IN_EVENT_TYPE_ROWS, makeEvent } from "./__tests__/factories.ts";
import type { HorseEvent } from "./types.ts";

/**
 * These are pure functions over records the caller fetched, so the fixtures are
 * built straight from the factory — no database, no `resetDb`. `TYPES` is the
 * real 13 built-ins, in their real `order` — the sequence `sumByType` sorts by.
 */
const TYPES = BUILT_IN_EVENT_TYPE_ROWS;

const budget = (
  date: string,
  type: HorseEvent["type"],
  amountCents: number,
  over: Partial<HorseEvent> = {},
): HorseEvent =>
  makeEvent({
    id: `${date}-${type}`,
    date,
    type,
    customFields: { amountCents },
    ...over,
  });

const MONTH = (key: string): BudgetPeriod => ({ granularity: "month", key });
const YEAR = (key: string): BudgetPeriod => ({ granularity: "year", key });

describe("periodOf", () => {
  it("takes the month prefix for a month and the year prefix for a year", () => {
    expect(periodOf("2026-01-10", "month")).toEqual(MONTH("2026-01"));
    expect(periodOf("2026-01-10", "year")).toEqual(YEAR("2026"));
  });
});

describe("inPeriod", () => {
  const events = [
    budget("2025-12-31", "veto", 1000),
    budget("2026-01-01", "marechal", 2000),
    budget("2026-01-31", "osteo", 3000),
    budget("2026-02-01", "pension", 4000),
  ];

  it("keeps only the events inside a month, both ends included", () => {
    expect(
      inPeriod(events, MONTH("2026-01")).map((event) => event.date),
    ).toEqual(["2026-01-01", "2026-01-31"]);
  });

  it("does not let December leak into the following January", () => {
    expect(
      inPeriod(events, MONTH("2026-01")).some(
        (event) => event.date === "2025-12-31",
      ),
    ).toBe(false);
  });

  it("keeps the whole year for a year period", () => {
    expect(inPeriod(events, YEAR("2026"))).toHaveLength(3);
    expect(inPeriod(events, YEAR("2025"))).toHaveLength(1);
  });

  it("preserves the order it was given", () => {
    const reversed = [...events].reverse();
    expect(inPeriod(reversed, YEAR("2026")).map((event) => event.date)).toEqual(
      ["2026-02-01", "2026-01-31", "2026-01-01"],
    );
  });
});

describe("sumByType", () => {
  it("adds up several events of the same category", () => {
    const slices = sumByType(
      [
        budget("2026-01-05", "veto", 10_000),
        budget("2026-01-20", "veto", 2500),
      ],
      TYPES,
    );
    expect(slices).toEqual([{ type: "veto", cents: 12_500, children: [] }]);
  });

  it("omits categories with nothing spent on them", () => {
    const slices = sumByType([budget("2026-01-05", "veto", 10_000)], TYPES);
    expect(slices).toHaveLength(1);
    expect(slices.map((slice) => slice.type)).not.toContain("pension");
  });

  it("omits a category whose events cancel out to zero", () => {
    const slices = sumByType(
      [
        budget("2026-01-05", "achat", 5000),
        budget("2026-01-06", "achat", -5000, { id: "refund" }),
        budget("2026-01-07", "veto", 1000),
      ],
      TYPES,
    );
    expect(slices).toEqual([{ type: "veto", cents: 1000, children: [] }]);
  });

  it("orders by the type catalogue's order, not by amount, so the ring never reshuffles", () => {
    // `pension` comes after `veto` in the seeded order and is the bigger of the two here.
    const slices = sumByType(
      [
        budget("2026-01-05", "pension", 35_000),
        budget("2026-01-06", "veto", 100),
      ],
      TYPES,
    );
    expect(slices.map((slice) => slice.type)).toEqual(["veto", "pension"]);
  });

  it("treats a missing or non-numeric amount as nothing rather than NaN", () => {
    const slices = sumByType(
      [
        budget("2026-01-05", "veto", 1000),
        makeEvent({
          id: "no-amount",
          date: "2026-01-06",
          type: "veto",
          customFields: {},
        }),
      ],
      TYPES,
    );
    expect(slices).toEqual([{ type: "veto", cents: 1000, children: [] }]);
  });

  it("returns nothing for no events", () => {
    expect(sumByType([], TYPES)).toEqual([]);
  });

  /**
   * The hierarchy cases, on a re-parented copy: `marechal` and `dentiste`
   * become children of `soins`, which is what an event-type editor would write
   * through `setParent`.
   *
   * `TYPES` already nests `cures` and `traitement` since schema v9, but both
   * spend nothing here, so a group of leaves the shipped catalogue leaves
   * alone is what isolates these assertions. It also keeps them legal: nesting
   * `veto`, which now has a child of its own, would build the three-deep chain
   * `canBeParentOf` refuses and `resolveCatalogue`, a single hop, cannot read.
   */
  describe("with a nested catalogue", () => {
    const soins = TYPES.find((type) => type.key === "soins")!;
    const nest = (key: string) => (type: (typeof TYPES)[number]) =>
      type.key === key ? { ...type, parentId: soins.id, theme: null } : type;
    const NESTED = TYPES.map(nest("marechal")).map(nest("dentiste"));

    it("rolls a child's spend into its root's wedge", () => {
      const slices = sumByType(
        [
          budget("2026-01-05", "soins", 1000),
          budget("2026-01-06", "marechal", 2000, { id: "v" }),
          budget("2026-01-07", "dentiste", 500, { id: "d" }),
        ],
        NESTED,
      );

      expect(slices).toEqual([
        {
          type: "soins",
          cents: 3500,
          children: [
            { type: "dentiste", cents: 500 },
            { type: "marechal", cents: 2000 },
          ],
        },
      ]);
    });

    it("gives a root a wedge for its children alone, even spending nothing itself", () => {
      const slices = sumByType(
        [budget("2026-01-06", "marechal", 2000)],
        NESTED,
      );

      expect(slices).toEqual([
        {
          type: "soins",
          cents: 2000,
          children: [{ type: "marechal", cents: 2000 }],
        },
      ]);
    });

    it("never gives a child a wedge of its own — it would repeat its parent's colour", () => {
      const slices = sumByType(
        [budget("2026-01-06", "marechal", 2000)],
        NESTED,
      );
      expect(slices.map((slice) => slice.type)).not.toContain("marechal");
    });

    it("drops a child that spent nothing from the breakdown", () => {
      const slices = sumByType(
        [budget("2026-01-06", "marechal", 2000)],
        NESTED,
      );
      expect(slices[0]?.children).toEqual([{ type: "marechal", cents: 2000 }]);
    });

    it("orders children by their own order within the group", () => {
      // `dentiste` is order 4 and `marechal` order 5 in the seeded catalogue.
      const slices = sumByType(
        [
          budget("2026-01-06", "marechal", 1, { id: "v" }),
          budget("2026-01-07", "dentiste", 1, { id: "d" }),
        ],
        NESTED,
      );
      expect(slices[0]?.children.map((child) => child.type)).toEqual([
        "dentiste",
        "marechal",
      ]);
    });

    it("keeps sumSlices counting each event exactly once", () => {
      const slices = sumByType(
        [
          budget("2026-01-05", "soins", 1000),
          budget("2026-01-06", "marechal", 2000, { id: "v" }),
        ],
        NESTED,
      );
      expect(sumSlices(slices)).toBe(3000);
    });
  });
});

describe("sumSlices", () => {
  it("totals the slices, and reads 0 for none", () => {
    expect(
      sumSlices(sumByType([budget("2026-01-05", "veto", 10_000)], TYPES)),
    ).toBe(10_000);
    expect(sumSlices([])).toBe(0);
  });
});

describe("periodOptions", () => {
  const events = [
    budget("2025-03-04", "veto", 1000),
    budget("2026-01-10", "osteo", 2000),
    budget("2026-01-20", "veto", 3000),
  ];

  it("offers today even when nothing was spent in it", () => {
    expect(periodOptions([], "month", "2026-08-12")).toEqual([
      MONTH("2026-08"),
    ]);
  });

  it("lists every month present, newest first, without duplicating one", () => {
    expect(periodOptions(events, "month", "2026-08-12")).toEqual([
      MONTH("2026-08"),
      MONTH("2026-01"),
      MONTH("2025-03"),
    ]);
  });

  it("does not add today twice when it already has budget", () => {
    const withToday = [...events, budget("2026-08-01", "pension", 500)];
    expect(periodOptions(withToday, "month", "2026-08-12")).toEqual([
      MONTH("2026-08"),
      MONTH("2026-01"),
      MONTH("2025-03"),
    ]);
  });

  it("collapses to years for the year granularity", () => {
    expect(periodOptions(events, "year", "2026-08-12")).toEqual([
      YEAR("2026"),
      YEAR("2025"),
    ]);
  });
});

describe("formatPeriod", () => {
  it("leaves the year off a month in the current year", () => {
    expect(formatPeriod(MONTH("2026-01"), "2026-08-12")).toBe("Janv.");
  });

  it("spells the year out for a month outside it", () => {
    expect(formatPeriod(MONTH("2025-03"), "2026-08-12")).toBe("Mars 2025");
  });

  it("renders a year as itself", () => {
    expect(formatPeriod(YEAR("2026"), "2026-08-12")).toBe("2026");
  });

  it("falls back to the raw key rather than throwing on a malformed month", () => {
    expect(formatPeriod(MONTH("2026-99"), "2026-08-12")).toBe("2026-99");
  });
});

describe("formatPeriodNote", () => {
  it("reads as a sentence fragment under the total", () => {
    expect(formatPeriodNote(MONTH("2026-01"))).toBe("en janvier");
    expect(formatPeriodNote(YEAR("2026"))).toBe("en 2026");
  });

  it("is empty rather than wrong for a malformed month", () => {
    expect(formatPeriodNote(MONTH("2026-99"))).toBe("");
  });
});

describe("formatPeriodHeading", () => {
  it("agrees with the granularity", () => {
    expect(formatPeriodHeading("month")).toBe("Dépenses mensuelles");
    expect(formatPeriodHeading("year")).toBe("Dépenses annuelles");
  });
});

describe("byDateDescending", () => {
  it("puts the newest first", () => {
    const events = [
      budget("2026-01-01", "veto", 100),
      budget("2026-03-01", "osteo", 100),
      budget("2026-02-01", "pension", 100),
    ];
    expect(
      [...events].sort(byDateDescending).map((event) => event.date),
    ).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("breaks a same-day tie on createdAt, newest first", () => {
    const older = budget("2026-01-01", "veto", 100, {
      id: "older",
      createdAt: "2026-01-01T08:00:00.000Z",
    });
    const newer = budget("2026-01-01", "osteo", 100, {
      id: "newer",
      createdAt: "2026-01-01T09:00:00.000Z",
    });
    expect(
      [older, newer].sort(byDateDescending).map((event) => event.id),
    ).toEqual(["newer", "older"]);
  });
});
