import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { addMonths, todayISO } from "../data/index.ts";
import {
  BUILT_IN_EVENT_TYPE_ROWS,
  makeEvent,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./EventsView.ts";
import type { EventsView } from "./EventsView.ts";

/** Label lookup for the real 13 built-ins, standing in for `eventType.label`
 * now that a type's label is data rather than a compile-time table. */
const LABEL_OF = new Map(
  BUILT_IN_EVENT_TYPE_ROWS.map((type) => [type.key, type.label]),
);
const labelOf = (key: string): string => LABEL_OF.get(key) ?? "";

const mount = () => fixture<EventsView>(html`<events-view></events-view>`);

const switchToList = async (el: EventsView) => {
  el.querySelector("app-segmented")!.dispatchEvent(
    new CustomEvent("segment-change", {
      detail: { value: "list" },
      bubbles: true,
      composed: true,
    }),
  );
  await settled(el);
};

const search = async (el: EventsView, text: string) => {
  const input = el
    .querySelector("app-input")!
    .renderRoot.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(el);
};

const chipLabeled = (el: EventsView, label: string) =>
  [...el.querySelectorAll("app-chip")].find((chip) => chip.label === label)!;

const cardIds = (el: EventsView) =>
  [...el.querySelectorAll("event-card")].map((card) => card.event?.id).sort();

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("events-view", () => {
  it("calendar mode shows an empty day, then that day’s appointments once one is added", async () => {
    const el = await mount();
    await waitFor(el, () => el.querySelector(".events-view__day") !== null);
    expect(el.textContent).toContain("Aucun évènement ce jour-là.");

    await db.events.add(makeEvent({ id: "today-visit", date: todayISO() }));
    await waitFor(el, () => el.querySelector("event-card") !== null);

    expect(cardIds(el)).toEqual(["today-visit"]);
  });

  it("list mode hides cancelled events and finds the rest through search, folding accents and case", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "checkup",
        type: "veto",
        title: "Contrôle œil",
        date: todayISO(),
      }),
      makeEvent({
        id: "shoeing",
        type: "marechal",
        title: "Ferrure",
        date: addMonths(todayISO(), -1),
      }),
      makeEvent({
        id: "called-off",
        title: "Annulé",
        date: todayISO(),
        status: "cancelled",
      }),
    ]);

    const el = await mount();
    await switchToList(el);
    await waitFor(el, () => el.querySelectorAll("event-card").length > 0);

    expect(cardIds(el)).toEqual(["checkup", "shoeing"]);

    await search(el, "controle");
    expect(cardIds(el)).toEqual(["checkup"]);
  });

  it("a type chip narrows the list, and Tous clears it again", async () => {
    await db.events.bulkAdd([
      makeEvent({ id: "checkup", type: "veto", date: todayISO() }),
      makeEvent({ id: "shoeing", type: "marechal", date: todayISO() }),
    ]);

    const el = await mount();
    await switchToList(el);
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll("app-chip").length > 1,
    );

    chipLabeled(el, labelOf("marechal")).click();
    await settled(el);
    expect(cardIds(el)).toEqual(["shoeing"]);

    chipLabeled(el, "Tous").click();
    await settled(el);
    expect(cardIds(el)).toEqual(["checkup", "shoeing"]);
  });

  /**
   * The round trip the `ViewState` controller exists for.
   *
   * Two mounts in the same history entry stand in for what `app-root` really
   * does — its route template changes, so lit-html tears the element down on
   * the way to an event and builds a brand new one on the way back. Nothing
   * about that is visible from inside a view, which is why this asserts on a
   * second element rather than on the first one surviving.
   */
  it("reopens on the list, with the chip and the search text the visit was left on", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "checkup",
        type: "veto",
        title: "Contrôle œil",
        date: todayISO(),
      }),
      makeEvent({
        id: "vaccine",
        type: "veto",
        title: "Vaccin",
        date: todayISO(),
      }),
      makeEvent({
        id: "shoeing",
        type: "marechal",
        title: "Ferrure",
        date: todayISO(),
      }),
    ]);

    const el = await mount();
    await switchToList(el);
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll("app-chip").length > 1,
    );
    chipLabeled(el, labelOf("veto")).click();
    await settled(el);
    await search(el, "controle");
    expect(cardIds(el)).toEqual(["checkup"]);

    const reopened = await mount();
    // The type chips come from a second, independent `LiveQuery` over the
    // type catalogue — waits for `event-card` alone can resolve first.
    await waitFor(
      reopened,
      () =>
        reopened.querySelector("event-card") !== null &&
        reopened.querySelectorAll("app-chip").length > 1,
    );

    expect(reopened.querySelector("app-calendar")).toBeNull();
    expect(chipLabeled(reopened, labelOf("veto")).selected).toBe(true);
    expect(chipLabeled(reopened, "Tous").selected).toBe(false);
    expect(cardIds(reopened)).toEqual(["checkup"]);
  });

  it("reopens on the day the calendar was left on", async () => {
    const day = addMonths(todayISO(), -2);
    await db.events.add(makeEvent({ id: "back-then", date: day }));

    const el = await mount();
    await waitFor(el, () => el.querySelector("app-calendar") !== null);
    el.querySelector("app-calendar")!.dispatchEvent(
      new CustomEvent("date-select", {
        detail: { date: day },
        bubbles: true,
        composed: true,
      }),
    );
    await settled(el);

    const reopened = await mount();
    await waitFor(
      reopened,
      () => reopened.querySelector("event-card") !== null,
    );

    // The calendar pages itself to follow `value` in its own `willUpdate`, so
    // restoring the selected day restores the month on screen with it.
    expect(cardIds(reopened)).toEqual(["back-then"]);
    expect(reopened.querySelector("app-calendar")!.value).toBe(day);
  });

  /**
   * The invariant `views/events.css` leans on for its `@starting-style` fade.
   *
   * A row only fades in when it is newly rendered — and an element that
   * `repeat()` *moves* counts as newly rendered, because a move is an
   * `insertBefore` that detaches and re-inserts the node. So the fade stays
   * confined to genuinely new rows for exactly one reason: filtering this list
   * never reorders it, so `repeat()` only ever inserts and removes.
   *
   * Asserted on the `<li>` nodes themselves rather than on ids: identity is
   * what proves `repeat()` reused the row instead of rebuilding it, and
   * relative order is what proves it never had to move one. Give the list a
   * sort control and this fails — before a user has to notice every visible row
   * strobing on every keystroke.
   */
  it("keeps surviving rows as the same nodes, in order, when a filter narrows the list", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "newest",
        type: "veto",
        title: "Vaccin",
        date: todayISO(),
      }),
      makeEvent({
        id: "middle",
        type: "marechal",
        title: "Ferrure",
        date: addMonths(todayISO(), -1),
      }),
      makeEvent({
        id: "oldest",
        type: "veto",
        title: "Dentiste",
        date: addMonths(todayISO(), -2),
      }),
    ]);

    const el = await mount();
    await switchToList(el);
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length === 3 &&
        el.querySelectorAll("app-chip").length > 1,
    );

    const rowFor = (id: string) =>
      [...el.querySelectorAll(".events-view__list > li")].find(
        (li) => li.querySelector("event-card")?.event?.id === id,
      );
    const before = { newest: rowFor("newest"), oldest: rowFor("oldest") };
    expect(before.newest).toBeDefined();

    // Drops `middle` from between the two survivors — the case that would force
    // a move if the list were ordered any other way.
    chipLabeled(el, labelOf("veto")).click();
    await settled(el);

    // `toBe`, not `toEqual`: these have to be the *same nodes* in the same
    // order. `toEqual` deep-compares DOM elements structurally, so two freshly
    // rebuilt rows with the same markup would satisfy it — which is precisely
    // the case this test exists to catch.
    const after = [...el.querySelectorAll(".events-view__list > li")];
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before.newest);
    expect(after[1]).toBe(before.oldest);
  });
});
