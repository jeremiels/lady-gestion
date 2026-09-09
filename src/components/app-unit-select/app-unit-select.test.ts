import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./app-unit-select.ts";
import type { AppUnitSelect, UnitOption } from "./app-unit-select.ts";

/**
 * The behaviour here is all platform integration — `ElementInternals`, radio
 * group validity and form participation — so these run in a real browser, same
 * as `app-input.test.ts`. In jsdom every assertion below would be checking a
 * mock.
 */
const OPTIONS: UnitOption[] = [
  { value: "mL", label: "mL" },
  { value: "kg", label: "kg" },
  { value: "L", label: "L" },
];

const radios = (el: AppUnitSelect) => [
  ...el.renderRoot.querySelectorAll<HTMLInputElement>(".option__input"),
];

const radioFor = (el: AppUnitSelect, value: string) =>
  radios(el).find((input) => input.value === value)!;

describe("app-unit-select", () => {
  describe("labelling", () => {
    it("names the group for assistive tech without showing a caption", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
        ></app-unit-select>`,
      );

      const group = el.renderRoot.querySelector('[role="radiogroup"]')!;
      const labelledBy = group.getAttribute("aria-labelledby")!;
      const label = el.renderRoot.querySelector(`#${labelledBy}`);

      expect(label?.textContent?.trim()).toBe("Unité");
      // Clipped, not removed — the group still needs an accessible name.
      expect(getComputedStyle(label!).clipPath).not.toBe("none");
    });
  });

  describe("selection", () => {
    it("renders one radio per option, with the current value checked", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
          value="kg"
        ></app-unit-select>`,
      );

      expect(radios(el).map((input) => input.value)).toEqual(["mL", "kg", "L"]);
      expect(radioFor(el, "kg").checked).toBe(true);
      expect(radioFor(el, "mL").checked).toBe(false);
    });

    it("selects an option on click and fires unit-select-change", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
          value="kg"
        ></app-unit-select>`,
      );

      let detail: { value: string } | undefined;
      el.addEventListener("unit-select-change", (event) => {
        detail = (event as CustomEvent).detail;
      });

      radioFor(el, "L").click();
      await settled(el);

      expect(el.value).toBe("L");
      expect(detail).toEqual({ value: "L" });
      expect(radioFor(el, "kg").checked).toBe(false);
    });

    it("moves the checked radio on a programmatic value change too", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
          value="mL"
        ></app-unit-select>`,
      );

      el.value = "L";
      await settled(el);

      expect(radioFor(el, "L").checked).toBe(true);
      expect(radioFor(el, "mL").checked).toBe(false);
    });
  });

  describe("form participation", () => {
    it("contributes the checked value to FormData under its name", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <app-unit-select
            label="Unité"
            name="unit"
            .options=${OPTIONS}
            value="kg"
          ></app-unit-select>
        </form>
      `);
      await settled(form.querySelector("app-unit-select")!);

      expect(new FormData(form).get("unit")).toBe("kg");
    });

    it("tracks a later click", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <app-unit-select
            label="Unité"
            name="unit"
            .options=${OPTIONS}
            value="kg"
          ></app-unit-select>
        </form>
      `);
      const el = form.querySelector("app-unit-select")!;
      await settled(el);

      radioFor(el, "L").click();
      await settled(el);

      expect(new FormData(form).get("unit")).toBe("L");
    });

    it("restores its initial value on form reset", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <app-unit-select
            label="Unité"
            name="unit"
            .options=${OPTIONS}
            value="kg"
          ></app-unit-select>
        </form>
      `);
      const el = form.querySelector("app-unit-select")!;
      await settled(el);

      radioFor(el, "L").click();
      await settled(el);

      form.reset();
      await settled(el);

      expect(el.value).toBe("kg");
      expect(radioFor(el, "kg").checked).toBe(true);
      expect(new FormData(form).get("unit")).toBe("kg");
    });

    it("exposes the form it belongs to", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <app-unit-select
            label="Unité"
            name="unit"
            .options=${OPTIONS}
          ></app-unit-select>
        </form>
      `);
      const el = form.querySelector("app-unit-select")!;
      await settled(el);

      expect(el.form).toBe(form);
    });

    it("follows a fieldset being disabled", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <fieldset>
            <app-unit-select
              label="Unité"
              name="unit"
              .options=${OPTIONS}
            ></app-unit-select>
          </fieldset>
        </form>
      `);
      const el = form.querySelector("app-unit-select")!;
      await settled(el);
      expect(el.disabled).toBe(false);

      form.querySelector("fieldset")!.disabled = true;
      await settled(el);

      expect(el.disabled).toBe(true);
      expect(radioFor(el, "mL").disabled).toBe(true);
    });
  });

  describe("validity", () => {
    it("is invalid to the form when required and nothing is checked", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
          required
        ></app-unit-select>`,
      );

      expect(el.validity.valueMissing).toBe(true);
      expect(el.checkValidity()).toBe(false);
    });

    it("becomes valid once an option is checked", async () => {
      const el = await fixture<AppUnitSelect>(
        html`<app-unit-select
          label="Unité"
          .options=${OPTIONS}
          required
        ></app-unit-select>`,
      );

      radioFor(el, "kg").click();
      await settled(el);

      expect(el.checkValidity()).toBe(true);
    });

    it("marks itself touched when a submission finds it invalid", async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <app-unit-select
            label="Unité"
            name="unit"
            .options=${OPTIONS}
            required
          ></app-unit-select>
        </form>
      `);
      const el = form.querySelector("app-unit-select")!;
      await settled(el);

      expect(form.reportValidity()).toBe(false);
      await settled(el);

      expect(el.matches(":state(invalid)")).toBe(true);
    });
  });
});
