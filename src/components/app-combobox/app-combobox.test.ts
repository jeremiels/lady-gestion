import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./app-combobox.ts";
import type { AppCombobox } from "./app-combobox.ts";

const OPTIONS = [
  { value: "baladeApied", label: "Balade à pied" },
  { value: "carriere", label: "Carrière" },
  { value: "longe", label: "Longe" },
];

const mount = () =>
  fixture<AppCombobox>(
    html`<app-combobox label="Nom" .options=${OPTIONS}></app-combobox>`,
  );

const input = (el: AppCombobox) => el.renderRoot.querySelector("input")!;

/** The rows the list offers, as the user reads them. */
const rows = (el: AppCombobox) =>
  [...el.renderRoot.querySelectorAll(".field__listbox li")].map((row) =>
    row.textContent!.trim(),
  );

const type = async (el: AppCombobox, text: string) => {
  input(el).value = text;
  input(el).dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(el);
};

describe("app-combobox", () => {
  it("filters ignoring case and accents", async () => {
    const el = await mount();
    input(el).focus();

    await type(el, "carriere");

    expect(rows(el)).toEqual(["Carrière"]);
  });

  it("submits the key of a picked option, and shows and filters on its label", async () => {
    const el = await mount();
    input(el).focus();
    await settled(el);

    el.renderRoot.querySelectorAll<HTMLElement>(".field__option")[0]!.click();
    await settled(el);
    expect(el.value).toBe("baladeApied");
    expect(input(el).value).toBe("Balade à pied");

    // Reopened on the pick, the list offers it — not "Aucun résultat", and not
    // an "Ajouter « baladeApied »" row.
    input(el).blur();
    input(el).focus();
    await settled(el);
    expect(rows(el)).toEqual(["Balade à pied"]);
  });
});
