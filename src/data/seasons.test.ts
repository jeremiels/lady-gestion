import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEASON,
  formatMonthLong,
  formatMonthShort,
  formatSeasonRange,
  formatSuspensionRange,
  isInSeason,
  isMonthNumber,
  isRationSeason,
  monthOf,
  seasonFromLegacyFlag,
  summariseSuspension,
  type RationSeason,
} from "./seasons.ts";

/** October → April, the winter supplement window the feed plan actually uses. */
const WINTER: RationSeason = { from: 10, to: 4 };
/** April → October, the same window inverted — does not wrap the year. */
const SUMMER: RationSeason = { from: 4, to: 10 };

describe("isMonthNumber", () => {
  it("accepts 1 through 12", () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(isMonthNumber(month)).toBe(true);
    }
  });

  it("rejects the 0-based months Date#getMonth() hands out", () => {
    expect(isMonthNumber(0)).toBe(false);
  });

  it("rejects out-of-range, fractional and non-numeric values", () => {
    expect(isMonthNumber(13)).toBe(false);
    expect(isMonthNumber(-1)).toBe(false);
    expect(isMonthNumber(4.5)).toBe(false);
    expect(isMonthNumber("4")).toBe(false);
    expect(isMonthNumber(null)).toBe(false);
    expect(isMonthNumber(NaN)).toBe(false);
  });
});

describe("isRationSeason", () => {
  it("accepts a well-formed window, wrapping or not", () => {
    expect(isRationSeason(WINTER)).toBe(true);
    expect(isRationSeason(SUMMER)).toBe(true);
  });

  it("rejects half-built and malformed values", () => {
    expect(isRationSeason(null)).toBe(false);
    expect(isRationSeason({ from: 10 })).toBe(false);
    expect(isRationSeason({ from: 10, to: 0 })).toBe(false);
    expect(isRationSeason({ from: "10", to: "4" })).toBe(false);
  });
});

describe("monthOf", () => {
  it("reads the month component as a 1-based number", () => {
    expect(monthOf("2026-01-15")).toBe(1);
    expect(monthOf("2026-08-12")).toBe(8);
    expect(monthOf("2026-12-31")).toBe(12);
  });

  it("returns null rather than a bogus month for a malformed date", () => {
    expect(monthOf("")).toBe(null);
    expect(monthOf("2026-13-01")).toBe(null);
    expect(monthOf("pas-une-date")).toBe(null);
  });
});

describe("isInSeason", () => {
  it("treats a null season as fed all year", () => {
    expect(isInSeason(null, "2026-01-15")).toBe(true);
    expect(isInSeason(null, "2026-07-15")).toBe(true);
  });

  it("covers both ends of a wrapping window inclusively", () => {
    expect(isInSeason(WINTER, "2026-10-01")).toBe(true);
    expect(isInSeason(WINTER, "2026-12-31")).toBe(true);
    expect(isInSeason(WINTER, "2026-01-01")).toBe(true);
    expect(isInSeason(WINTER, "2026-04-30")).toBe(true);
  });

  it("excludes the gap of a wrapping window", () => {
    expect(isInSeason(WINTER, "2026-05-01")).toBe(false);
    expect(isInSeason(WINTER, "2026-08-12")).toBe(false);
    expect(isInSeason(WINTER, "2026-09-30")).toBe(false);
  });

  it("covers both ends of a non-wrapping window inclusively", () => {
    expect(isInSeason(SUMMER, "2026-04-01")).toBe(true);
    expect(isInSeason(SUMMER, "2026-07-15")).toBe(true);
    expect(isInSeason(SUMMER, "2026-10-31")).toBe(true);
  });

  it("excludes the gap of a non-wrapping window", () => {
    expect(isInSeason(SUMMER, "2026-03-31")).toBe(false);
    expect(isInSeason(SUMMER, "2026-11-01")).toBe(false);
  });

  it("handles a single-month window", () => {
    expect(isInSeason({ from: 6, to: 6 }, "2026-06-15")).toBe(true);
    expect(isInSeason({ from: 6, to: 6 }, "2026-07-01")).toBe(false);
  });

  it("fails open on a malformed date rather than hiding a line", () => {
    expect(isInSeason(WINTER, "pas-une-date")).toBe(true);
  });
});

describe("month formatting", () => {
  it("capitalises the abbreviated form for a row subtitle", () => {
    expect(formatMonthShort(10)).toBe("Oct.");
    expect(formatMonthShort(4)).toBe("Avr.");
  });

  it("leaves short French month names unabbreviated", () => {
    expect(formatMonthShort(3)).toBe("Mars");
    expect(formatMonthShort(5)).toBe("Mai");
  });

  it("keeps the long form lowercase for use mid-sentence", () => {
    expect(formatMonthLong(10)).toBe("octobre");
    expect(formatMonthLong(4)).toBe("avril");
  });
});

describe("formatSeasonRange", () => {
  it("renders the window the design shows under a seasonal line", () => {
    expect(formatSeasonRange(WINTER)).toBe("Oct. → Avr.");
  });

  it("renders a non-wrapping window the same way", () => {
    expect(formatSeasonRange(SUMMER)).toBe("Avr. → Oct.");
  });
});

describe("formatSuspensionRange", () => {
  it("describes the gap, running from the season end to its start", () => {
    expect(formatSuspensionRange(WINTER)).toBe("d’avril à octobre");
  });

  it("elides `de` before a vowel and keeps it otherwise", () => {
    expect(formatSuspensionRange({ from: 1, to: 8 })).toBe("d’août à janvier");
    expect(formatSuspensionRange({ from: 1, to: 5 })).toBe("de mai à janvier");
  });
});

describe("summariseSuspension", () => {
  it("returns null when nothing is suspended", () => {
    expect(summariseSuspension([null, null], "2026-08-12")).toBe(null);
    expect(summariseSuspension([WINTER], "2026-01-15")).toBe(null);
  });

  it("names the shared window when every suspended line agrees", () => {
    expect(
      summariseSuspension([null, null, null, WINTER, WINTER], "2026-08-12"),
    ).toBe("2 produits saisonniers suspendus d’avril à octobre.");
  });

  it("uses the singular for a single suspended line", () => {
    expect(summariseSuspension([null, WINTER], "2026-08-12")).toBe(
      "1 produit saisonnier suspendu d’avril à octobre.",
    );
  });

  it("falls back to a bare count when the windows disagree", () => {
    expect(
      summariseSuspension([WINTER, { from: 11, to: 3 }], "2026-08-12"),
    ).toBe("2 produits saisonniers suspendus.");
  });

  it("ignores seasonal lines that are currently in season", () => {
    // April: WINTER is still being fed, SUMMER has not started.
    expect(summariseSuspension([WINTER, SUMMER], "2026-03-15")).toBe(
      "1 produit saisonnier suspendu d’octobre à avril.",
    );
  });
});

describe("seasonFromLegacyFlag", () => {
  it("gives a v1 seasonal row the default window", () => {
    expect(seasonFromLegacyFlag(true)).toEqual(DEFAULT_SEASON);
  });

  it("treats anything else as fed all year", () => {
    expect(seasonFromLegacyFlag(false)).toBe(null);
    expect(seasonFromLegacyFlag(undefined)).toBe(null);
  });

  it("returns a fresh object so callers cannot mutate the shared default", () => {
    const season = seasonFromLegacyFlag(true);
    expect(season).not.toBe(DEFAULT_SEASON);
  });
});
