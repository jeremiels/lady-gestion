import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./app-segmented.ts";
import type { AppSegmented, SegmentedOption } from "./app-segmented.ts";

/** Two words of different widths: the pill has to resize, not only travel. */
const OPTIONS: SegmentedOption[] = [
  { value: "month", icon: undefined, label: "Mois" },
  { value: "year", icon: undefined, label: "Année" },
];

const mount = (value: string) =>
  fixture<AppSegmented>(
    html`<app-segmented
      label="Période"
      .options=${OPTIONS}
      value=${value}
    ></app-segmented>`,
  );

const options = (el: AppSegmented) => [
  ...el.renderRoot.querySelectorAll<HTMLButtonElement>(".segmented__option"),
];

const anchored = (el: AppSegmented) =>
  options(el).filter((option) =>
    option.classList.contains("sliding-selection__active"),
  );

/** The travelling pill, which is the container's `::after` and has no node. */
const pill = (el: AppSegmented) =>
  getComputedStyle(el.renderRoot.querySelector(".segmented")!, "::after");

describe("app-segmented sliding selection", () => {
  it("anchors the pill to exactly one segment, and to the checked one", async () => {
    const el = await mount("month");

    expect(anchored(el).map((option) => option.textContent?.trim())).toEqual([
      "Mois",
    ]);

    options(el)[1]!.click();
    await settled(el);

    // Nothing moves the pill but this class, so a second one — or none — is a
    // silently broken animation rather than a failing assertion elsewhere.
    expect(anchored(el).map((option) => option.textContent?.trim())).toEqual([
      "Année",
    ]);
  });

  it("moves the anchor on a programmatic value change too", async () => {
    const el = await mount("month");

    el.value = "year";
    await settled(el);

    expect(anchored(el).map((option) => option.textContent?.trim())).toEqual([
      "Année",
    ]);
  });

  for (const [index, option] of OPTIONS.entries()) {
    it(`resolves the pill onto the ${option.label} segment's box`, async () => {
      // A fresh fixture per value rather than a click, so the pill is measured
      // at rest: mid-transition these read whatever frame the browser is on.
      const el = await mount(option.value);
      const button = options(el)[index]!;
      const after = pill(el);

      // The real guarantee. An unresolved anchor() is invalid at computed-value
      // time and the insets quietly fall back to `auto`, which still paints a
      // white pill — in the container's corner, at the wrong size. Comparing
      // against the button's own box is what tells the two apart.
      expect(parseFloat(after.left)).toBeCloseTo(button.offsetLeft, 0);
      expect(parseFloat(after.width)).toBeCloseTo(button.offsetWidth, 0);
      expect(parseFloat(after.height)).toBeCloseTo(button.offsetHeight, 0);
    });
  }
});
