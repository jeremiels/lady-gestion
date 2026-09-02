import { beforeEach, describe, expect, it } from 'vitest';
import { HORSE_ID, makeEvent, resetDb } from '../__tests__/factories.ts';
import { addDays, todayISO } from '../dates.ts';
import { db } from '../db.ts';
import * as eventsRepo from '../repositories/events.repo.ts';
import { saveEvent, type EventInput } from './events.service.ts';

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

/** Every field filled in, so each test can state only the one it is about. */
const input = (over: Partial<EventInput> = {}): EventInput => ({
  type: 'veto',
  title: 'Visite',
  date: '2026-06-15',
  amountCents: 4500,
  notes: null,
  counterparty: 'Dr Martin',
  activity: 'balade',
  planFollowUp: true,
  followUpInterval: '6w',
  ...over,
});

const create = async (over: Partial<EventInput> = {}) => {
  const saved = await saveEvent({ horseId: HORSE_ID, input: input(over) });
  return saved!;
};

describe('counterparty column', () => {
  it('writes a care event’s counterparty to providerName', async () => {
    const event = await create({ type: 'veto' });

    expect(event.providerName).toBe('Dr Martin');
    expect(event.vendor).toBeNull();
  });

  it('writes a purchase’s counterparty to vendor', async () => {
    const event = await create({ type: 'achat' });

    expect(event.vendor).toBe('Dr Martin');
    expect(event.providerName).toBeNull();
  });

  it('drops it entirely on a layout that asks for neither', async () => {
    // `cours` and `pension` draw no counterparty field at all, so a value here
    // can only be one the user typed under a different type.
    const event = await create({ type: 'cours' });

    expect(event.providerName).toBeNull();
    expect(event.vendor).toBeNull();
  });

  it('follows the type being saved, not the one the record had', async () => {
    // Retyping a purchase as a vet visit has to move the value across, or the
    // detail view — which reads the column from the record's own type — shows
    // an empty row over data that is still there.
    const purchase = await create({ type: 'achat', counterparty: 'Horze' });
    const edited = await saveEvent({
      horseId: HORSE_ID,
      existing: purchase,
      input: input({ type: 'veto', counterparty: 'Horze' }),
    });

    expect(edited?.providerName).toBe('Horze');
    expect(edited?.vendor).toBeNull();
  });
});

describe('follow-up interval', () => {
  it('records it on a care event that asked for one', async () => {
    const event = await create({ type: 'marechal' });

    expect(event.followUpInterval).toEqual({ amount: 6, unit: 'week' });
  });

  it('drops it on a layout with no follow-up field, ticked or not', async () => {
    // The sheet seeds `planFollowUp` from the record being edited, so a care
    // event retyped as a purchase arrives here still ticked.
    const event = await create({ type: 'achat', planFollowUp: true });

    expect(event.followUpInterval).toBeNull();
  });

  it('drops it when the box is unticked', async () => {
    const event = await create({ type: 'veto', planFollowUp: false });

    expect(event.followUpInterval).toBeNull();
  });

  it('is null rather than a guess when the encoding is unrecognised', async () => {
    const event = await create({ type: 'veto', followUpInterval: 'six-weeks' });

    expect(event.followUpInterval).toBeNull();
  });
});

describe('activity', () => {
  it('is kept on a travail session', async () => {
    const event = await create({ type: 'travail', activity: 'longe' });

    expect(event.activity).toBe('longe');
  });

  it('is dropped on every other type', async () => {
    const event = await create({ type: 'veto', activity: 'longe' });

    expect(event.activity).toBeNull();
  });
});

describe('status', () => {
  it('is planned for a future date and done for today', async () => {
    const future = await create({ date: addDays(todayISO(), 1) });
    const today = await create({ date: todayISO() });

    expect(future.status).toBe('planned');
    expect(today.status).toBe('done');
  });

  it('leaves a cancelled event cancelled', async () => {
    // Re-deriving would bring it back to life on any edit that touches nothing
    // else — the form has no status control to put it back with.
    await db.events.add(makeEvent({ id: 'off', status: 'cancelled', date: '2026-06-15' }));
    const existing = (await eventsRepo.get('off'))!;

    const edited = await saveEvent({ horseId: HORSE_ID, existing, input: input({ title: 'Reporté' }) });

    expect(edited?.status).toBe('cancelled');
    expect(edited?.title).toBe('Reporté');
  });
});

describe('editing', () => {
  it('keeps the fields no layout can show', async () => {
    // Nothing in the sheet draws a time, a location or a recurrence, so an edit
    // must carry them rather than blank them.
    await db.events.add(
      makeEvent({
        id: 'kept',
        time: '09:30',
        location: 'Écurie du Pré',
        recurrenceId: 'monthly-pension',
        currency: 'CHF',
      }),
    );
    const existing = (await eventsRepo.get('kept'))!;

    const edited = await saveEvent({ horseId: HORSE_ID, existing, input: input() });

    expect(edited).toMatchObject({
      time: '09:30',
      location: 'Écurie du Pré',
      recurrenceId: 'monthly-pension',
      currency: 'CHF',
    });
  });

  it('updates in place rather than adding a second row', async () => {
    const created = await create();

    await saveEvent({ horseId: HORSE_ID, existing: created, input: input({ title: 'Rappel' }) });

    const events = await eventsRepo.listByHorse(HORSE_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: created.id, title: 'Rappel' });
  });

  it('cannot move an event to another horse', async () => {
    const created = await create();

    const edited = await saveEvent({ horseId: 'horse-2', existing: created, input: input() });

    expect(edited?.horseId).toBe(HORSE_ID);
  });

  it('reports a record deleted underneath it rather than resurrecting it', async () => {
    const created = await create();
    await eventsRepo.remove(created.id);

    expect(await saveEvent({ horseId: HORSE_ID, existing: created, input: input() })).toBeUndefined();
    expect(await eventsRepo.listByHorse(HORSE_ID)).toHaveLength(0);
  });
});

describe('creating', () => {
  it('defaults the fields no layout can show', async () => {
    const event = await create();

    expect(event).toMatchObject({
      horseId: HORSE_ID,
      time: null,
      location: null,
      recurrenceId: null,
      currency: 'EUR',
    });
  });
});
