import { describe, expect, it } from "vitest";
import {
  activeDays,
  activityChoices,
  followUpValue,
  formatFollowUpInterval,
  formatWorkActivity,
  isFollowUpInterval,
  matchActivity,
  courseDatesThisWeek,
  courseEndDate,
  courseLastDay,
  coursePhase,
  isCourse,
  isCourseOnDay,
  endDateErrors,
  formatDosePerDay,
  isCourseOngoing,
  parseFollowUpValue,
  reminderFireAt,
  reminderTimeErrors,
  statusForDate,
  workSessionByDate,
} from "./posts.ts";
import { FOLLOW_UP_OPTIONS, REMINDER_OPTIONS } from "./categories.ts";
import { BUILT_IN_CATEGORY_ROWS, makePost } from "./__tests__/factories.ts";

/** The real 14 built-ins — `travail` is the one `tracksWork` type. */
const TYPES = BUILT_IN_CATEGORY_ROWS;

describe("statusForDate", () => {
  const TODAY = "2026-08-12";

  it("marks a future date as planned", () => {
    expect(statusForDate("2026-08-13", TODAY)).toBe("planned");
    expect(statusForDate("2027-01-01", TODAY)).toBe("planned");
  });

  it("marks a past date as done", () => {
    expect(statusForDate("2026-08-11", TODAY)).toBe("done");
    expect(statusForDate("2020-01-01", TODAY)).toBe("done");
  });

  it("treats today as done — it has happened", () => {
    // The boundary the whole rule turns on: an appointment entered on the day
    // it happened must not sit in "Rendez-vous à venir".
    expect(statusForDate(TODAY, TODAY)).toBe("done");
  });

  it("compares lexicographically across month and year boundaries", () => {
    expect(statusForDate("2026-09-01", "2026-08-31")).toBe("planned");
    expect(statusForDate("2026-01-01", "2025-12-31")).toBe("planned");
    expect(statusForDate("2025-12-31", "2026-01-01")).toBe("done");
  });
});

describe("isFollowUpInterval", () => {
  it("accepts the shapes the form produces", () => {
    expect(isFollowUpInterval({ amount: 6, unit: "week" })).toBe(true);
    expect(isFollowUpInterval({ amount: 3, unit: "month" })).toBe(true);
  });

  it("rejects half-built and nonsensical values", () => {
    expect(isFollowUpInterval(null)).toBe(false);
    expect(isFollowUpInterval({ amount: 6 })).toBe(false);
    expect(isFollowUpInterval({ unit: "week" })).toBe(false);
    expect(isFollowUpInterval({ amount: 0, unit: "week" })).toBe(false);
    expect(isFollowUpInterval({ amount: -1, unit: "week" })).toBe(false);
    expect(isFollowUpInterval({ amount: 1.5, unit: "week" })).toBe(false);
    expect(isFollowUpInterval({ amount: 6, unit: "day" })).toBe(false);
    expect(isFollowUpInterval({ amount: "6", unit: "week" })).toBe(false);
  });
});

describe("followUpValue / parseFollowUpValue", () => {
  it("round-trips every interval the form offers", () => {
    // FormData only carries strings, so this round trip is load-bearing — and
    // it is checked against `FOLLOW_UP_OPTIONS`, the list the entry form
    // actually draws, rather than against a second copy of it. A code the
    // catalogue offers that this cannot parse would leave the detail page
    // unable to read back what the form just stored.
    for (const option of FOLLOW_UP_OPTIONS) {
      const interval = parseFollowUpValue(option.value);
      expect(interval, `no interval parsed from ${option.value}`).not.toBe(
        null,
      );
      expect(followUpValue(interval!)).toBe(option.value);
    }
  });

  it("serialises to a short readable code", () => {
    expect(followUpValue({ amount: 6, unit: "week" })).toBe("6w");
    expect(followUpValue({ amount: 3, unit: "month" })).toBe("3m");
  });

  it("returns null for anything unrecognised rather than guessing", () => {
    expect(parseFollowUpValue("")).toBe(null);
    expect(parseFollowUpValue("6")).toBe(null);
    expect(parseFollowUpValue("6d")).toBe(null);
    expect(parseFollowUpValue("0w")).toBe(null);
    expect(parseFollowUpValue("-2w")).toBe(null);
    expect(parseFollowUpValue(null)).toBe(null);
    expect(parseFollowUpValue({ amount: 6, unit: "week" })).toBe(null);
  });
});

describe("formatFollowUpInterval", () => {
  it("renders the label the design shows", () => {
    expect(formatFollowUpInterval({ amount: 6, unit: "week" })).toBe(
      "6 semaines",
    );
  });

  it("singularises a lone week", () => {
    expect(formatFollowUpInterval({ amount: 1, unit: "week" })).toBe(
      "1 semaine",
    );
  });

  it("leaves `mois` invariant, because French does", () => {
    expect(formatFollowUpInterval({ amount: 1, unit: "month" })).toBe("1 mois");
    expect(formatFollowUpInterval({ amount: 3, unit: "month" })).toBe("3 mois");
  });

  it("says a year rather than twelve months", () => {
    expect(formatFollowUpInterval({ amount: 12, unit: "month" })).toBe("1 an");
  });
});

describe("workSessionByDate", () => {
  it("answers with the row, not just its activity", () => {
    const session = makePost({
      id: "a",
      categoryKey: "travail",
      date: "2026-08-10",
      customFields: { activity: "longe" },
    });

    expect(workSessionByDate([session], TYPES).get("2026-08-10")?.id).toBe("a");
  });

  it("picks the same session the activity map reports", () => {
    // The two must not be able to disagree: the strip draws one and its sheet
    // writes to the other, so a day would edit a row it never showed.
    const events = [
      makePost({
        id: "timed",
        categoryKey: "travail",
        date: "2026-08-10",
        time: "09:00",
        customFields: { activity: "plat" },
      }),
      makePost({
        id: "all-day",
        categoryKey: "travail",
        date: "2026-08-10",
        customFields: { activity: "longe" },
      }),
    ];

    const session = workSessionByDate(events, TYPES).get("2026-08-10");
    expect(session?.id).toBe("all-day");
    expect(session?.activity).toBe("longe");
  });
});

describe("courseDatesThisWeek", () => {
  it("names the day of a cours event, and no other event’s", () => {
    const dates = courseDatesThisWeek([
      makePost({ id: "lesson", categoryKey: "cours", date: "2026-08-10" }),
      makePost({ id: "care", categoryKey: "veto", date: "2026-08-11" }),
    ]);

    expect(dates).toEqual(new Set(["2026-08-10"]));
  });

  it("skips a cancelled lesson — it did not happen", () => {
    const dates = courseDatesThisWeek([
      makePost({
        id: "lesson",
        categoryKey: "cours",
        date: "2026-08-10",
        status: "cancelled",
      }),
    ]);

    expect(dates.size).toBe(0);
  });
});

describe("formatWorkActivity", () => {
  it("resolves a built-in key to its French label", () => {
    expect(formatWorkActivity("baladeApied")).toBe("Balade à pied");
  });

  it("gives back an activity the user added, which is stored as its own label", () => {
    expect(formatWorkActivity("Voltige")).toBe("Voltige");
  });
});

describe("activityChoices", () => {
  it("offers the built-ins alphabetically by their French labels", () => {
    expect(activityChoices([])).toEqual([
      "balade",
      "baladeApied",
      "carriere",
      "liberte",
      "longe",
      "plat",
      "repos",
      "tap",
      "trotting",
    ]);
  });

  it("slots the user’s own in alphabetically among the built-ins", () => {
    expect(activityChoices(["Voltige", "Pansage"])).toEqual([
      "balade",
      "baladeApied",
      "carriere",
      "liberte",
      "longe",
      "Pansage",
      "plat",
      "repos",
      "tap",
      "trotting",
      "Voltige",
    ]);
  });

  it("drops a label that only repeats a built-in’s wording", () => {
    // The built-in stores `trotting` and reads "Trotting"; a row spelling the
    // label out would render a second chip identical to the first.
    expect(activityChoices(["Trotting"])).not.toContain("Trotting");
    expect(activityChoices(["Trotting"])).toHaveLength(9);
  });

  it("ignores case, surrounding space and accents when comparing", () => {
    expect(
      activityChoices(["  liberte ", "LIBERTÉ", "Voltige", "voltige"]),
    ).toEqual([
      "balade",
      "baladeApied",
      "carriere",
      "liberte",
      "longe",
      "plat",
      "repos",
      "tap",
      "trotting",
      "Voltige",
    ]);
  });

  it("skips a blank label rather than offering an unlabelled chip", () => {
    expect(activityChoices(["   "])).toHaveLength(9);
  });
});

describe("matchActivity", () => {
  const choices = activityChoices(["Voltige"]);

  it("resolves a typed label to the chip already offering it", () => {
    expect(matchActivity("voltige", choices)).toBe("Voltige");
  });

  it("resolves a built-in by its label, not by its storage key", () => {
    expect(matchActivity("Balade à pied", choices)).toBe("baladeApied");
  });

  it("answers null for a label nothing offers yet", () => {
    expect(matchActivity("Dressage", choices)).toBe(null);
  });

  it("answers null for a blank label rather than matching the first chip", () => {
    expect(matchActivity("  ", choices)).toBe(null);
  });
});

describe("courses", () => {
  const TODAY = "2026-01-10";
  const course = (date: string, endDate?: string) =>
    makePost({
      categoryKey: "cures",
      date,
      customFields: endDate === undefined ? {} : { endDate },
    });

  it("reads the end date, ignoring anything that is not a date", () => {
    expect(courseEndDate(course("2026-01-01", "2026-01-12"))).toBe(
      "2026-01-12",
    );
    expect(courseEndDate(course("2026-01-01"))).toBeNull();
    expect(courseEndDate(course("2026-01-01", "bientôt"))).toBeNull();
  });

  it("is ongoing with no end date, or one today or later", () => {
    expect(isCourseOngoing(course("2026-01-01"), TODAY)).toBe(true);
    expect(isCourseOngoing(course("2026-01-01", TODAY), TODAY)).toBe(true);
    expect(isCourseOngoing(course("2026-01-01", "2026-01-09"), TODAY)).toBe(
      false,
    );
  });

  it("is not ongoing before its start day, however far off its end is", () => {
    expect(isCourseOngoing(course("2026-01-11"), TODAY)).toBe(false);
    expect(isCourseOngoing(course("2026-01-11", "2026-02-11"), TODAY)).toBe(
      false,
    );
  });

  it("starts being ongoing on its start day", () => {
    expect(isCourseOngoing(course(TODAY), TODAY)).toBe(true);
  });

  it("reads the three phases off the start and the end", () => {
    expect(coursePhase(course("2026-01-11"), TODAY)).toBe("upcoming");
    expect(coursePhase(course(TODAY), TODAY)).toBe("ongoing");
    expect(coursePhase(course("2026-01-01"), TODAY)).toBe("ongoing");
    expect(coursePhase(course("2026-01-01", TODAY), TODAY)).toBe("ongoing");
    expect(coursePhase(course("2026-01-01", "2026-01-09"), TODAY)).toBe(
      "ended",
    );
  });

  it("counts active days with both ends included, up to today at most", () => {
    expect(activeDays(course("2026-01-01"), TODAY)).toBe(10);
    expect(activeDays(course("2026-01-01", "2026-01-12"), TODAY)).toBe(10);
    expect(activeDays(course("2026-01-01", "2026-01-05"), TODAY)).toBe(5);
    expect(activeDays(course(TODAY), TODAY)).toBe(1);
  });

  it("counts a course that has not started as 0, not negative", () => {
    expect(activeDays(course("2026-02-01"), TODAY)).toBe(0);
  });

  it("reads the stored dose as a daily one", () => {
    expect(formatDosePerDay("40 mL")).toBe("40 mL/j");
    expect(formatDosePerDay(null)).toBeNull();
    expect(formatDosePerDay("")).toBeNull();
  });

  it("tells a course from any other post by its category", () => {
    expect(isCourse(course("2026-01-01"))).toBe(true);
    expect(isCourse(makePost({ categoryKey: "traitement" }))).toBe(true);
    expect(isCourse(makePost({ categoryKey: "veto" }))).toBe(false);
  });

  it("covers the calendar up to its end, or up to today while it has none", () => {
    expect(courseLastDay(course("2026-01-01", "2026-01-12"), TODAY)).toBe(
      "2026-01-12",
    );
    expect(courseLastDay(course("2026-01-01"), TODAY)).toBe(TODAY);
    expect(courseLastDay(course("2026-02-01"), TODAY)).toBe("2026-02-01");
  });

  it("is on a day between its start and last day, both included", () => {
    const post = course("2026-01-05", "2026-01-08");
    expect(isCourseOnDay(post, "2026-01-04", TODAY)).toBe(false);
    expect(isCourseOnDay(post, "2026-01-05", TODAY)).toBe(true);
    expect(isCourseOnDay(post, "2026-01-08", TODAY)).toBe(true);
    expect(isCourseOnDay(post, "2026-01-09", TODAY)).toBe(false);
  });

  it("refuses an end date before the start", () => {
    expect(endDateErrors("2026-01-10", "2026-01-09")).toEqual({
      endDate: "La date de fin précède la date de début.",
    });
    expect(endDateErrors("2026-01-10", "2026-01-10")).toEqual({});
    expect(endDateErrors("2026-01-10", null)).toEqual({});
  });
});

describe("reminders", () => {
  it("counts back from the date and time, on the local clock", () => {
    expect(reminderFireAt("2026-06-15", "08:30", "10min")).toBe(
      new Date(2026, 5, 15, 8, 20).getTime(),
    );
    expect(reminderFireAt("2026-06-15", "08:30", "48h")).toBe(
      new Date(2026, 5, 13, 8, 30).getTime(),
    );
  });

  it("counts real hours across a clock change", () => {
    // Europe/Paris goes to summer time on 29 March 2026: 24 hours before
    // 09:00 on the 30th is 08:00 on the 29th by the wall clock there, and
    // exactly 24 hours of elapsed time wherever this runs.
    const start = new Date(2026, 2, 30, 9, 0).getTime();
    expect(reminderFireAt("2026-03-30", "09:00", "24h")).toBe(
      start - 24 * 60 * 60 * 1000,
    );
  });

  it("has no instant without a time, or with a code it does not know", () => {
    expect(reminderFireAt("2026-06-15", null, "1h")).toBeNull();
    expect(reminderFireAt("2026-06-15", "08:30", "3h")).toBeNull();
    expect(reminderFireAt("2026-06-15", "08:30", null)).toBeNull();
  });

  it("knows every delay the form offers", () => {
    for (const option of REMINDER_OPTIONS) {
      expect(
        reminderFireAt("2026-06-15", "08:30", option.value),
      ).not.toBeNull();
    }
  });

  it("asks for a time only when the box is ticked", () => {
    expect(reminderTimeErrors(true, null)).toEqual({
      time: "Indiquez une heure pour la notification.",
    });
    expect(reminderTimeErrors(true, "08:30")).toEqual({});
    expect(reminderTimeErrors(false, null)).toEqual({});
  });
});
