import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db.ts";
import { workSessionByDate } from "../../data/events.ts";
import * as activitiesRepo from "../../data/repositories/activities.repo.ts";
import * as eventsRepo from "../../data/repositories/events.repo.ts";
import {
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

const mount = (over: { existing?: ReturnType<typeof makeEvent> } = {}) =>
  fixture<ActivitySheet>(
    html`<activity-sheet
      open
      .date=${DATE}
      .existing=${(over.existing as never) ?? null}
    ></activity-sheet>`,
  );

const chipsOf = (el: ActivitySheet) => [
  ...el.renderRoot.querySelectorAll<AppChip>("app-chip"),
];
const labelsOf = (el: ActivitySheet) => chipsOf(el).map((chip) => chip.label);
const chipNamed = (el: ActivitySheet, label: string) =>
  chipsOf(el).find((chip) => chip.label === label)!;

/** Waits for the two live queries behind the chips to have reported. */
const ready = async (el: ActivitySheet) => {
  await waitFor(el, () => chipsOf(el).length > 0);
  return el;
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
  workSessionByDate(await eventsRepo.listByHorse(HORSE_ID)).get(date) ?? null;

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

  it("offers the six built-in activities, alphabetically by their French labels", async () => {
    const el = await ready(await mount());

    expect(labelsOf(el)).toEqual([
      "Balade à pied",
      "Liberté",
      "Longe",
      "Plat",
      "TAP",
      "Trotting",
    ]);
  });

  it("slots the horse’s own activities in alphabetically among the built-ins", async () => {
    await activitiesRepo.add({ horseId: HORSE_ID, label: "Carrière" });

    const el = await mount();
    await waitFor(el, () => labelsOf(el).includes("Carrière"));

    expect(labelsOf(el)).toEqual([
      "Balade à pied",
      "Carrière",
      "Liberté",
      "Longe",
      "Plat",
      "TAP",
      "Trotting",
    ]);
  });

  it("marks the chip the day already carries", async () => {
    const el = await ready(
      await mount({
        existing: makeEvent({ type: "travail", date: DATE, activity: "longe" }),
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
      makeEvent({ id: "work", type: "travail", date: DATE, activity: "longe" }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "TAP").click();
    await waitFor(el, () => el.open === false);

    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(1);
    expect(await sessionOn(DATE)).toMatchObject({ activity: "tap" });
  });

  it("retracts the day’s activity on a second tap of the same chip", async () => {
    await db.events.add(
      makeEvent({ id: "work", type: "travail", date: DATE, activity: "longe" }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "Longe").click();
    await waitFor(el, () => el.open === false);

    expect(await sessionOn(DATE)).toBeNull();
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
  });

  it("applies rather than retracts when a different chip is tapped", async () => {
    await db.events.add(
      makeEvent({ id: "work", type: "travail", date: DATE, activity: "longe" }),
    );
    const el = await ready(await mount({ existing: (await sessionOn(DATE))! }));

    chipNamed(el, "TAP").click();
    await waitFor(el, () => el.open === false);

    expect(await sessionOn(DATE)).toMatchObject({ activity: "tap" });
  });

  it("adds a typed activity to the catalogue and applies it at once", async () => {
    const el = await ready(await mount());

    await submitLabel(el, "Carrière");

    expect(
      (await activitiesRepo.listByHorse(HORSE_ID)).map((item) => item.label),
    ).toEqual(["Carrière"]);
    expect(await sessionOn(DATE)).toMatchObject({
      activity: "Carrière",
      title: "Carrière",
    });
    expect(el.open).toBe(false);
  });

  it("offers a typed activity as a chip the next time round", async () => {
    await submitLabel(await ready(await mount()), "Repos");

    const second = await mount();
    await waitFor(second, () => labelsOf(second).includes("Repos"));

    expect(labelsOf(second)).toContain("Repos");
  });

  it("reuses a built-in instead of writing a chip that reads the same", async () => {
    const el = await ready(await mount());

    await submitLabel(el, "trotting");

    // The built-in key, not the typed word, and no catalogue row for it.
    expect(await activitiesRepo.listByHorse(HORSE_ID)).toHaveLength(0);
    expect(await sessionOn(DATE)).toMatchObject({ activity: "trotting" });
  });

  it("reuses an activity already added rather than duplicating it", async () => {
    await activitiesRepo.add({ horseId: HORSE_ID, label: "Carrière" });
    const el = await mount();
    await waitFor(el, () => labelsOf(el).includes("Carrière"));

    await submitLabel(el, "carriere");

    expect(await activitiesRepo.listByHorse(HORSE_ID)).toHaveLength(1);
    expect(await sessionOn(DATE)).toMatchObject({ activity: "Carrière" });
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
