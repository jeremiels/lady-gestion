import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./app-checkbox.ts";
import type { AppCheckbox } from "./app-checkbox.ts";

/** A checkbox in a real form, the way every sheet uses one. */
const inForm = async (checked = false) => {
  const form = await fixture<HTMLFormElement>(
    html`<form>
      <app-checkbox
        label="Planifier un rendez-vous"
        name="followUp"
        ?checked=${checked}
      ></app-checkbox>
    </form>`,
  );
  const box = form.querySelector<AppCheckbox>("app-checkbox")!;
  await settled(box);
  return { form, box };
};

const tick = async (box: AppCheckbox) => {
  box.renderRoot.querySelector("input")!.click();
  await settled(box);
};

describe("app-checkbox", () => {
  it("submits its value only while ticked, like a native checkbox", async () => {
    const { form, box } = await inForm();
    expect(new FormData(form).has("followUp")).toBe(false);

    await tick(box);

    expect(new FormData(form).get("followUp")).toBe("on");
  });

  it("reports a tick outside its shadow root, with the new state", async () => {
    const { form, box } = await inForm();
    const seen: boolean[] = [];
    form.addEventListener("checkbox-change", (event) =>
      seen.push((event as CustomEvent<{ checked: boolean }>).detail.checked),
    );

    await tick(box);
    await tick(box);

    expect(seen).toEqual([true, false]);
  });

  it("goes back to how it was rendered when its form resets", async () => {
    const { form, box } = await inForm(true);

    await tick(box);
    expect(box.checked).toBe(false);

    form.reset();
    await settled(box);

    expect(box.checked).toBe(true);
    expect(new FormData(form).get("followUp")).toBe("on");
  });
});
