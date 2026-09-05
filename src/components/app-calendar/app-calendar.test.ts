import { html } from "lit";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../data/icalendar.ts";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./app-calendar.ts";
import type { AppCalendar } from "./app-calendar.ts";

/** A Sunday mid-month, so every arrow key has somewhere to go in both directions. */
const ANCHOR = "2026-03-15";

/**
 * A single all-day occurrence. Built in full rather than partially, because the
 * calendar hands these straight to `occurrencesByDate`, which walks `end` — a
 * half-built literal fails inside date arithmetic rather than at the boundary.
 */
const calendarEvent = (uid: string, start: string): CalendarEvent => ({
  uid,
  start,
  startTime: null,
  end: null,
  status: "CONFIRMED",
  summary: `Évènement ${uid}`,
  categories: [],
});

const mount = () =>
  fixture<AppCalendar>(
    html`<app-calendar
      .value=${ANCHOR}
      .today=${ANCHOR}
      week-start="MO"
    ></app-calendar>`,
  );

/** The day currently holding the grid's single tab stop. */
const tabStop = (el: AppCalendar) =>
  el.renderRoot.querySelector<HTMLButtonElement>(
    '.calendar__day[tabindex="0"]',
  );

const press = async (
  el: AppCalendar,
  key: string,
  init: KeyboardEventInit = {},
) => {
  el.renderRoot
    .querySelector(".calendar__grid")!
    .dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  await settled(el);
};

/**
 * The ARIA grid pattern is the whole point of this component and none of it is
 * expressible without a real browser: a roving tabindex is only meaningful
 * against actual focus, and the month arithmetic crosses boundaries the grid
 * has to follow on its own.
 */
describe("app-calendar", () => {
  describe("roving tab stop", () => {
    it("gives the grid exactly one tab stop", async () => {
      const el = await mount();

      const stops = el.renderRoot.querySelectorAll(
        '.calendar__day[tabindex="0"]',
      );
      expect(stops).toHaveLength(1);
      expect(tabStop(el)?.textContent?.trim()).toBe("15");
    });

    it("leaves every other day out of the tab order", async () => {
      const el = await mount();

      const days = [...el.renderRoot.querySelectorAll(".calendar__day")];
      expect(days.length).toBeGreaterThan(28);
      expect(
        days.filter((day) => day.getAttribute("tabindex") === "-1"),
      ).toHaveLength(days.length - 1);
    });
  });

  describe("arrow keys", () => {
    it.each([
      ["ArrowRight", "16"],
      ["ArrowLeft", "14"],
      ["ArrowDown", "22"],
      ["ArrowUp", "8"],
    ])("%s moves the tab stop to %s", async (key, expected) => {
      const el = await mount();
      await press(el, key);

      expect(tabStop(el)?.textContent?.trim()).toBe(expected);
    });

    it("moves without selecting", async () => {
      const el = await mount();
      await press(el, "ArrowRight");

      // The selected day is still the 15th — arrows move focus, Enter commits.
      expect(el.value).toBe(ANCHOR);
      expect(
        el.renderRoot
          .querySelector(".calendar__day--selected")
          ?.textContent?.trim(),
      ).toBe("15");
    });

    it("cancels the event so the page does not scroll", async () => {
      const el = await mount();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });

      el.renderRoot.querySelector(".calendar__grid")!.dispatchEvent(event);
      await settled(el);

      expect(event.defaultPrevented).toBe(true);
    });

    it("ignores keys it does not handle", async () => {
      const el = await mount();
      const event = new KeyboardEvent("keydown", {
        key: "a",
        bubbles: true,
        cancelable: true,
      });

      el.renderRoot.querySelector(".calendar__grid")!.dispatchEvent(event);
      await settled(el);

      expect(event.defaultPrevented).toBe(false);
      expect(tabStop(el)?.textContent?.trim()).toBe("15");
    });
  });

  describe("Home and End", () => {
    it("Home goes to the start of the week, which is Monday here", async () => {
      const el = await mount();
      await press(el, "Home");

      // 15 March 2026 is a Sunday, so with WKST=MO its week starts on the 9th.
      expect(tabStop(el)?.textContent?.trim()).toBe("9");
    });

    it("End goes to the last day of the same week", async () => {
      const el = await mount();
      await press(el, "End");

      expect(tabStop(el)?.textContent?.trim()).toBe("15");
    });
  });

  describe("crossing a month boundary", () => {
    it("pulls the visible month along and announces it", async () => {
      const el = await mount();
      const months: string[] = [];
      el.addEventListener("month-change", (event) => {
        months.push((event as CustomEvent<{ month: string }>).detail.month);
      });

      await press(el, "PageDown");

      expect(months).toEqual(["2026-04-01"]);
      expect(tabStop(el)?.textContent?.trim()).toBe("15");
      // `formatMonthYear` upper-cases the first letter, which `fr-FR` does not.
      expect(
        el.renderRoot.querySelector(".calendar__month")?.textContent?.trim(),
      ).toBe("Avril 2026");
    });

    it("PageUp with Shift moves a year", async () => {
      const el = await mount();
      await press(el, "PageUp", { shiftKey: true });

      expect(
        el.renderRoot.querySelector(".calendar__month")?.textContent,
      ).toContain("2025");
    });

    it("keeps the focused day inside a shorter month", async () => {
      const el = await fixture<AppCalendar>(
        html`<app-calendar
          .value=${"2026-01-31"}
          .today=${ANCHOR}
          week-start="MO"
        ></app-calendar>`,
      );

      // The month arrow, not a key: this is the path that clamps.
      el.renderRoot
        .querySelectorAll<HTMLButtonElement>(".calendar__nav")[1]!
        .click();
      await settled(el);

      expect(
        el.renderRoot.querySelector(".calendar__month")?.textContent?.trim(),
      ).toBe("Février 2026");
      // 31 January has no counterpart in February, so it clamps to the 28th
      // rather than spilling into March.
      expect(tabStop(el)?.textContent?.trim()).toBe("28");
    });
  });

  describe("selection", () => {
    it("Enter selects the focused day and says so", async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener("date-select", (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      await press(el, "ArrowRight");
      await press(el, "Enter");

      expect(selected).toEqual(["2026-03-16"]);
      expect(el.value).toBe("2026-03-16");
      expect(
        el.renderRoot
          .querySelector(".calendar__day--selected")
          ?.textContent?.trim(),
      ).toBe("16");
    });

    it("Space selects too, and does not also re-trigger the button", async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener("date-select", (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      await press(el, " ");

      expect(selected).toEqual([ANCHOR]);
    });

    it("clicking a day selects it", async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener("date-select", (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      const days = [
        ...el.renderRoot.querySelectorAll<HTMLButtonElement>(".calendar__day"),
      ];
      days.find((day) => day.textContent?.trim() === "20")!.click();
      await settled(el);

      expect(selected).toEqual(["2026-03-20"]);
    });
  });

  describe("accessible names", () => {
    it("marks today with aria-current", async () => {
      const el = await mount();

      const today = el.renderRoot.querySelector(".calendar__day--today");
      expect(today?.getAttribute("aria-current")).toBe("date");
      expect(today?.textContent?.trim()).toBe("15");
    });

    it("spells out the event count, which the dot cannot", async () => {
      const el = await fixture<AppCalendar>(html`
        <app-calendar
          .value=${ANCHOR}
          .today=${ANCHOR}
          week-start="MO"
          .events=${[calendarEvent("a", "2026-03-20"), calendarEvent("b", "2026-03-20")]}
        ></app-calendar>
      `);

      const days = [...el.renderRoot.querySelectorAll(".calendar__day")];
      const day20 = days.find((day) => day.textContent?.trim() === "20");

      expect(day20?.getAttribute("aria-label")).toContain("2 évènements");
    });

    it("stays silent about events on days spilling in from another month", async () => {
      const el = await fixture<AppCalendar>(html`
        <app-calendar
          .value=${ANCHOR}
          .today=${ANCHOR}
          week-start="MO"
          .events=${[calendarEvent("a", "2026-04-02")]}
        ></app-calendar>
      `);

      const outside = el.renderRoot.querySelector(
        '.calendar__day--outside[aria-label*="2 avril"]',
      );

      expect(outside).not.toBeNull();
      expect(outside?.getAttribute("aria-label")).not.toContain("évènement");
      expect(
        outside?.parentElement?.querySelector(".calendar__dot"),
      ).toBeNull();
    });
  });

  describe("sliding selection", () => {
    /**
     * Where the travelling pill actually is. It is the grid's `::after`, so it
     * has no node to measure — the resolved inset off the grid's own box is
     * the only view of it, and the only thing that distinguishes a resolved
     * anchor from one that quietly fell back to `auto`.
     */
    const pillAt = (el: AppCalendar) => {
      const grid = el.renderRoot.querySelector(".calendar__grid")!;
      const box = grid.getBoundingClientRect();
      const after = getComputedStyle(grid, "::after");
      return [
        Math.round(box.left + parseFloat(after.left)),
        Math.round(box.top + parseFloat(after.top)),
      ];
    };

    const selectedAt = (el: AppCalendar) => {
      const box = el.renderRoot
        .querySelector(".calendar__day--selected")!
        .getBoundingClientRect();
      return [Math.round(box.left), Math.round(box.top)];
    };

    it("anchors the pill to the selected day, and to no other", async () => {
      const el = await mount();

      const anchored = [
        ...el.renderRoot.querySelectorAll(".sliding-selection__active"),
      ];

      expect(anchored).toHaveLength(1);
      expect(anchored[0]!.textContent?.trim()).toBe("15");
      expect(pillAt(el)).toEqual(selectedAt(el));
    });

    it("follows the selection to another day", async () => {
      const el = await mount();

      el.value = "2026-03-23";
      await settled(el);

      expect(
        el.renderRoot
          .querySelector(".sliding-selection__active")
          ?.textContent?.trim(),
      ).toBe("23");
    });

    /**
     * Mounted with a travel time of its own, because the fixture has none: the
     * motion tokens live in the document stylesheet this suite does not load,
     * so the pill's `var(--duration-medium)` is invalid here and *every* move
     * lands instantly — an assertion about snapping would pass against a
     * component that had never learned to slide. Five linear seconds through
     * the mixin's own knob makes "did it travel?" readable on the first frame.
     */
    const mountSlow = () =>
      fixture<AppCalendar>(html`
        <app-calendar
          .value=${ANCHOR}
          .today=${ANCHOR}
          week-start="MO"
          style="--sliding-selection-duration: 5s; --sliding-selection-easing: linear"
        ></app-calendar>
      `);

    it("travels from the old cell when the selection moves within the month", async () => {
      const el = await mountSlow();
      const from = pillAt(el);

      el.value = "2026-03-23";
      await settled(el);

      // One frame in, five seconds of travel has barely started: the pill is
      // still where it was, which is what proves it moves at all.
      expect(pillAt(el)).toEqual(from);
      expect(pillAt(el)).not.toEqual(selectedAt(el));
    });

    it("lands on the new cell without travelling when the month pages", async () => {
      const el = await mountSlow();

      // 1 April is a spill day at the foot of March and the second cell of
      // April, so selecting it moves the pill *and* the month. A page is not a
      // move: the pill has to be there already, where the test above proves it
      // would otherwise still be crossing the grid.
      el.renderRoot
        .querySelector<HTMLButtonElement>(
          '.calendar__day--outside[aria-label^="1 avril"]',
        )!
        .click();
      await settled(el);

      expect(
        el.renderRoot.querySelector(".calendar__month")?.textContent?.trim(),
      ).toBe("Avril 2026");
      expect(pillAt(el)).toEqual(selectedAt(el));
    });
  });
});
