import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db.ts";
import { addDays, startOfWeek, todayISO } from "../../data/index.ts";
import {
  makeEvent,
  makeHorse,
  resetDb,
} from "../../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../__tests__/fixture.ts";
import "./week-strip.ts";
import type { WeekStrip } from "./week-strip.ts";

/**
 * The dashboard's week, and the sheet behind it.
 *
 * These first two cases came from `HomeView.test.ts`, where the strip used to
 * live. They moved rather than being rewritten: the strip is a shadow-DOM
 * component now, so a `querySelectorAll` from the light-DOM view no longer
 * reaches the cards — which is the only thing about them that changed.
 */

const mount = () => fixture<WeekStrip>(html`<week-strip></week-strip>`);

const cardsOf = (el: WeekStrip) => [
  ...el.renderRoot.querySelectorAll("day-card"),
];
const buttonsOf = (el: WeekStrip) => [
  ...el.renderRoot.querySelectorAll<HTMLButtonElement>(".week__day"),
];
const sheetOf = (el: WeekStrip) =>
  el.renderRoot.querySelector("activity-sheet");

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("week-strip", () => {
  it("lays the week out Monday to Sunday and marks today, once", async () => {
    const el = await mount();
    await waitFor(el, () => cardsOf(el).length > 0);

    // 1 is `Date#getDay()` for Monday — the week start `weekGrid` uses.
    const monday = startOfWeek(todayISO(), 1);
    const cards = cardsOf(el);

    expect(cards).toHaveLength(7);
    expect(cards.map((card) => card.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addDays(monday, index)),
    );
    expect(cards.filter((card) => card.today).map((card) => card.date)).toEqual(
      [todayISO()],
    );
  });

  it("shows this week’s work session on its own day, and nothing else’s", async () => {
    const monday = startOfWeek(todayISO(), 1);
    const wednesday = addDays(monday, 2);

    await db.events.bulkAdd([
      makeEvent({
        id: "work",
        type: "travail",
        date: wednesday,
        activity: "trotting",
      }),
      // Same day, not a session: the strip is about work, not the whole agenda.
      makeEvent({ id: "care", type: "veto", date: wednesday }),
      // Next week — outside the range the query asks for.
      makeEvent({
        id: "next-week",
        type: "travail",
        date: addDays(monday, 7),
        activity: "liberte",
      }),
    ]);

    const el = await mount();
    await waitFor(el, () => cardsOf(el).some((card) => card.activity));

    const byDate = new Map(cardsOf(el).map((card) => [card.date, card]));
    expect(byDate.get(wednesday)?.activity).toBe("trotting");
    expect([...byDate.values()].filter((card) => card.activity)).toHaveLength(
      1,
    );
  });

  it("shows a user’s own activity by the label it stores", async () => {
    const wednesday = addDays(startOfWeek(todayISO(), 1), 2);
    await db.events.add(
      makeEvent({
        id: "work",
        type: "travail",
        date: wednesday,
        activity: "Carrière",
      }),
    );

    const el = await mount();
    await waitFor(el, () => cardsOf(el).some((card) => card.activity));

    expect(cardsOf(el).find((card) => card.date === wednesday)?.activity).toBe(
      "Carrière",
    );
  });

  it("does not mount the sheet before a day is tapped", async () => {
    const el = await mount();
    await waitFor(el, () => cardsOf(el).length > 0);

    expect(sheetOf(el)).toBeNull();
  });

  it("opens the sheet on the day that was tapped", async () => {
    const el = await mount();
    await waitFor(el, () => buttonsOf(el).length > 0);

    const thursday = addDays(startOfWeek(todayISO(), 1), 3);
    buttonsOf(el)[3]!.click();
    await settled(el);

    expect(sheetOf(el)?.open).toBe(true);
    expect(sheetOf(el)?.date).toBe(thursday);
  });

  it("hands the sheet the session the tapped day is showing", async () => {
    const wednesday = addDays(startOfWeek(todayISO(), 1), 2);
    await db.events.add(
      makeEvent({
        id: "work",
        type: "travail",
        date: wednesday,
        activity: "trotting",
      }),
    );

    const el = await mount();
    await waitFor(el, () => cardsOf(el).some((card) => card.activity));

    buttonsOf(el)[2]!.click();
    await settled(el);

    // The row itself, not a second lookup — the sheet edits what the strip drew.
    expect(sheetOf(el)?.existing?.id).toBe("work");
  });

  it("hands over no session for a day with none", async () => {
    const el = await mount();
    await waitFor(el, () => buttonsOf(el).length > 0);

    buttonsOf(el)[0]!.click();
    await settled(el);

    expect(sheetOf(el)?.existing).toBeNull();
  });

  it("announces which day is expanded, and only that one", async () => {
    const el = await mount();
    await waitFor(el, () => buttonsOf(el).length > 0);

    expect(
      buttonsOf(el).every(
        (button) => button.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);

    buttonsOf(el)[3]!.click();
    await settled(el);

    expect(
      buttonsOf(el).map(
        (button) => button.getAttribute("aria-expanded") === "true",
      ),
    ).toEqual([false, false, false, true, false, false, false]);
  });

  it("keeps the sheet mounted after it closes, so it can animate out", async () => {
    const el = await mount();
    await waitFor(el, () => buttonsOf(el).length > 0);

    buttonsOf(el)[3]!.click();
    await settled(el);

    sheetOf(el)!.dispatchEvent(
      new CustomEvent("sheet-close", { bubbles: true, composed: true }),
    );
    await settled(el);

    // Still there, and no longer open — removing it on close would cut the exit
    // animation off at the first frame.
    expect(sheetOf(el)).not.toBeNull();
    expect(sheetOf(el)?.open).toBe(false);
  });
});
