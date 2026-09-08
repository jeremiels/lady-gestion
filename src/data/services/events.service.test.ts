import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_EVENT_TYPE_ROWS,
  HORSE_ID,
  makeEvent,
  resetDb,
} from "../__tests__/factories.ts";
import { addDays, todayISO } from "../dates.ts";
import { db } from "../db.ts";
import * as eventsRepo from "../repositories/events.repo.ts";
import { workSessionByDate, type WorkSession } from "../events.ts";
import type { EventTypeDef } from "../types.ts";
import {
  saveEvent,
  setDayActivity,
  type EventInput,
} from "./events.service.ts";

/**
 * What the entry form is allowed to write, and what it must not.
 *
 * These rules lived in `event-sheet.ts`'s submit handler, where the only way to
 * reach any of them was to drive a real form in a real browser — so what the
 * component suite actually covers is the *display* of a failed submit, and none
 * of this. The interesting cases are all the same shape: a value that is
 * legitimately present in the form but has no business on this event's type,
 * because the user picked another type first or because the sheet was seeded
 * from a record that had one.
 */

beforeEach(resetDb);

/** The real 13 built-ins, resolved by key — the shape `event-sheet.ts` already
 * hands `saveEvent`/`setDayActivity`, so these tests do the same resolution. */
const TYPES = BUILT_IN_EVENT_TYPE_ROWS;
const typeFor = (key: string): EventTypeDef => {
  const type = TYPES.find((candidate) => candidate.key === key);
  if (!type) throw new Error(`No built-in type named "${key}" in fixtures`);
  return type;
};

/** Every field filled in, so each test can state only the one it is about. */
const input = (over: Partial<EventInput> = {}): EventInput => ({
  type: "veto",
  title: "Visite",
  date: "2026-06-15",
  amountCents: 4500,
  notes: null,
  counterparty: "Dr Martin",
  activity: "balade",
  planFollowUp: true,
  followUpInterval: "6w",
  ...over,
});

const create = async (over: Partial<EventInput> = {}) => {
  const merged = input(over);
  const saved = await saveEvent({
    horseId: HORSE_ID,
    type: typeFor(merged.type),
    input: merged,
  });
  return saved!;
};

describe("counterparty field", () => {
  it("writes a care event's counterparty into customFields", async () => {
    const event = await create({ type: "veto" });

    expect(event.customFields.counterparty).toBe("Dr Martin");
  });

  it("writes a purchase's counterparty into the same customFields key", async () => {
    const event = await create({ type: "achat" });

    expect(event.customFields.counterparty).toBe("Dr Martin");
  });

  it("drops it entirely on a type that asks for neither", async () => {
    // `cours` and `pension` draw no counterparty field at all, so a value here
    // can only be one the user typed under a different type.
    const event = await create({ type: "cours" });

    expect(event.customFields.counterparty).toBeUndefined();
  });

  it("follows the type being saved, not the one the record had", async () => {
    // Retyping a purchase as a vet visit has to keep the value, or the detail
    // view — which reads `customFields` off the record's own type — shows an
    // empty row over data that is still there.
    const purchase = await create({ type: "achat", counterparty: "Horze" });
    const edited = await saveEvent({
      horseId: HORSE_ID,
      existing: purchase,
      type: typeFor("veto"),
      input: input({ type: "veto", counterparty: "Horze" }),
    });

    expect(edited?.customFields.counterparty).toBe("Horze");
  });
});

describe("follow-up interval", () => {
  it("records it, encoded, on a care event that asked for one", async () => {
    const event = await create({ type: "marechal" });

    expect(event.customFields.followUp).toBe("6w");
  });

  it("drops it entirely on a type with no follow-up field, ticked or not", async () => {
    // The sheet seeds `planFollowUp` from the record being edited, so a care
    // event retyped as a purchase arrives here still ticked.
    const event = await create({ type: "achat", planFollowUp: true });

    expect(event.customFields.followUp).toBeUndefined();
  });

  it("is null, not dropped, when the box is unticked on a type that has the field", async () => {
    const event = await create({ type: "veto", planFollowUp: false });

    expect(event.customFields.followUp).toBeNull();
  });

  it("is null rather than a guess when the encoding is unrecognised", async () => {
    const event = await create({ type: "veto", followUpInterval: "six-weeks" });

    expect(event.customFields.followUp).toBeNull();
  });
});

describe("activity", () => {
  it("is kept on a travail session", async () => {
    const event = await create({ type: "travail", activity: "longe" });

    expect(event.customFields.activity).toBe("longe");
  });

  it("is dropped on every other type", async () => {
    const event = await create({ type: "veto", activity: "longe" });

    expect(event.customFields.activity).toBeUndefined();
  });
});

describe("travail title", () => {
  // The sheet's Nom field on this layout is the Activité combobox
  // (`#renderActivity` in `event-sheet.ts`), not a text field of its own, so
  // whatever `title` the form happened to submit must not reach the record —
  // only what the combobox held should.

  it("mirrors a built-in activity's label, not the submitted title", async () => {
    const event = await create({
      type: "travail",
      activity: "longe",
      title: "peu importe",
    });

    expect(event.title).toBe("Longe");
  });

  it("mirrors a custom activity verbatim", async () => {
    const event = await create({
      type: "travail",
      activity: "Carrière",
      title: "peu importe",
    });

    expect(event.title).toBe("Carrière");
  });

  it("leaves the submitted title alone on every other layout", async () => {
    const event = await create({ type: "veto", title: "Visite annuelle" });

    expect(event.title).toBe("Visite annuelle");
  });
});

describe("amount", () => {
  it("drops it on the work layout, which has no Budget field", async () => {
    const event = await create({
      type: "travail",
      activity: "longe",
      amountCents: 4500,
    });

    expect(event.customFields.amountCents).toBeUndefined();
  });

  it("keeps it on every other layout", async () => {
    const event = await create({ type: "veto", amountCents: 4500 });

    expect(event.customFields.amountCents).toBe(4500);
  });

  it("clears a budget entered before a travail event was retyped from another type", async () => {
    // Same reasoning as the counterparty and activity fields above: an edit
    // must not carry over a value the current type has nowhere to show.
    const purchase = await create({ type: "achat", amountCents: 4500 });

    const edited = await saveEvent({
      horseId: HORSE_ID,
      existing: purchase,
      type: typeFor("travail"),
      input: input({ type: "travail", activity: "longe", amountCents: 4500 }),
    });

    expect(edited?.customFields.amountCents).toBeUndefined();
  });
});

describe("status", () => {
  it("is planned for a future date and done for today", async () => {
    const future = await create({ date: addDays(todayISO(), 1) });
    const today = await create({ date: todayISO() });

    expect(future.status).toBe("planned");
    expect(today.status).toBe("done");
  });

  it("leaves a cancelled event cancelled", async () => {
    // Re-deriving would bring it back to life on any edit that touches nothing
    // else — the form has no status control to put it back with.
    await db.events.add(
      makeEvent({ id: "off", status: "cancelled", date: "2026-06-15" }),
    );
    const existing = (await eventsRepo.get("off"))!;

    const edited = await saveEvent({
      horseId: HORSE_ID,
      existing,
      type: typeFor("veto"),
      input: input({ title: "Reporté" }),
    });

    expect(edited?.status).toBe("cancelled");
    expect(edited?.title).toBe("Reporté");
  });
});

describe("editing", () => {
  it("keeps the fields no type can show", async () => {
    // Nothing in the sheet draws a time, a location or a recurrence, so an edit
    // must carry them rather than blank them.
    await db.events.add(
      makeEvent({
        id: "kept",
        time: "09:30",
        location: "Écurie du Pré",
        recurrenceId: "monthly-pension",
        currency: "CHF",
      }),
    );
    const existing = (await eventsRepo.get("kept"))!;

    const edited = await saveEvent({
      horseId: HORSE_ID,
      existing,
      type: typeFor("veto"),
      input: input(),
    });

    expect(edited).toMatchObject({
      time: "09:30",
      location: "Écurie du Pré",
      recurrenceId: "monthly-pension",
      currency: "CHF",
    });
  });

  it("updates in place rather than adding a second row", async () => {
    const created = await create();

    await saveEvent({
      horseId: HORSE_ID,
      existing: created,
      type: typeFor("veto"),
      input: input({ title: "Rappel" }),
    });

    const events = await eventsRepo.listByHorse(HORSE_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: created.id, title: "Rappel" });
  });

  it("cannot move an event to another horse", async () => {
    const created = await create();

    const edited = await saveEvent({
      horseId: "horse-2",
      existing: created,
      type: typeFor("veto"),
      input: input(),
    });

    expect(edited?.horseId).toBe(HORSE_ID);
  });

  it("reports a record deleted underneath it rather than resurrecting it", async () => {
    const created = await create();
    await eventsRepo.remove(created.id);

    expect(
      await saveEvent({
        horseId: HORSE_ID,
        existing: created,
        type: typeFor("veto"),
        input: input(),
      }),
    ).toBeUndefined();
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
  });
});

describe("creating", () => {
  it("defaults the fields no type can show", async () => {
    const event = await create();

    expect(event).toMatchObject({
      horseId: HORSE_ID,
      time: null,
      location: null,
      recurrenceId: null,
      currency: "EUR",
    });
  });
});

describe("setDayActivity", () => {
  const TRAVAIL = typeFor("travail");

  /** The row the week strip would hand over, resolved the way the strip does. */
  const sessionOn = async (date: string): Promise<WorkSession | null> =>
    workSessionByDate(await eventsRepo.listByHorse(HORSE_ID), TYPES).get(
      date,
    ) ?? null;

  it("creates a session titled after the activity", async () => {
    const event = await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "longe",
    });

    expect(event).toMatchObject({
      type: "travail",
      title: "Longe",
      date: "2026-06-15",
      customFields: { activity: "longe" },
    });
    expect(event?.customFields.amountCents).toBeUndefined();
  });

  it("titles a user’s own activity with the label it stores", async () => {
    const event = await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "Carrière",
    });

    expect(event).toMatchObject({
      title: "Carrière",
      customFields: { activity: "Carrière" },
    });
  });

  it("derives status from the date, like every other entry point", async () => {
    const past = await setDayActivity({
      horseId: HORSE_ID,
      date: "2020-01-01",
      type: TRAVAIL,
      activity: "plat",
    });
    const future = await setDayActivity({
      horseId: HORSE_ID,
      date: addDays(todayISO(), 3),
      type: TRAVAIL,
      activity: "plat",
    });

    expect(past?.status).toBe("done");
    expect(future?.status).toBe("planned");
  });

  it("replaces the day’s activity instead of adding a second session", async () => {
    await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "longe",
    });
    const existing = await sessionOn("2026-06-15");

    await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "tap",
      existing,
    });

    const rows = await eventsRepo.listByHorse(HORSE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "TAP",
      customFields: { activity: "tap" },
    });
  });

  it("keeps a title the user wrote themselves", async () => {
    // Renamed in the event sheet: the tap changes what was done, not what the
    // user chose to call it.
    await db.events.add(
      makeEvent({
        id: "renamed",
        type: "travail",
        date: "2026-06-15",
        customFields: { activity: "longe" },
        title: "Séance dressage",
      }),
    );

    await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "tap",
      existing: await sessionOn("2026-06-15"),
    });

    expect(await eventsRepo.get("renamed")).toMatchObject({
      customFields: { activity: "tap" },
      title: "Séance dressage",
    });
  });

  it("leaves a cancelled session alone and records the work beside it", async () => {
    // A cancelled row is not the day's session, so the strip never offers it as
    // `existing` — and the horse did work after all.
    await db.events.add(
      makeEvent({
        id: "cancelled",
        type: "travail",
        date: "2026-06-15",
        customFields: { activity: "longe" },
        status: "cancelled",
      }),
    );

    await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "tap",
      existing: await sessionOn("2026-06-15"),
    });

    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(2);
    expect(await eventsRepo.get("cancelled")).toMatchObject({
      status: "cancelled",
      customFields: { activity: "longe" },
    });
  });

  it("does not resurrect a session deleted since the week was read", async () => {
    await setDayActivity({
      horseId: HORSE_ID,
      date: "2026-06-15",
      type: TRAVAIL,
      activity: "longe",
    });
    const existing = await sessionOn("2026-06-15");
    await eventsRepo.remove(existing!.id);

    expect(
      await setDayActivity({
        horseId: HORSE_ID,
        date: "2026-06-15",
        type: TRAVAIL,
        activity: "tap",
        existing,
      }),
    ).toBeUndefined();
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
  });
});
