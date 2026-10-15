import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../data/__tests__/factories.ts";
import { addField, newCategoryDraft } from "../../data/category-editor.ts";
import type { CustomFieldDef } from "../../data/types.ts";
import type { AppInput } from "../app-input/app-input.ts";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./field-sheet.ts";
import type { FieldChangeDetail, FieldSheet } from "./field-sheet.ts";

beforeEach(resetDb);

const FIELDS = addField(newCategoryDraft().fields, "money").fields;
const MONEY = FIELDS.find((field) => field.control === "money")!;

const mount = async (field: CustomFieldDef) => {
  const el = await fixture<FieldSheet>(
    html`<field-sheet
      .open=${true}
      .field=${field}
      .fields=${FIELDS}
    ></field-sheet>`,
  );
  const changes: FieldChangeDetail[] = [];
  el.addEventListener("field-change", (event) =>
    changes.push((event as CustomEvent<FieldChangeDetail>).detail),
  );
  return { el, changes };
};

const typeInto = async (el: FieldSheet, label: string, value: string) => {
  const input = el.renderRoot
    .querySelector<AppInput>(`app-input[label="${label}"]`)!
    .renderRoot.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(el);
};

const submit = async (el: FieldSheet) => {
  el.renderRoot.querySelector("form")!.requestSubmit();
  await settled(el);
};

describe("field-sheet", () => {
  it("stores a default amount in cents, with the field's other answers", async () => {
    const { el, changes } = await mount(MONEY);

    await typeInto(el, "Nom du champ", "Prime");
    await typeInto(el, "Valeur par défaut", "12,5");
    await submit(el);

    const saved = changes[0]?.fields.find((field) => field.id === MONEY.id);
    expect(saved).toMatchObject({
      label: "Prime",
      defaultValue: 1250,
      role: "budget",
    });
  });

  it("refuses a default the form itself would refuse, and says so", async () => {
    const { el, changes } = await mount(MONEY);

    await typeInto(el, "Valeur par défaut", "beaucoup");
    await submit(el);

    expect(changes).toEqual([]);
    const error = el.renderRoot.querySelector<HTMLElement & { error: string }>(
      'app-input[label="Valeur par défaut"]',
    )!.error;
    expect(error).not.toBe("");
  });

  it("offers no way to remove the date", async () => {
    const { el } = await mount(FIELDS.find((field) => field.id === "date")!);

    expect(el.renderRoot.querySelector(".remove")).toBeNull();
  });
});
