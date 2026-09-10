import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db.ts";
import { workSessionByDate } from "../../data/events.ts";
import * as activitiesRepo from "../../data/repositories/activities.repo.ts";
import * as eventsRepo from "../../data/repositories/events.repo.ts";
import {
  BUILT_IN_EVENT_TYPE_ROWS,
  HORSE_ID,
  makeEvent,
  makeHorse,
  resetDb,
} from "../../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../__tests__/fixture.ts";
import "./activity-sheet.ts";
import type { ActivitySheet } from "./activity-sheet.ts";
import type { AppChip } from "../app-chip/app-chip.ts";
import type { AppInput } from "../app-input/app-input.ts";

/** A day with no session on it unless a test puts one there. */
const DATE = "2026-06-15";

const TYPES = BUILT_IN_EVENT_TYPE_ROWS;
const TRAVAIL = TYPES.find((type) => type.key === "travail")!;

const mount = (over: { existing?: ReturnType<typeof makeEvent> } = {}) =>
  fixture<ActivitySheet>(
    html`<activity-sheet
      open
      .date=${DATE}
      .type=${TRAVAIL}
      .existing=${(over.existing as never) ?? null}
    ></activity-sheet>`,
  );

const chipsOf = (el: ActivitySheet) => [
  ...el.renderRoot.querySelectorAll<AppChip>("app-chip"),
];
const labelsOf = (el: ActivitySheet) => chipsOf(el).map((chip) => chip.label);
const chipNamed = (el: ActivitySheet, label: string) =>
  chipsOf(el).find((chip) => chip.label === label)!;

/** Waits for the sheet's first render, where its (static) chips appear. */
const ready = async (el: ActivitySheet) => {
  await waitFor(el, () => chipsOf(el).length > 0);
  return el;
};

/**
 * Advances real async ticks so the horse's custom-activity `LiveQuery` —
 * which the dedup check reads but nothing on screen reflects any more, now
 * that the chip list is built-ins only — has a chance to report. Mirrors the
 * tick `waitFor` spends per attempt, since there is no predicate to poll.
 */
const flushCustomActivities = async (el: ActivitySheet) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled(el);
  }
};

/** Types into the sheet's input and submits, the way the user does. */
const submitLabel = async (el: ActivitySheet, value: string) => {
  const input = el.renderRoot.querySelector<AppInput>("app-input")!;
  input.value = value;
  await settled(input);

  el.renderRoot.querySelector("form")!.requestSubmit();
  // The submit handler writes to two tables before it closes.
  await waitFor(
    el,
    () =>
      el.open === false ||
      el.renderRoot.querySelector(".activity-sheet__error") !== null,
  );
};

const sessionOn = async (date: string) =>
  workSessionByDate(await eventsRepo.listByHorse(HORSE_ID), TYPES).get(date) ??
  null;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("activity-sheet", () => {
  it("titles itself with the day it is about", async () => {
    const el = await ready(await mount());

    expect(el.renderRoot.querySelector("app-bottom-sheet")?.heading).toBe(
      "Lundi 15 juin",
    );
    expect(el.renderRoot.querySelector("app-bottom-sheet")?.description).toBe(
      "Activité du jour",
    );
  });

  it("offers the built-in activities, alphabetically by their French labels", async () => {
    const el = await ready(await mount());

    expect(labelsOf(el)).toEqual([
      "Balade",
      "Balade à pied",
      "Carrière",
      "Liberté",
      "Longe",
      "Plat",
      "Repos",
      "TAP",
      "Trotting",
    ]);
  });

  it("does not offer the horse’s other custom activities as chips", async () => {
    await activitiesRepo.add({ horseId: HORSE_ID, label: "Voltige" });

    const el = await ready(await mount());
    // The chip list itself never depends on the custom-activity query, so
    // give it a few ticks to have reported before asserting on its absence —
    // otherwise this would pass even if the filtering below regressed.
    await flushCustomActivities(el);

    expect(labelsOf(el)).toEqual([
      "Balade",
      "Balade à pied",
      "Carrière",
      "Liberté",
      "Longe",
      "Plat",
      "Repos",
      "TAP",
      "Trotting",
    ]);
  });

  it("marks the chip the day already carries", async () => {
    // `.existing` is a `WorkSession` — `activity` is a real top-level
    // property there (`workSessionByDate` populates it), not read out of
    // `customFields` the way the underlying record stores it.
    const el = await ready(
      await mount({
        existing: {
          ...makeEvent({
            type: "travail",
            date: DATE,
            customFields: { activity: "longe" },
          }),
          activity: "longe",
        } as ReturnType<typeof makeEvent>,
      }),
    );

    expect(
      chipsOf(el)
        .filter((chip) => chip.selected)
        .map((chip) => chip.label),
    ).toEqual(["Longe"]);
  });

  it("writes the session and closes on a single tap", async () => {
    const el = await ready(await mount());

    chipNamed(el, "Trotting").click();
    await waitFor(el, () => el.open === false);

    expect(await sessionOn(DATE)).toMatchObject({
      activity: "trotting",
      title: "Trotting",
    });
  });

  it("replaces the day’s session rather than adding a second", async () => {
    await db.events.add(
      makeEvent({
        id: "work",
        type: "travail",
        date: DATE,
        customFields: { activity: "longe" },
      }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "TAP").click();
    await waitFor(el, () => el.open === false);

    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(1);
    expect(await sessionOn(DATE)).toMatchObject({
      customFields: { activity: "tap" },
    });
  });

  it("retracts the day’s activity on a second tap of the same chip", async () => {
    await db.events.add(
      makeEvent({
        id: "work",
        type: "travail",
        date: DATE,
        customFields: { activity: "longe" },
      }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "Longe").click();
    await waitFor(el, () => el.open === false);

    expect(await sessionOn(DATE)).toBeNull();
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
  });

  it("applies rather than retracts when a different chip is tapped", async () => {
    await db.events.add(
      makeEvent({
        id: "work",
        type: "travail",
        date: DATE,
        customFields: { activity: "longe" },
      }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "TAP").click();
    await waitFor(el, () => el.open === false);

    expect(await sessionOn(DATE)).toMatchObject({
      customFields: { activity: "tap" },
    });
  });

  it("adds a typed activity to the catalogue and applies it at once", async () => {
    const el = await ready(await mount());

    await submitLabel(el, "Voltige");

    expect(
      (await activitiesRepo.listByHorse(HORSE_ID)).map((item) => item.label),
    ).toEqual(["Voltige"]);
    expect(await sessionOn(DATE)).toMatchObject({
      activity: "Voltige",
      title: "Voltige",
    });
    expect(el.open).toBe(false);
  });

  it("keeps a freshly typed activity off the general chip list, but shows it as the day’s own chip", async () => {
    await submitLabel(await ready(await mount()), "Voltige");

    const blank = await ready(await mount());
    await flushCustomActivities(blank);
    expect(labelsOf(blank)).not.toContain("Voltige");

    const withVoltige = await ready(
      await mount({ existing: (await sessionOn(DATE))! }),
    );
    expect(
      chipsOf(withVoltige)
        .filter((chip) => chip.selected)
        .map((chip) => chip.label),
    ).toEqual(["Voltige"]);
  });

  it("reuses a built-in instead of writing a chip that reads the same", async () => {
    const el = await ready(await mount());

    await submitLabel(el, "trotting");

    // The built-in key, not the typed word, and no catalogue row for it.
    expect(await activitiesRepo.listByHorse(HORSE_ID)).toHaveLength(0);
    expect(await sessionOn(DATE)).toMatchObject({
      customFields: { activity: "trotting" },
    });
  });

  it("reuses an activity already added rather than duplicating it", async () => {
    await activitiesRepo.add({ horseId: HORSE_ID, label: "Écurie" });
    const el = await ready(await mount());
    // "Écurie" is not a built-in, so it never renders as a chip here — give
    // the custom-activity query behind the dedup check a chance to have
    // reported before submitting.
    await flushCustomActivities(el);

    await submitLabel(el, "ecurie");

    expect(await activitiesRepo.listByHorse(HORSE_ID)).toHaveLength(1);
    expect(await sessionOn(DATE)).toMatchObject({
      customFields: { activity: "Écurie" },
    });
  });

  it("refuses a blank label instead of writing an unnamed activity", async () => {
    const el = await ready(await mount());

    await submitLabel(el, "   ");

    expect(
      el.renderRoot.querySelector(".activity-sheet__error")?.textContent,
    ).toContain("requis");
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
    expect(el.open).toBe(true);
  });

  it("fires sheet-close so its owner can clear the day", async () => {
    const el = await ready(await mount());
    let fired = 0;
    el.addEventListener("sheet-close", () => {
      fired += 1;
    });

    chipNamed(el, "Plat").click();
    await waitFor(el, () => el.open === false);

    expect(fired).toBe(1);
  });
});
