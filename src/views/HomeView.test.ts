import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { addDays, addMonths, todayISO } from "../data/index.ts";
import { makeEvent, makeHorse, resetDb } from "../data/__tests__/factories.ts";
import { fixture, waitFor } from "../components/__tests__/fixture.ts";
import "./HomeView.ts";
import type { HomeView } from "./HomeView.ts";

const mount = () => fixture<HomeView>(html`<home-view></home-view>`);

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

// The week strip has its own suite: it is a shadow-DOM component now, so the
// `querySelectorAll('day-card')` these tests used to do from the light-DOM view
// no longer reaches it. See `components/week-strip/week-strip.test.ts`.
describe("home-view", () => {
  it("shows the active horse and an empty state with no upcoming events", async () => {
    const el = await mount();
    // horse-card is always in the DOM — only its `.horse` property is unset
    // until the query resolves — so that property is what to wait on.
    await waitFor(el, () => el.querySelector("horse-card")?.horse != null);

    expect(el.querySelector("horse-card")?.horse?.id).toBe("horse-1");
    expect(el.textContent).toContain("Aucun rendez-vous à venir");
    expect(el.querySelectorAll("event-card")).toHaveLength(0);
  });

  it("lists at most 3 upcoming appointments, soonest first", async () => {
    // Four candidates so the limit and the ordering are both exercised: a
    // window that just happened to contain 3 wouldn't prove either.
    const dates = [1, 2, 3, 4].map((n) => addDays(todayISO(), n));
    await db.events.bulkAdd(
      dates.map((date, index) => makeEvent({ id: `event-${index}`, date })),
    );

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll("event-card").length > 0);

    const cards = [...el.querySelectorAll("event-card")];
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.event?.date)).toEqual(dates.slice(0, 3));
  });

  it("does not count next month into this month card, or a cancelled visit into either", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "in-month-1",
        date: todayISO(),
        customFields: { amountCents: 1000 },
      }),
      makeEvent({
        id: "in-month-2",
        date: todayISO(),
        customFields: { amountCents: 500 },
      }),
      makeEvent({
        id: "last-month",
        date: addMonths(todayISO(), -1),
        customFields: { amountCents: 20_000 },
      }),
      makeEvent({
        id: "cancelled",
        date: todayISO(),
        customFields: { amountCents: 999 },
        status: "cancelled",
      }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelector("budget-card")?.totalCents !== 0);

    expect(el.querySelector("budget-card")?.totalCents).toBe(1500);
  });

  it("hands the week off to its own component", async () => {
    const el = await mount();

    // The strip owns the query, the grid and the day cards; the view only
    // places it. Its behaviour is covered in its own suite.
    expect(el.querySelector("week-strip")).not.toBeNull();
  });
});
