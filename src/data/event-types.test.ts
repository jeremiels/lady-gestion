import { describe, expect, it } from "vitest";
import {
  BUILT_IN_EVENT_TYPE_ROWS,
  makeEvent,
  makeEventType,
} from "./__tests__/factories.ts";
import { addDays, todayISO } from "./dates.ts";
import {
  fieldById,
  fieldOfKind,
  isAppointmentType,
  upcomingAppointments,
} from "./event-types.ts";

/**
 * Pure functions over the event-type catalogue — the shape `budget.test.ts`
 * and `events.test.ts` already use for their own pure functions: no database,
 * fixtures built straight from the factories.
 */

const TYPES = BUILT_IN_EVENT_TYPE_ROWS;

describe("fieldOfKind", () => {
  it("finds the one field of a kind a type has", () => {
    const veto = TYPES.find((type) => type.key === "veto")!;
    expect(fieldOfKind(veto, "followUp")?.id).toBe("followUp");
  });

  it("is undefined for a kind the type has no field of", () => {
    const cours = TYPES.find((type) => type.key === "cours")!;
    expect(fieldOfKind(cours, "followUp")).toBeUndefined();
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
    // The scenario `fieldOfKind` cannot handle: a future field-builder UI
    // could add a second `text` field to a type. `fieldById` must still find
    // "counterparty" specifically, not whichever `text` field comes first.
    const type = makeEventType({
      fields: [
        { id: "other", kind: "text", label: "Autre", required: false },
        {
          id: "counterparty",
          kind: "text",
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
