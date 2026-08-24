import { html, type TemplateResult } from 'lit';
import { describe, expect, it } from 'vitest';
import { fixture, settled } from './fixture.ts';

import '../app-input/app-input.ts';
import '../app-select/app-select.ts';
import '../app-checkbox/app-checkbox.ts';
import '../app-switch/app-switch.ts';
import '../app-segmented/app-segmented.ts';

/**
 * The one contract in this codebase that fails *silently*.
 *
 * Per UI Events, `change` is `composed: false`. It therefore stops at a
 * component's shadow boundary, so a `@change` binding on `<app-select>` never
 * fires — the field looks completely inert, with no error anywhere. Every field
 * here re-dispatches a composed custom event instead, and `AGENTS.md` records
 * that a new field type must do the same.
 *
 * Nothing pinned that. `form-control.test.ts` covers the validity half these
 * fields share, and covers it against all of them; this covers the half they
 * each implement for themselves, and the reason it matters is that getting it
 * wrong produces no failure — just a control nobody can use.
 *
 * `app-input` is deliberately in the table with a *native* event name: `input`
 * is `composed: true` and crosses the boundary on its own, which is why
 * `EventsView`'s search box binds `@input` straight onto `<app-input>` with no
 * re-dispatch anywhere. That difference is in the spec, not in this codebase,
 * and the test says so in the one place someone would think to "fix" it.
 */

type ChangeCase = {
  tag: string;
  /** The event a consumer is expected to bind on the host. */
  event: string;
  template: () => TemplateResult;
  /** Drive the inner native control the way a user would. */
  interact: (el: HTMLElement) => void;
  /** What `detail` should then carry, or `undefined` for a native event. */
  detail?: unknown;
};

const CASES: ChangeCase[] = [
  {
    tag: 'app-select',
    event: 'select-change',
    template: () => html`
      <app-select
        label="Type"
        .options=${[
          { value: 'veterinaire', label: 'Vétérinaire' },
          { value: 'marechal', label: 'Maréchal' },
        ]}
      ></app-select>
    `,
    interact: (el) => {
      const select = el.shadowRoot!.querySelector('select')!;
      select.value = 'marechal';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    detail: { value: 'marechal' },
  },
  {
    tag: 'app-checkbox',
    event: 'checkbox-change',
    template: () => html`<app-checkbox label="J'accepte"></app-checkbox>`,
    interact: (el) => {
      const input = el.shadowRoot!.querySelector('input')!;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    detail: { checked: true },
  },
  {
    tag: 'app-switch',
    event: 'switch-change',
    template: () => html`<app-switch label="Rappels"></app-switch>`,
    interact: (el) => {
      const input = el.shadowRoot!.querySelector('input')!;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    detail: { checked: true },
  },
  {
    tag: 'app-input',
    // Native, and correctly so — see the note above.
    event: 'input',
    template: () => html`<app-input label="Nom"></app-input>`,
    interact: (el) => {
      const input = el.shadowRoot!.querySelector('input')!;
      input.value = 'Ladympala';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    },
  },
];

describe.each(CASES)('$tag emits $event across its shadow boundary', (field) => {
  it('reaches a listener bound on the host element', async () => {
    const el = await fixture<HTMLElement>(field.template());

    const seen: Event[] = [];
    el.addEventListener(field.event, (event) => seen.push(event));

    field.interact(el);
    await settled(el);

    expect(seen).toHaveLength(1);
  });

  it('reaches a listener bound on an ancestor outside the shadow root', async () => {
    const host = await fixture<HTMLDivElement>(html`<div>${field.template()}</div>`);
    const el = host.querySelector<HTMLElement>(field.tag)!;
    await settled(el);

    // `bubbles` alone is not enough: an event that is not `composed` is
    // retargeted to nothing outside the boundary it was dispatched in.
    const seen: Event[] = [];
    host.addEventListener(field.event, (event) => seen.push(event));

    field.interact(el);
    await settled(el);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.composed).toBe(true);
    expect(seen[0]!.bubbles).toBe(true);
    // Retargeted to the custom element, so a consumer reads the field it bound
    // to rather than an implementation detail of its shadow root.
    expect(seen[0]!.target).toBe(el);
  });

  if (field.detail !== undefined) {
    it('carries the new value in detail', async () => {
      const el = await fixture<HTMLElement>(field.template());

      let detail: unknown;
      el.addEventListener(field.event, (event) => {
        detail = (event as CustomEvent).detail;
      });

      field.interact(el);
      await settled(el);

      expect(detail).toEqual(field.detail);
    });
  }
});

describe('app-segmented', () => {
  const options = [
    { value: 'calendar', label: 'Calendrier' },
    { value: 'list', label: 'Liste' },
  ];

  it('emits segment-change with the newly selected value', async () => {
    const el = await fixture<HTMLElement>(
      html`<app-segmented label="Affichage" .options=${options} value="calendar"></app-segmented>`,
    );

    const seen: CustomEvent[] = [];
    el.addEventListener('segment-change', (event) => seen.push(event as CustomEvent));

    el.shadowRoot!.querySelectorAll<HTMLElement>('button')[1]!.click();
    await settled(el);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.detail).toEqual({ value: 'list' });
  });

  it('stays silent when the already-selected segment is pressed again', async () => {
    const el = await fixture<HTMLElement>(
      html`<app-segmented label="Affichage" .options=${options} value="calendar"></app-segmented>`,
    );

    const seen: CustomEvent[] = [];
    el.addEventListener('segment-change', (event) => seen.push(event as CustomEvent));

    el.shadowRoot!.querySelectorAll<HTMLElement>('button')[0]!.click();
    await settled(el);

    // A consumer keys view state off this event; re-emitting on a no-op press
    // would churn the whole view for nothing.
    expect(seen).toHaveLength(0);
  });
});
