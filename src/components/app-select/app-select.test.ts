import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture } from "../__tests__/fixture.ts";
import "./app-select.ts";
import type { AppSelect, AppSelectOption } from "./app-select.ts";

/**
 * The grouping half of this component. Everything else about it is covered
 * through the forms that use it; `group` is new surface with no caller yet
 * outside the event sheet's type picker.
 */

const mount = async (options: AppSelectOption[]) => {
  const el = await fixture<AppSelect>(
    html`<app-select label="Type" .options=${options}></app-select>`,
  );
  return el;
};

const structure = (el: AppSelect) =>
  [...el.renderRoot.querySelectorAll("select > *")].map((node) =>
    node instanceof HTMLOptGroupElement
      ? {
          group: node.label,
          options: [...node.children].map((child) => child.textContent?.trim()),
        }
      : node.textContent?.trim(),
  );

describe("app-select grouping", () => {
  it("renders a flat list when no option carries a group", async () => {
    const el = await mount([
      { value: "a", label: "Achats" },
      { value: "b", label: "Cours" },
    ]);

    expect(structure(el)).toEqual(["Achats", "Cours"]);
    expect(el.renderRoot.querySelector("optgroup")).toBeNull();
  });

  it("wraps consecutive options sharing a group in one optgroup", async () => {
    const el = await mount([
      { value: "soins", label: "Soins", group: "Soins" },
      { value: "veto", label: "Vétérinaire", group: "Soins" },
      { value: "dentiste", label: "Dentiste", group: "Soins" },
    ]);

    expect(structure(el)).toEqual([
      { group: "Soins", options: ["Soins", "Vétérinaire", "Dentiste"] },
    ]);
  });

  it("keeps grouped and ungrouped options in the order they were given", async () => {
    const el = await mount([
      { value: "achat", label: "Achats" },
      { value: "soins", label: "Soins", group: "Soins" },
      { value: "veto", label: "Vétérinaire", group: "Soins" },
      { value: "cours", label: "Cours" },
    ]);

    expect(structure(el)).toEqual([
      "Achats",
      { group: "Soins", options: ["Soins", "Vétérinaire"] },
      "Cours",
    ]);
  });

  it("opens a second optgroup rather than merging two runs of the same name", async () => {
    // A caller that scatters a group's members has ordered its list that way
    // on purpose; silently gathering them would reshuffle it.
    const el = await mount([
      { value: "a", label: "A", group: "G" },
      { value: "b", label: "B", group: "H" },
      { value: "c", label: "C", group: "G" },
    ]);

    expect(structure(el)).toEqual([
      { group: "G", options: ["A"] },
      { group: "H", options: ["B"] },
      { group: "G", options: ["C"] },
    ]);
  });

  it("still selects an option inside a group", async () => {
    const el = await fixture<AppSelect>(
      html`<app-select
        label="Type"
        .options=${[
          { value: "soins", label: "Soins", group: "Soins" },
          { value: "veto", label: "Vétérinaire", group: "Soins" },
        ]}
        .value=${"veto"}
      ></app-select>`,
    );

    expect(el.renderRoot.querySelector("select")!.value).toBe("veto");
  });

  it("keeps the placeholder outside every group", async () => {
    const el = await fixture<AppSelect>(
      html`<app-select
        label="Type"
        placeholder="Choisir un type"
        .options=${[{ value: "veto", label: "Vétérinaire", group: "Soins" }]}
      ></app-select>`,
    );

    expect(structure(el)).toEqual([
      "Choisir un type",
      { group: "Soins", options: ["Vétérinaire"] },
    ]);
  });
});
