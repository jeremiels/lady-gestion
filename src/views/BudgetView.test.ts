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
import "./BudgetView.ts";
import type { BudgetView } from "./BudgetView.ts";

/** Label lookup for the real 13 built-ins, standing in for `eventType.label`
 * now that a type's label is data rather than a compile-time table. */
const LABEL_OF = new Map(
  BUILT_IN_EVENT_TYPE_ROWS.map((type) => [type.key, type.label]),
);
const labelOf = (key: string): string => LABEL_OF.get(key) ?? "";

const mount = () => fixture<BudgetView>(html`<budget-view></budget-view>`);

const ledgerIds = (el: BudgetView) =>
  [...el.querySelectorAll("event-card")].map((card) => card.event?.id).sort();

const setGranularity = async (el: BudgetView, value: "month" | "year") => {
  el.querySelector("app-segmented")!.dispatchEvent(
    new CustomEvent("segment-change", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
  await settled(el);
};

const switchToYear = (el: BudgetView) => setGranularity(el, "year");

const legendFor = (el: BudgetView, type: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".budget-view__legend-item")].find(
    (item) =>
      item.querySelector(".budget-view__legend-label")?.textContent?.trim() ===
      labelOf(type),
  )!;

const hiddenInChart = (el: BudgetView) =>
  el.querySelector("app-donut-chart")!.hiddenIds;

const toggleLegend = async (el: BudgetView, type: string) => {
  legendFor(el, type).click();
  await settled(el);
};

/**
 * Files one built-in type under another, the way `setParent` writes it. The
 * seeded catalogue is flat; a nested one comes from the type editor or a
 * restore.
 */
const nest = async (childKey: string, parentKey: string) => {
  const child = BUILT_IN_EVENT_TYPE_ROWS.find((t) => t.key === childKey)!;
  const parent = BUILT_IN_EVENT_TYPE_ROWS.find((t) => t.key === parentKey)!;
  await db.eventTypes.put({ ...child, parentId: parent.id, theme: null });
};

const legendLabels = (el: BudgetView) =>
  [...el.querySelectorAll(".budget-view__legend-label")].map((node) =>
    node.textContent?.trim(),
  );

const breakdownFor = (el: BudgetView, type: string) =>
  legendFor(el, type).parentElement!.querySelector("details");

const pickPeriod = async (el: BudgetView, key: string) => {
  el.querySelector("app-select")!.dispatchEvent(
    new CustomEvent("select-change", {
      detail: { value: key },
      bubbles: true,
      composed: true,
    }),
  );
  await settled(el);
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("budget-view", () => {
  it("defaults to this month, split by type, and drops a cancelled entry", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "this-month-veto",
        type: "veto",
        date: todayISO(),
        customFields: { amountCents: 4000 },
      }),
      makeEvent({
        id: "this-month-marechal",
        type: "marechal",
        date: todayISO(),
        customFields: { amountCents: 6000 },
      }),
      makeEvent({
        id: "last-month",
        type: "veto",
        date: addMonths(todayISO(), -1),
        customFields: { amountCents: 9999 },
      }),
      makeEvent({
        id: "cancelled",
        type: "veto",
        date: todayISO(),
        customFields: { amountCents: 1000 },
        status: "cancelled",
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );

    expect(ledgerIds(el)).toEqual(["this-month-marechal", "this-month-veto"]);

    expect(legendLabels(el)).toEqual(
      expect.arrayContaining([labelOf("veto"), labelOf("marechal")]),
    );
  });

  it("switching to year widens the period without reaching into last year", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "this-month",
        date: todayISO(),
        customFields: { amountCents: 1000 },
      }),
      makeEvent({
        id: "last-month",
        date: addMonths(todayISO(), -1),
        customFields: { amountCents: 2000 },
      }),
      // 13 months back always lands outside the current year, whatever month
      // this test happens to run in.
      makeEvent({
        id: "last-year",
        date: addMonths(todayISO(), -13),
        customFields: { amountCents: 3000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );
    expect(ledgerIds(el)).toEqual(["this-month"]);

    await switchToYear(el);

    expect(ledgerIds(el)).toEqual(["last-month", "this-month"]);
  });

  /**
   * The round trip the `ViewState` controller exists for.
   *
   * Two mounts stand in for what `app-root` really does — its route template
   * changes on the way to an budget's page, so lit-html discards this element
   * and builds a fresh one on the way back.
   */
  it("reopens on the period the visit was left on, month and year still held apart", async () => {
    const lastYear = addMonths(todayISO(), -13);
    await db.events.bulkAdd([
      makeEvent({
        id: "this-month",
        date: todayISO(),
        customFields: { amountCents: 1000 },
      }),
      makeEvent({
        id: "back-then",
        date: lastYear,
        customFields: { amountCents: 3000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );
    await switchToYear(el);
    await pickPeriod(el, lastYear.slice(0, 4));
    expect(ledgerIds(el)).toEqual(["back-then"]);

    const reopened = await mount();
    await waitFor(
      reopened,
      () => reopened.querySelectorAll("event-card").length > 0,
    );
    expect(ledgerIds(reopened)).toEqual(["back-then"]);

    // The two keys survive the round trip separately, which is the whole reason
    // they are stored separately: flipping back to Mois returns to the month
    // that was selected rather than guessing one out of the year.
    await setGranularity(reopened, "month");
    expect(ledgerIds(reopened)).toEqual(["this-month"]);
  });

  /**
   * The invariant `views/budget.css` leans on for its `@starting-style`
   * fade: `render()` sorts every period with the same `byDateDescending`, so
   * this month's rows are a contiguous block of the year's rows. Widening
   * Mois→Année only inserts rows before and after that block, so the
   * survivors never have to move — and a moved node (an `insertBefore` that
   * detaches and re-inserts) would re-fade from zero, which is what the CSS
   * is relying on not happening.
   *
   * Asserted on the `<li>` nodes themselves, not on ids: identity is what
   * proves `repeat()` reused the row instead of rebuilding it, and relative
   * order is what proves it never had to move one.
   */
  it("keeps surviving rows as the same nodes, in order, when switching Mois to Année", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "this-month",
        date: todayISO(),
        customFields: { amountCents: 1000 },
      }),
      makeEvent({
        id: "last-month",
        date: addMonths(todayISO(), -1),
        customFields: { amountCents: 2000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );

    const rowFor = (id: string) =>
      [...el.querySelectorAll(".budget-view__list > li")].find(
        (li) => li.querySelector("event-card")?.event?.id === id,
      );
    const before = rowFor("this-month");
    expect(before).toBeDefined();

    await switchToYear(el);

    const after = [...el.querySelectorAll(".budget-view__list > li")];
    expect(
      after.map((li) => li.querySelector("event-card")?.event?.id),
    ).toEqual(["this-month", "last-month"]);
    expect(after[0]).toBe(before);
  });
  /**
   * The legend is the chart's control, and only the chart's.
   *
   * Muting a category re-weights the ring and the figure inside it; the ledger
   * below stays the period's full record. Filtering it too would also break
   * what the `@starting-style` fade in `views/budget.css` leans on — rows would
   * have to move past each other on every tap, and a moved node re-fades from
   * zero.
   */
  it("muting a legend category takes it out of the ring but not out of the ledger", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "veto",
        type: "veto",
        date: todayISO(),
        customFields: { amountCents: 4000 },
      }),
      makeEvent({
        id: "marechal",
        type: "marechal",
        date: todayISO(),
        customFields: { amountCents: 6000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );
    expect(legendFor(el, "veto").getAttribute("aria-pressed")).toBe("true");

    await toggleLegend(el, "veto");

    const row = legendFor(el, "veto");
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.classList.contains("budget-view__legend-item--off")).toBe(true);
    expect(hiddenInChart(el)).toEqual(["veto"]);
    // Still listed, and still tappable — the row is the only way back.
    expect(
      row.querySelector(".budget-view__legend-value")?.textContent,
    ).toContain("40");
    expect(ledgerIds(el)).toEqual(["marechal", "veto"]);
  });

  it("tapping a muted category again brings it back", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "veto",
        type: "veto",
        date: todayISO(),
        customFields: { amountCents: 4000 },
      }),
      makeEvent({
        id: "marechal",
        type: "marechal",
        date: todayISO(),
        customFields: { amountCents: 6000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );

    await toggleLegend(el, "veto");
    await toggleLegend(el, "veto");

    expect(hiddenInChart(el)).toEqual([]);
    expect(legendFor(el, "veto").getAttribute("aria-pressed")).toBe("true");
  });

  /**
   * The other half of what `ViewState` buys, alongside the period: a category
   * muted here is still muted after drilling into a row and pressing Retour —
   * two mounts standing in for the element `app-root` tears down and rebuilds —
   * and it survives a change of period, where `sumByType` simply never offers a
   * category the new period has nothing in.
   */
  it("remembers muted categories across a period change and a remount", async () => {
    await db.events.bulkAdd([
      makeEvent({
        id: "this-month",
        type: "veto",
        date: todayISO(),
        customFields: { amountCents: 4000 },
      }),
      makeEvent({
        id: "last-month",
        type: "veto",
        date: addMonths(todayISO(), -1),
        customFields: { amountCents: 5000 },
      }),
      makeEvent({
        id: "marechal",
        type: "marechal",
        date: todayISO(),
        customFields: { amountCents: 6000 },
      }),
    ]);

    const el = await mount();
    await waitFor(
      el,
      () =>
        el.querySelectorAll("event-card").length > 0 &&
        el.querySelectorAll(".budget-view__legend-item").length > 0,
    );
    await toggleLegend(el, "veto");

    await switchToYear(el);
    expect(hiddenInChart(el)).toEqual(["veto"]);

    const reopened = await mount();
    await waitFor(
      reopened,
      () =>
        reopened.querySelectorAll("event-card").length > 0 &&
        reopened.querySelectorAll(".budget-view__legend-item").length > 0,
    );
    expect(hiddenInChart(reopened)).toEqual(["veto"]);
    expect(legendFor(reopened, "veto").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  describe("with a nested type catalogue", () => {
    const spend = (id: string, type: string, amountCents: number) =>
      makeEvent({ id, type, date: todayISO(), customFields: { amountCents } });

    const openWithSpend = async () => {
      const el = await mount();
      await waitFor(
        el,
        () => el.querySelectorAll(".budget-view__legend-item").length > 0,
      );
      return el;
    };

    beforeEach(async () => {
      await nest("osteo", "soins");
      await nest("dentiste", "soins");
      await db.events.bulkAdd([
        spend("care", "soins", 1000),
        spend("checkup", "osteo", 2000),
        spend("teeth", "dentiste", 500),
        spend("shoeing", "marechal", 7000),
      ]);
    });

    it("gives the group one legend row, not one per child", async () => {
      const el = await openWithSpend();

      expect(legendLabels(el)).toEqual([labelOf("marechal"), labelOf("soins")]);
    });

    it("rolls the children's spend into the group's total", async () => {
      const el = await openWithSpend();

      expect(
        legendFor(el, "soins").querySelector(".budget-view__legend-value")
          ?.textContent,
      ).toContain("35");
    });

    it("breaks the group down per child, collapsed by default", async () => {
      const el = await openWithSpend();

      const details = breakdownFor(el, "soins")!;
      expect(details.open).toBe(false);
      expect(details.querySelector("summary")?.textContent?.trim()).toBe(
        "2 sous-types",
      );
      expect(
        [...details.querySelectorAll("li")].map((li) =>
          li.firstElementChild?.textContent?.trim(),
        ),
      ).toEqual([labelOf("dentiste"), labelOf("osteo")]);
    });

    it("gives a root with no children no breakdown at all", async () => {
      const el = await openWithSpend();

      expect(breakdownFor(el, "marechal")).toBeNull();
    });

    it("draws one wedge per group, so no two share a colour", async () => {
      const el = await openWithSpend();

      expect(
        el.querySelector("app-donut-chart")!.slices.map((slice) => slice.id),
      ).toEqual(["marechal", "soins"]);
    });

    it("switching a group off takes its children with it", async () => {
      const el = await openWithSpend();

      await toggleLegend(el, "soins");

      expect(hiddenInChart(el)).toEqual(["soins"]);
      expect(legendLabels(el)).toContain(labelOf("soins"));
    });
  });
});
