import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../data/__tests__/factories.ts";
import { BUILT_IN_EVENT_TYPES } from "../../data/event-types.ts";
import { fixture, settled, waitFor } from "../__tests__/fixture.ts";
import "./event-sheet.ts";
import type { EventSheet } from "./event-sheet.ts";

/**
 * The order the form actually draws, read back off the DOM.
 *
 * A type's `fields` array is meant to be the single statement of what its form
 * shows *and in what order*. Asserting the array would only restate it; this
 * reads the rendered controls, which is the half that used to be a fixed
 * sequence written into the template — so a type could list Budget first and
 * still be drawn second.
 */
beforeEach(resetDb);

const openSheet = async () => {
  const el = await fixture<EventSheet>(html`<event-sheet open></event-sheet>`);
  const button = () => el.renderRoot.querySelector('button[type="submit"]')!;
  for (let i = 0; i < 20 && button().hasAttribute("disabled"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled(el);
  }
  return el;
};

const drawTypeNamed = async (key: string) => {
  const el = await openSheet();
  (el as unknown as { type: string }).type = key;
  await settled(el);
  await waitFor(el, () => el.renderRoot.querySelector("form") !== null);
  return [...el.renderRoot.querySelectorAll("form [name]")].map((node) =>
    node.getAttribute("name")!,
  );
};

/** The field ids a type declares, in declaration order. */
const declared = (key: string) =>
  BUILT_IN_EVENT_TYPES.find((type) => type.key === key)!
    .fields.filter((field) => field.role !== "workActivity")
    .map((field) => field.id);

describe("event-sheet — field order comes from the type's `fields`", () => {
  for (const key of ["achat", "alimentation", "veto"]) {
    it(`draws ${key}'s fields in the order its \`fields\` array lists them`, async () => {
      const names = await drawTypeNamed(key);
      const ids = declared(key);

      // Only the type's own fields, in their own order — the base controls
      // (type/Nom/date/note) are interleaved around them and are not the
      // subject here.
      expect(names.filter((name) => ids.includes(name))).toEqual(ids);
    });
  }

  it("puts Budget above Site on Achats", async () => {
    const names = await drawTypeNamed("achat");

    expect(names.indexOf("amountCents")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("amountCents")).toBeLessThan(
      names.indexOf("counterparty"),
    );
  });
});
