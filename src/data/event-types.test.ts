import { describe, expect, it } from "vitest";
import {
  BUILT_IN_EVENT_TYPE_ROWS,
  makeEvent,
  makeEventType,
} from "./__tests__/factories.ts";
import { addDays, todayISO } from "./dates.ts";
import {
  BUILT_IN_EVENT_TYPES,
  canBeParentOf,
  childrenOf,
  fieldById,
  fieldWithRole,
  isAppointmentType,
  quantityField,
  resolveCatalogue,
  rootOf,
  rootsOf,
  subtreeKeys,
  upcomingAppointments,
} from "./event-types.ts";

/**
 * Pure functions over the event-type catalogue — the shape `budget.test.ts`
 * and `events.test.ts` already use for their own pure functions: no database,
 * fixtures built straight from the factories.
 */

const TYPES = BUILT_IN_EVENT_TYPE_ROWS;

/**
 * Pins the exact `CustomFieldDef` shape the generic `input*Field`/`comboBoxField`
 * constructors produce for a couple of representative built-ins — a
 * regression net on the constructors themselves, not on `BUILT_IN_EVENT_TYPES`
 * (which the rest of the suite, `field-order.test.ts` and
 * `backup/snapshot.test.ts` already exercise thoroughly).
 */
describe("the generic field constructors reproduce the old fixed shapes", () => {
  it("Vétérinaire's fields — text, date, money, checkbox+reveals", () => {
    const veto = BUILT_IN_EVENT_TYPES.find((type) => type.key === "veto")!;
    expect(veto.fields).toEqual([
      { id: "title", control: "text", label: "Nom", required: true },
      { id: "date", control: "date", label: "Date", required: true },
      {
        id: "counterparty",
        control: "text",
        label: "Practicien",
        required: false,
        defaultValue: "Dr. Orange",
      },
      {
        id: "amountCents",
        control: "money",
        label: "Budget",
        suffix: "€",
        required: false,
      },
      {
        id: "followUp",
        control: "checkbox",
        label: "Planifier un rendez-vous",
        required: false,
        role: "followUp",
        reveals: [
          {
            id: "followUp-interval",
            control: "select",
            label: "Prochain rendez-vous à planifier",
            required: true,
            options: [
              { value: "3w", label: "3 semaines" },
              { value: "6w", label: "6 semaines" },
              { value: "7w", label: "7 semaines" },
              { value: "8w", label: "8 semaines" },
              { value: "3m", label: "3 mois" },
              { value: "6m", label: "6 mois" },
              { value: "12m", label: "1 an" },
            ],
          },
        ],
      },
      { id: "notes", control: "text", label: "Note", required: false },
    ]);
  });

  it("quantityField — number with a unit list", () => {
    expect(quantityField()).toEqual({
      id: "quantity",
      control: "number",
      label: "Quantité du produit",
      required: false,
      units: ["mL", "kg", "L"],
    });
  });

  it("Travail's activity field — combobox with role and suggestions", () => {
    const travail = BUILT_IN_EVENT_TYPES.find(
      (type) => type.key === "travail",
    )!;
    expect(
      travail.fields.find((field) => field.role === "workActivity"),
    ).toEqual({
      id: "activity",
      control: "combobox",
      label: "Nom",
      required: true,
      role: "workActivity",
      suggestions: "activities",
    });
  });
});

describe("fieldWithRole", () => {
  it("finds the one field of a kind a type has", () => {
    const veto = TYPES.find((type) => type.key === "veto")!;
    expect(fieldWithRole(veto, "followUp")?.id).toBe("followUp");
  });

  it("is undefined for a kind the type has no field of", () => {
    const cours = TYPES.find((type) => type.key === "cours")!;
    expect(fieldWithRole(cours, "followUp")).toBeUndefined();
  });
});

describe("fieldById", () => {
  it("finds the field with that id", () => {
    const veto = TYPES.find((type) => type.key === "veto")!;
    expect(fieldById(veto, "counterparty")?.label).toBe("Practicien");
  });

  it("is undefined when the type has no field with that id", () => {
    const cours = TYPES.find((type) => type.key === "cours")!;
    expect(fieldById(cours, "counterparty")).toBeUndefined();
  });

  it("still resolves the right field once a type carries two of the same kind", () => {
    // The scenario `fieldWithRole` cannot handle: a future field-builder UI
    // could add a second `text` field to a type. `fieldById` must still find
    // "counterparty" specifically, not whichever `text` field comes first.
    const type = makeEventType({
      fields: [
        { id: "other", control: "text", label: "Autre", required: false },
        {
          id: "counterparty",
          control: "text",
          label: "Practicien",
          required: false,
        },
      ],
    });

    expect(fieldById(type, "counterparty")?.label).toBe("Practicien");
  });
});

describe("isAppointmentType", () => {
  it("is true for a type flagged isAppointment", () => {
    expect(isAppointmentType(TYPES, "veto")).toBe(true);
  });

  it("is false for a type not flagged isAppointment", () => {
    expect(isAppointmentType(TYPES, "achat")).toBe(false);
  });

  it("is false for a key not in the list — an empty catalogue tick", () => {
    expect(isAppointmentType([], "veto")).toBe(false);
  });
});

describe("upcomingAppointments", () => {
  const today = todayISO();

  it("keeps only types you take an appointment for", () => {
    // The dashboard's list is "Rendez-vous à venir", not "everything ahead":
    // a planned purchase or lesson is logged, not booked.
    const events = [
      makeEvent({ id: "veto", date: addDays(today, 1), type: "veto" }),
      makeEvent({ id: "achat", date: addDays(today, 2), type: "achat" }),
      makeEvent({ id: "cours", date: addDays(today, 3), type: "cours" }),
      makeEvent({ id: "travail", date: addDays(today, 4), type: "travail" }),
      makeEvent({ id: "marechal", date: addDays(today, 5), type: "marechal" }),
    ];

    expect(
      upcomingAppointments(events, TYPES).map((event) => event.id),
    ).toEqual(["veto", "marechal"]);
  });

  it("applies the limit after filtering, not before", () => {
    // A non-appointment type sitting first must not consume one of the
    // limit's slots — the dashboard would then show fewer appointments than
    // it asked for.
    const events = [
      makeEvent({ id: "achat", date: addDays(today, 1), type: "achat" }),
      makeEvent({ id: "a", date: addDays(today, 2), type: "veto" }),
      makeEvent({ id: "b", date: addDays(today, 3), type: "marechal" }),
    ];

    expect(
      upcomingAppointments(events, TYPES, 1).map((event) => event.id),
    ).toEqual(["a"]);
  });

  it("returns nothing for no events", () => {
    expect(upcomingAppointments([], TYPES)).toEqual([]);
  });

  it("keeps nothing before the type catalogue has loaded", () => {
    // The tick before `eventTypesRepo.listAll()`'s `LiveQuery` settles —
    // `HomeView` passes `[]`, and every event must be filtered out rather
    // than shown against a catalogue that has no `isAppointment` flags yet.
    const events = [makeEvent({ id: "veto", date: today, type: "veto" })];

    expect(upcomingAppointments(events, [])).toEqual([]);
  });
});

/**
 * The hierarchy helpers. Fixtures are hand-built rather than taken from
 * `BUILT_IN_EVENT_TYPE_ROWS`, which nests only `cures` and `traitement` and
 * would make every case below depend on that one shape — these want a parent
 * with a child that keeps its own icon and one that keeps nothing.
 */
describe("the type hierarchy", () => {
  const parent = makeEventType({
    id: "p",
    key: "soins",
    label: "Soins",
    icon: "firstAidKit",
    theme: "pink",
    order: 0,
  });

  /** A child the way `setParent` writes one: theme cleared, own icon kept. */
  const child = makeEventType({
    id: "c",
    key: "veto",
    label: "Vétérinaire",
    parentId: "p",
    icon: "pawPrint",
    theme: null,
    order: 1,
  });

  /** A child that inherits both halves of its presentation. */
  const bare = makeEventType({
    id: "b",
    key: "dentiste",
    label: "Dentiste",
    parentId: "p",
    icon: null,
    theme: null,
    order: 2,
  });

  describe("resolveCatalogue", () => {
    it("gives a child its parent's theme", () => {
      const [, resolved] = resolveCatalogue([parent, child]);
      expect(resolved?.theme).toBe("pink");
    });

    it("keeps a child's own icon — it is what tells it from its siblings", () => {
      const [, resolved] = resolveCatalogue([parent, child]);
      expect(resolved?.icon).toBe("pawPrint");
    });

    it("gives a child with no icon of its own its parent's", () => {
      const [, resolved] = resolveCatalogue([parent, bare]);
      expect(resolved?.icon).toBe("firstAidKit");
    });

    it("leaves a root's own presentation alone", () => {
      const [resolved] = resolveCatalogue([parent, child]);
      expect(resolved).toMatchObject({ icon: "firstAidKit", theme: "pink" });
    });

    it("treats a child whose parent is not in the list as a root", () => {
      // The parent was soft-deleted on another device, or a partial merge
      // brought the child over alone. Rendering it as a root is what keeps it
      // visible instead of dropping it.
      const [resolved] = resolveCatalogue([child]);
      expect(resolved?.parentId).toBeNull();
      expect(resolved?.icon).toBe("pawPrint");
    });

    it("falls back to the defaults for a root carrying no presentation", () => {
      const orphan = makeEventType({ id: "o", icon: null, theme: null });
      const [resolved] = resolveCatalogue([orphan]);
      expect(resolved).toMatchObject({ icon: "info", theme: "taupe" });
    });

    it("falls back for a theme this build cannot draw", () => {
      // What a backup file written by a build with more themes restores as —
      // `assertSnapshot` checks `id` and `updatedAt` and nothing else, and
      // `THEME_META[key]` is a mapped type, so this used to be a TypeError at
      // render rather than a missing colour.
      const alien = makeEventType({
        id: "a",
        theme: "octarine" as never,
        icon: "trophy" as never,
      });
      const [resolved] = resolveCatalogue([alien]);
      expect(resolved).toMatchObject({ icon: "info", theme: "taupe" });
    });
  });

  describe("rootsOf / childrenOf / rootOf", () => {
    const catalogue = [parent, child, bare];

    it("keeps only the parentless, in order", () => {
      expect(rootsOf(catalogue).map((type) => type.id)).toEqual(["p"]);
    });

    it("counts a dangling child as a root, the same way resolveCatalogue does", () => {
      expect(rootsOf([child]).map((type) => type.id)).toEqual(["c"]);
    });

    it("lists a parent's children in their own order", () => {
      expect(childrenOf(catalogue, "p").map((type) => type.id)).toEqual([
        "c",
        "b",
      ]);
    });

    it("has no children for a leaf", () => {
      expect(childrenOf(catalogue, "c")).toEqual([]);
    });

    it("walks a child up to its root", () => {
      expect(rootOf(catalogue, child).id).toBe("p");
    });

    it("answers a root with itself", () => {
      expect(rootOf(catalogue, parent).id).toBe("p");
    });
  });

  describe("subtreeKeys", () => {
    const catalogue = [parent, child, bare];

    it("covers a root and its children", () => {
      expect([...subtreeKeys(catalogue, "soins")].sort()).toEqual([
        "dentiste",
        "soins",
        "veto",
      ]);
    });

    it("is the key alone for a leaf — today's flat filter", () => {
      expect([...subtreeKeys(catalogue, "veto")]).toEqual(["veto"]);
    });

    it("is the key alone for a type the catalogue does not have", () => {
      expect([...subtreeKeys(catalogue, "gone")]).toEqual(["gone"]);
    });
  });

  describe("canBeParentOf", () => {
    const catalogue = [parent, child, bare];
    const other = makeEventType({ id: "x", key: "cours", order: 3 });

    it("allows a root under another root", () => {
      expect(canBeParentOf([parent, other], "x", "p")).toBe(true);
    });

    it("refuses a type as its own parent", () => {
      expect(canBeParentOf(catalogue, "p", "p")).toBe(false);
    });

    it("refuses a parent that is itself a child — that would be three deep", () => {
      expect(canBeParentOf([...catalogue, other], "x", "c")).toBe(false);
    });

    it("refuses giving a parent to a type that already has children", () => {
      expect(canBeParentOf([...catalogue, other], "p", "x")).toBe(false);
    });

    it("refuses a parent the catalogue does not have", () => {
      expect(canBeParentOf(catalogue, "c", "gone")).toBe(false);
    });

    it("refuses a child the catalogue does not have", () => {
      expect(canBeParentOf(catalogue, "gone", "p")).toBe(false);
    });
  });
});
