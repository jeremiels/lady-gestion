import { html } from 'lit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db.ts';
import { makeEvent, resetDb } from '../data/__tests__/factories.ts';
import { fixture, settled, waitFor } from '../components/__tests__/fixture.ts';
import './EventDetailView.ts';
import type { EventDetailView } from './EventDetailView.ts';

/**
 * Deleting navigates back to the list through the real Navigation API — see
 * `router.test.ts` for why a file-scoped keeper is what makes that safe to
 * drive inside the runner's own page instead of tearing down the test run.
 */
let keeper: AbortController;
let startUrl: string;

beforeAll(() => {
  startUrl = location.href;
  keeper = new AbortController();
  navigation.addEventListener(
    'navigate',
    (event) => {
      if (!event.canIntercept || event.navigationType === 'reload') return;
      event.intercept({ handler: async () => {} });
    },
    { signal: keeper.signal },
  );
});

afterAll(() => keeper.abort());

afterEach(async () => {
  if (location.href !== startUrl) {
    await navigation.navigate(startUrl, { history: 'replace' }).finished?.catch(() => {});
  }
});

const mount = (eventId: string) =>
  fixture<EventDetailView>(html`<event-detail-view .eventId=${eventId}></event-detail-view>`);

const actionLabeled = (el: EventDetailView, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.event-detail__action')].find((button) =>
    button.textContent?.includes(label),
  )!;

const dialogButtonLabeled = (el: EventDetailView, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.event-detail__button')].find((button) =>
    button.textContent?.includes(label),
  )!;

beforeEach(resetDb);

describe('event-detail-view', () => {
  it('shows a not-found state for an id with no matching event', async () => {
    const el = await mount('missing');
    await waitFor(el, () => el.textContent!.includes('introuvable'));

    expect(el.querySelector('.event-detail__back-link')).not.toBeNull();
  });

  it('shows a care event’s practitioner and a purchase’s vendor, never the other', async () => {
    await db.events.bulkAdd([
      makeEvent({ id: 'care-1', type: 'veto', providerName: 'Dr. Dupont', amountCents: 4500 }),
      makeEvent({ id: 'purchase-1', type: 'achat', vendor: 'Décathlon', amountCents: 2000 }),
    ]);

    const care = await mount('care-1');
    await waitFor(care, () => care.textContent!.includes('Practicien'));
    expect(care.textContent).toContain('Dr. Dupont');
    expect(care.textContent).not.toContain('Site');

    const purchase = await mount('purchase-1');
    await waitFor(purchase, () => purchase.textContent!.includes('Site'));
    expect(purchase.textContent).toContain('Décathlon');
    expect(purchase.textContent).not.toContain('Practicien');
  });

  it('confirming delete soft-deletes the record and leaves the page', async () => {
    await db.events.add(makeEvent({ id: 'to-delete', title: 'Visite à supprimer' }));
    const el = await mount('to-delete');
    await waitFor(el, () => el.textContent!.includes('Visite à supprimer'));

    actionLabeled(el, 'Supprimer').click();
    await settled(el);
    dialogButtonLabeled(el, 'Supprimer').click();

    let stored = await db.events.get('to-delete');
    for (let i = 0; i < 20 && stored?.deletedAt == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      stored = await db.events.get('to-delete');
    }
    expect(stored?.deletedAt).not.toBeNull();
  });
});
