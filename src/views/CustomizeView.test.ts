import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { DEFAULT_SEASON, rationsRepo } from "../data/index.ts";
import {
  HORSE_ID,
  makeHorse,
  makeRation,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./CustomizeView.ts";
import type { CustomizeView } from "./CustomizeView.ts";

import type { CustomizeTab } from "../commons/sections.ts";
import type { AppSwitch } from "../components/app-switch/app-switch.ts";
import type { CustomizeCategories } from "../components/customize-categories/customize-categories.ts";
import type { CustomizeHorse } from "../components/customize-horse/customize-horse.ts";
import type { AppInput } from "../components/app-input/app-input.ts";
import type { AppSelect } from "../components/app-select/app-select.ts";
import type { CustomizeRation } from "../components/customize-ration/customize-ration.ts";
import type { HorseRation } from "../components/horse-ration/horse-ration.ts";
import type { RationForm } from "../components/ration-form/ration-form.ts";
import type { RationSheet } from "../components/ration-sheet/ration-sheet.ts";

const mount = (current: CustomizeTab = "ration") =>
  fixture<CustomizeView>(
    html`<customize-view .tab=${current}></customize-view>`,
  );

/** The pieces of the tab live in their own shadow roots. */
const tab = (el: CustomizeView) =>
  el.querySelector<CustomizeRation>("customize-ration")!;
const list = (el: CustomizeView) =>
  tab(el).renderRoot.querySelector<HorseRation>("horse-ration")!;
const sheet = (el: CustomizeView) =>
  el.querySelector<RationSheet>("ration-sheet")!;
/** The add form's fields, one shadow root further down. */
const addForm = (el: CustomizeView) =>
  tab(el).renderRoot.querySelector<RationForm>("ration-form")!.renderRoot;
const editForm = (el: CustomizeView) =>
  sheet(el).renderRoot.querySelector<RationForm>("ration-form")!;

const rows = (el: CustomizeView) =>
  list(el)?.renderRoot.querySelectorAll(".item").length ?? 0;

const rowButton = (el: CustomizeView, label: string) =>
  list(el).renderRoot.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;

const dialogButton = (el: CustomizeView, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".customize-view__button")].find(
    (button) => button.textContent?.includes(label),
  )!;

/**
 * Types into an `app-input` found by `name` — a property, not a reflected
 * attribute, so it is filtered on rather than selected.
 */
const typeInto = async (root: ParentNode, name: string, value: string) => {
  const field = [...root.querySelectorAll<AppInput>("app-input")].find(
    (input) => input.name === name,
  )!;
  const input = field.renderRoot.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(field);
};

const pickMonth = async (el: CustomizeView, name: string, month: string) => {
  const field = [...addForm(el).querySelectorAll<AppSelect>("app-select")].find(
    (select) => select.name === name,
  )!;
  const select = field.renderRoot.querySelector("select")!;
  select.value = month;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settled(field);
};

const pickUnit = async (el: CustomizeView, unit: string) => {
  const field = addForm(el).querySelector("app-unit-select")!;
  field.renderRoot
    .querySelector<HTMLInputElement>(`input[value="${unit}"]`)!
    .click();
  await settled(field);
};

/** Lets the async submit handler and the live query both run. */
const flush = async (el: CustomizeView) => {
  await settled(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settled(el);
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("customize-view › ration", () => {
  it("adds a product with its period at the end of the plan, then clears the form", async () => {
    await db.rationItems.add(makeRation({ id: "ration-a", label: "Sel" }));
    const el = await mount();
    await waitFor(el, () => rows(el) === 1);

    const root = addForm(el);
    await typeInto(root, "label", "Huile de lin");
    await typeInto(root, "quantity", "40");
    await pickUnit(el, "mL");
    await pickMonth(el, "seasonFrom", "10");
    await pickMonth(el, "seasonTo", "4");
    root.querySelector("form")!.requestSubmit();
    await flush(el);

    await waitFor(el, () => rows(el) === 2);
    expect(list(el).renderRoot.textContent).toContain("Oct. → Avr.");

    const plan = await rationsRepo.listByHorse(HORSE_ID);
    expect(plan[1]).toMatchObject({
      label: "Huile de lin",
      quantity: 40,
      unit: "mL",
      season: { from: 10, to: 4 },
      sortOrder: 1,
    });

    const label = [...root.querySelectorAll<AppInput>("app-input")].find(
      (input) => input.name === "label",
    )!;
    await settled(label);
    expect(label.value).toBe("");
  });

  it("shows the errors and writes nothing when the form is incomplete", async () => {
    await db.rationItems.add(makeRation({ id: "ration-a", label: "Sel" }));
    const el = await mount();
    // The list having loaded means the active horse has too — the add handler
    // has nothing to write against before that.
    await waitFor(el, () => rows(el) === 1);
    await flush(el);

    addForm(el).querySelector("form")!.requestSubmit();
    await flush(el);

    expect(await db.rationItems.count()).toBe(1);
    expect(tab(el).errors.label).toBeTruthy();
    expect(tab(el).errors.quantity).toBeTruthy();
    expect(tab(el).errors.unit).toBeTruthy();
  });

  it("the pencil opens the sheet prefilled with that line, and saving writes only it", async () => {
    await db.rationItems.bulkAdd([
      makeRation({
        id: "ration-a",
        label: "Fib & Fib",
        quantity: 1.5,
        sortOrder: 0,
      }),
      makeRation({
        id: "ration-b",
        label: "Huile de lin",
        quantity: 0.1,
        unit: "L",
        season: DEFAULT_SEASON,
        sortOrder: 1,
      }),
    ]);
    const el = await mount();
    await waitFor(el, () => rows(el) === 2);

    rowButton(el, "Modifier Huile de lin").click();
    await settled(el);
    await settled(sheet(el));
    expect(sheet(el).open).toBe(true);

    const form = editForm(el);
    await settled(form);
    const field = (name: string) =>
      [
        ...form.renderRoot.querySelectorAll<AppInput | AppSelect>(
          "app-input, app-select",
        ),
      ].find((input) => input.name === name)!;
    expect(field("label").value).toBe("Huile de lin");
    expect(field("quantity").value).toBe("0,1");
    expect(field("seasonFrom").value).toBe(String(DEFAULT_SEASON.from));
    expect(field("seasonTo").value).toBe(String(DEFAULT_SEASON.to));

    await typeInto(form.renderRoot, "quantity", "0,2");
    form.requestSubmit();
    await flush(el);

    const a = await db.rationItems.get("ration-a");
    const b = await db.rationItems.get("ration-b");
    expect(b?.quantity).toBe(0.2);
    expect(b?.label).toBe("Huile de lin");
    expect(a?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(sheet(el).open).toBe(false);
  });

  it("the bin asks first: Annuler keeps the line, Supprimer removes it", async () => {
    await db.rationItems.add(makeRation({ id: "ration-a", label: "Sel" }));
    const el = await mount();
    await waitFor(el, () => rows(el) === 1);

    rowButton(el, "Supprimer Sel").click();
    await settled(el);
    dialogButton(el, "Annuler").click();
    await flush(el);
    expect((await db.rationItems.get("ration-a"))?.deletedAt).toBeNull();

    rowButton(el, "Supprimer Sel").click();
    await settled(el);
    dialogButton(el, "Supprimer").click();
    await flush(el);

    await waitFor(el, () => rows(el) === 0);
    expect((await db.rationItems.get("ration-a"))?.deletedAt).not.toBeNull();
  });
});

describe("customize-view › cheval", () => {
  const card = (el: CustomizeView) =>
    el.querySelector<CustomizeHorse>("customize-horse")!;
  const control = <T extends HTMLElement>(el: CustomizeView, id: string) =>
    card(el).renderRoot.querySelector<T>(`#${id}`)!;

  it("prefills the card, shows the age, and saves an edit", async () => {
    await db.horses.update(HORSE_ID, {
      breed: "Selle Français",
      sireNumber: "2139236F",
    });
    const el = await mount("cheval");
    await waitFor(
      el,
      () =>
        control<HTMLInputElement>(el, "horse-breed")?.value ===
        "Selle Français",
    );

    expect(control<HTMLSelectElement>(el, "horse-sex").value).toBe("jument");
    expect(control<HTMLInputElement>(el, "horse-sireNumber").value).toBe(
      "2139236F",
    );
    expect(
      card(el).renderRoot.querySelector(".item__age")?.textContent,
    ).toMatch(/\d+ ans?/);

    control<HTMLInputElement>(el, "horse-coat").value = "Bai cerise";
    card(el).renderRoot.querySelector("form")!.requestSubmit();
    await flush(el);

    await waitFor(el, () => card(el).status === "Modifications enregistrées.");
    expect((await db.horses.get(HORSE_ID))?.coat).toBe("Bai cerise");
  });
});

describe("customize-view › categories", () => {
  const switches = (el: CustomizeView) => [
    ...(el
      .querySelector<CustomizeCategories>("customize-categories")
      ?.renderRoot.querySelectorAll<AppSwitch>("app-switch") ?? []),
  ];

  it("lists every category, children included, and switching one off writes it", async () => {
    const el = await mount("categories");
    await waitFor(el, () => switches(el).length === 14);

    // Flat: a child sits in the list like any other row.
    const labels = switches(el).map((one) => one.label);
    expect(labels).toContain("Soins");
    expect(labels).toContain("Massage");
    expect(switches(el).every((one) => one.checked)).toBe(true);

    const veto = switches(el).find((one) => one.label === "Vétérinaire")!;
    veto.renderRoot.querySelector<HTMLInputElement>("input")!.click();

    await waitFor(
      el,
      () =>
        switches(el).find((one) => one.label === "Vétérinaire")?.checked ===
        false,
    );
    expect(
      (await db.categories.where("key").equals("veto").first())?.enabled,
    ).toBe(false);
  });
});
