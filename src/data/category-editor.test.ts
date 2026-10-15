import { describe, expect, it } from "vitest";
import { BUILT_IN_CATEGORY_ROWS, makeCategory } from "./__tests__/factories.ts";
import { resolveCatalogue } from "./categories.ts";
import {
  FIELD_KINDS,
  FIELD_KIND_KEYS,
  addField,
  applyFieldEdit,
  defaultAsText,
  draftOf,
  hasKind,
  isProtectedField,
  kindLabel,
  linkField,
  moveField,
  newCategoryDraft,
  parseDefaultValue,
  reparent,
  sameData,
  validateCategory,
  withDefault,
} from "./category-editor.ts";
import type { CustomFieldDef } from "./types.ts";

const typeOf = (key: string) =>
  BUILT_IN_CATEGORY_ROWS.find((type) => type.key === key)!;
const ids = (fields: readonly CustomFieldDef[]) =>
  fields.map((field) => field.id);

describe("addField", () => {
  it("goes just above Note, the row a form closes with", () => {
    const { fields } = addField(newCategoryDraft().fields, "text");

    expect(fields.at(-1)?.id).toBe("notes");
    expect(fields.at(-2)?.label).toBe("Texte");
  });

  it("links a first Montant to the budget, and a second one to nothing", () => {
    const once = addField(newCategoryDraft().fields, "money").fields;
    const twice = addField(once, "money").fields;

    expect(twice.filter((field) => field.role === "budget")).toHaveLength(1);
  });

  it("brings Heure de début along with a notification, and hands back the notification", () => {
    const { fields, added } = addField(newCategoryDraft().fields, "reminder");

    expect(ids(fields)).toEqual(["title", "date", "time", "reminder", "notes"]);
    expect(added.id).toBe("reminder");
  });

  it("names every kind it offers back the same way", () => {
    for (const kind of FIELD_KIND_KEYS) {
      const field = FIELD_KINDS[kind].make();
      expect(kindLabel(field), kind).toBe(FIELD_KINDS[kind].label);
      expect(hasKind([field], kind), kind).toBe(true);
    }
  });
});

describe("hasKind", () => {
  it("counts a work session's activity as its Nom", () => {
    expect(hasKind(typeOf("travail").fields, "title")).toBe(true);
  });
});

describe("moveField", () => {
  const fields = newCategoryDraft().fields;

  it("moves a field down and up", () => {
    expect(ids(moveField(fields, 0, 2))).toEqual(["date", "notes", "title"]);
    expect(ids(moveField(fields, 2, 0))).toEqual(["notes", "title", "date"]);
  });

  it("clamps a target past the end", () => {
    expect(ids(moveField(fields, 0, 9))).toEqual(["date", "notes", "title"]);
  });
});

describe("isProtectedField", () => {
  const protectedIds = (key: string) => {
    const type = typeOf(key);
    return ids(type.fields.filter((field) => isProtectedField(type, field)));
  };

  it("keeps the date and Nom in every form", () => {
    expect(protectedIds("veto")).toEqual(["title", "date"]);
  });

  it("keeps what a cure's tab and its notification read", () => {
    expect(protectedIds("cures")).toEqual([
      "title",
      "date",
      "time",
      "endDate",
      "dosage",
    ]);
  });

  it("keeps the activity the week strip draws", () => {
    expect(protectedIds("travail")).toEqual(["date", "activity"]);
  });
});

describe("linkField", () => {
  it("takes the budget from whichever Montant had it", () => {
    const fields = addField(
      addField(newCategoryDraft().fields, "money").fields,
      "money",
    ).fields;
    const [first, second] = fields.filter((field) => field.control === "money");

    const linked = linkField(fields, second!.id, true);

    expect(
      linked.find((field) => field.id === first!.id)?.role,
    ).toBeUndefined();
    expect(linked.find((field) => field.id === second!.id)?.role).toBe(
      "budget",
    );
  });

  it("leaves another kind of link alone", () => {
    const fields = addField(
      addField(newCategoryDraft().fields, "money").fields,
      "text",
    ).fields;
    const text = fields.find(
      (field) =>
        field.control === "text" &&
        field.id !== "title" &&
        field.id !== "notes",
    )!;

    const linked = linkField(fields, text.id, true);

    expect(linked.find((field) => field.control === "money")?.role).toBe(
      "budget",
    );
    expect(linked.find((field) => field.id === text.id)?.role).toBe(
      "counterparty",
    );
  });

  it("unlinks without leaving an empty role behind", () => {
    const { fields } = addField(newCategoryDraft().fields, "money");
    const money = fields.find((field) => field.control === "money")!;

    const unlinked = linkField(fields, money.id, false);

    expect("role" in unlinked.find((field) => field.id === money.id)!).toBe(
      false,
    );
  });
});

describe("parseDefaultValue", () => {
  it("stores a Montant in cents, and shows it back in euros", () => {
    const field = FIELD_KINDS.money.make();
    const parsed = parseDefaultValue(field, { [field.id]: "42,50" });

    expect(parsed).toEqual({ ok: true, value: 4250 });
    expect(defaultAsText(withDefault(field, 4250))).toBe("42,5");
  });

  it("stores a quantity worded, as the form does", () => {
    const field = FIELD_KINDS.quantity.make();
    const parsed = parseDefaultValue(field, {
      [field.id]: "1,5",
      [`${field.id}-unit`]: "L",
    });

    expect(parsed).toEqual({ ok: true, value: "1,5 L" });
  });

  it("refuses an amount without its unit", () => {
    const field = FIELD_KINDS.quantity.make();
    expect(parseDefaultValue(field, { [field.id]: "2" }).ok).toBe(false);
  });

  it("has no default for a blank or an unticked box", () => {
    expect(parseDefaultValue(FIELD_KINDS.text.make(), {})).toEqual({
      ok: true,
      value: undefined,
    });
    const box = FIELD_KINDS.checkbox.make();
    expect(parseDefaultValue(box, { [box.id]: "on" })).toEqual({
      ok: true,
      value: true,
    });
  });

  it("refuses a choice the list does not offer", () => {
    const field = {
      ...FIELD_KINDS.select.make(),
      options: [{ value: "a", label: "A" }],
    };
    expect(parseDefaultValue(field, { [field.id]: "b" }).ok).toBe(false);
  });

  it("removes the key rather than storing undefined", () => {
    const field = withDefault(FIELD_KINDS.text.make(), "x");
    expect("defaultValue" in withDefault(field, undefined)).toBe(false);
  });
});

describe("validateCategory", () => {
  const catalogue = BUILT_IN_CATEGORY_ROWS;

  it("asks a new root for a name, an icon and a colour", () => {
    expect(
      Object.keys(validateCategory(newCategoryDraft(), catalogue, null)).sort(),
    ).toEqual(["icon", "label", "theme"]);
  });

  it("refuses a name another category has, ignoring case and accents", () => {
    const draft = { ...newCategoryDraft(), label: "veterinaire" };
    expect(validateCategory(draft, catalogue, null).label).toBeDefined();
  });

  it("lets a category keep its own name", () => {
    const veto = typeOf("veto");
    expect(validateCategory(draftOf(veto), catalogue, veto.id)).toEqual({});
  });

  it("files a child under a root only", () => {
    const underRoot = {
      ...newCategoryDraft(),
      label: "Assurance",
      parentId: typeOf("veto").id,
    };
    const underChild = { ...underRoot, parentId: typeOf("cures").id };

    expect(validateCategory(underRoot, catalogue, null)).toEqual({});
    expect(
      validateCategory(underChild, catalogue, null).parentId,
    ).toBeDefined();
  });

  it("will not give a parent to a category that has children", () => {
    const veto = typeOf("veto");
    const draft = { ...draftOf(veto), parentId: typeOf("achat").id };
    expect(validateCategory(draft, catalogue, veto.id).parentId).toBeDefined();
  });

  it("asks a list for at least one choice, each named once", () => {
    const select = FIELD_KINDS.select.make();
    const twice = {
      ...select,
      options: [
        { value: "a", label: "Oui" },
        { value: "b", label: "oui" },
      ],
    };
    const draft = (field: CustomFieldDef) => ({
      ...draftOf(typeOf("pension")),
      fields: [...typeOf("pension").fields, field],
    });

    expect(
      validateCategory(draft(select), catalogue, typeOf("pension").id)[
        `field:${select.id}`
      ],
    ).toBeDefined();
    expect(
      validateCategory(draft(twice), catalogue, typeOf("pension").id)[
        `field:${select.id}`
      ],
    ).toBeDefined();
  });

  it("refuses two fields in one role", () => {
    const pension = typeOf("pension");
    const extra = { ...FIELD_KINDS.money.make(), role: "budget" as const };
    const draft = { ...draftOf(pension), fields: [...pension.fields, extra] };

    expect(
      validateCategory(draft, catalogue, pension.id)[`field:${extra.id}`],
    ).toBeDefined();
  });
});

describe("applyFieldEdit", () => {
  const edit = { label: "Robe", required: false, defaults: {}, linked: false };

  it("refuses a choice named twice, as saving the category would", () => {
    const field = FIELD_KINDS.select.make();

    const result = applyFieldEdit([field], field, {
      ...edit,
      options: [
        { value: null, label: "Bai" },
        { value: null, label: "bai " },
      ],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.options).toBeTruthy();
  });

  it("values a new choice by its label, and keeps an old one's value", () => {
    const field = FIELD_KINDS.select.make();

    const result = applyFieldEdit([field], field, {
      ...edit,
      options: [
        { value: "bai", label: "Bai brun" },
        { value: null, label: " Alezan " },
        { value: null, label: " " },
      ],
    });

    expect(result.ok && result.fields[0]?.options).toEqual([
      { value: "bai", label: "Bai brun" },
      { value: "Alezan", label: "Alezan" },
    ]);
  });
});

describe("reparent", () => {
  const catalogue = resolveCatalogue(BUILT_IN_CATEGORY_ROWS);
  const veto = catalogue.find((type) => type.key === "veto")!;

  it("drops a child's own colour — it takes its parent's — and keeps its icon", () => {
    const draft = {
      ...newCategoryDraft(),
      icon: "pawPrint" as const,
      theme: "gold" as const,
    };

    expect(reparent(draft, veto.id, catalogue)).toMatchObject({
      parentId: veto.id,
      icon: "pawPrint",
      theme: null,
    });
  });

  it("keeps the look it was inheriting when it is a root again", () => {
    const child = { ...newCategoryDraft(), parentId: veto.id };

    expect(reparent(child, null, catalogue)).toMatchObject({
      parentId: null,
      icon: veto.icon,
      theme: veto.theme,
    });
  });
});

describe("draftOf / sameData", () => {
  it("reads a row missing acceptsAttachments as false", () => {
    const row = makeCategory();
    expect(draftOf(row).acceptsAttachments).toBe(false);
  });

  it("is blind to key order", () => {
    expect(
      sameData({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 }),
    ).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
  });
});
