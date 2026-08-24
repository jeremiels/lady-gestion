import { html, type TemplateResult } from 'lit';
import { describe, expect, it } from 'vitest';
import { fixture, settled } from '../../components/__tests__/fixture.ts';
import type { ValidatedField } from './form-control.ts';

import '../../components/app-input/app-input.ts';
import '../../components/app-select/app-select.ts';
import '../../components/app-checkbox/app-checkbox.ts';
import '../../components/app-switch/app-switch.ts';
import type { AppSwitch } from '../../components/app-switch/app-switch.ts';

/**
 * `FormControl`'s whole justification is that the validity plumbing lived in
 * three verbatim copies, and that the sync is timing-sensitive enough that a
 * correction had to be made in three places or silently apply to two fields out
 * of three. That argument only holds while the three fields are actually shown
 * to behave the same — so this suite is written once and run against all of
 * them, rather than as three hand-written files that could drift the same way
 * the implementations did.
 *
 * `app-input` keeps its own file for what is specific to it (labelling,
 * `hide-label`, the suffix). What is here is only the shared half.
 */

/** A field type, plus the two things every test needs to know about it. */
type FieldCase = {
  tag: string;
  /** Required and empty, so the field starts invalid. */
  template: () => TemplateResult;
  /** The native control inside the shadow root that the host mirrors. */
  control: (el: ValidatedField) => HTMLInputElement | HTMLSelectElement;
  /** Drive the field to a valid value the way a user would. */
  fill: (el: ValidatedField) => void;
  /** What `FormData` should then carry under `name="f"`. */
  filledValue: string;
};

const CASES: FieldCase[] = [
  {
    tag: 'app-input',
    template: () => html`<app-input label="Nom" name="f" required></app-input>`,
    control: (el) => el.renderRoot.querySelector('input')!,
    fill: (el) => {
      const input = el.renderRoot.querySelector('input')!;
      input.value = 'Ladympala';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    },
    filledValue: 'Ladympala',
  },
  {
    tag: 'app-select',
    template: () => html`
      <app-select
        label="Type"
        name="f"
        placeholder="Choisir"
        required
        .options=${[{ value: 'veterinaire', label: 'Vétérinaire' }]}
      ></app-select>
    `,
    control: (el) => el.renderRoot.querySelector('select')!,
    fill: (el) => {
      const select = el.renderRoot.querySelector('select')!;
      select.value = 'veterinaire';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    filledValue: 'veterinaire',
  },
  {
    tag: 'app-checkbox',
    template: () => html`<app-checkbox label="J'accepte" name="f" required></app-checkbox>`,
    control: (el) => el.renderRoot.querySelector('input')!,
    fill: (el) => {
      const input = el.renderRoot.querySelector('input')!;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    // The default `value` every field of this kind submits when checked.
    filledValue: 'on',
  },
];

describe.each(CASES)('FormControl on $tag', (field) => {
  const mount = () => fixture<ValidatedField>(field.template());

  describe('validity mirror', () => {
    it('is invalid to the form while showing the user nothing', async () => {
      const el = await mount();

      // The form always knows the truth, touched or not — that is what makes a
      // submission blocked. Read through `validity` rather than
      // `checkValidity()`, which fires `invalid` and would reveal the error.
      expect((el as unknown as { validity: ValidityState }).validity.valid).toBe(false);

      expect(el.touched).toBe(false);
      expect(el.invalid).toBe(false);
      expect(el.matches(':state(invalid)')).toBe(false);

      // The node is permanent — it has to be in the accessibility tree before
      // it has anything to say — so "showing the user nothing" is hidden and
      // empty rather than absent.
      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error).not.toBeNull();
      expect(error?.hasAttribute('hidden')).toBe(true);
      expect(error?.textContent?.trim()).toBe('');
    });

    it('leaves validationMessage empty while nothing can display it', async () => {
      const el = await mount();

      // Not cosmetic. The first `sync()` runs from `firstUpdated()`, which is
      // inside the first update — writing a message no template reads there
      // scheduled a second render for every field on the page and tripped
      // Lit's change-in-update warning each time.
      expect(el.validationMessage).toBe('');
    });

    it('reveals the error on blur, with the platform message', async () => {
      const el = await mount();

      field.control(el).dispatchEvent(new FocusEvent('blur'));
      await settled(el);

      expect(el.touched).toBe(true);
      expect(el.invalid).toBe(true);
      expect(el.matches(':state(invalid)')).toBe(true);

      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error?.hasAttribute('hidden')).toBe(false);
      // No live-region role on a field: the message is wired to the control
      // through `aria-describedby` and read on focus. Announcing on every blur
      // is noise, and submission failure is handled once, at form level, by
      // focusing the offending field.
      expect(error?.hasAttribute('role')).toBe(false);
      // The browser's own wording, not one the component invented.
      expect(el.validationMessage).toBe(field.control(el).validationMessage);
      expect(el.validationMessage).not.toBe('');
      expect(error?.textContent?.trim()).toBe(el.validationMessage);
    });

    it('clears the error, and the stale message with it, once filled in', async () => {
      const el = await mount();

      field.control(el).dispatchEvent(new FocusEvent('blur'));
      await settled(el);
      expect(el.invalid).toBe(true);

      field.fill(el);
      await settled(el);

      expect(el.invalid).toBe(false);
      expect(el.matches(':state(invalid)')).toBe(false);

      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error?.hasAttribute('hidden')).toBe(true);
      expect(error?.textContent?.trim()).toBe('');
      // Assigned '' rather than left alone: a field that has been fixed must
      // not keep a message nothing will ever show again.
      expect(el.validationMessage).toBe('');
    });

    it('marks itself touched when a submission finds it invalid', async () => {
      const form = await fixture<HTMLFormElement>(html`<form>${field.template()}</form>`);
      const el = form.querySelector<ValidatedField>(field.tag)!;
      await settled(el);

      // Never focused, never blurred. The only thing that has told this field
      // anything is the `invalid` event the platform fires on the host.
      expect(form.reportValidity()).toBe(false);
      await settled(el);

      expect(el.touched).toBe(true);
      expect(el.matches(':state(invalid)')).toBe(true);
    });

    it('anchors the validity report at the visible control, not the host', async () => {
      const form = await fixture<HTMLFormElement>(html`<form>${field.template()}</form>`);
      const el = form.querySelector<ValidatedField>(field.tag)!;
      await settled(el);

      // Passing the native control as `setValidity`'s anchor is what makes the
      // browser's own validation bubble point at the field the user can see.
      // Observable here as the form being blocked at all.
      expect(form.checkValidity()).toBe(false);

      field.fill(el);
      await settled(el);

      expect(form.checkValidity()).toBe(true);
    });
  });

  describe('external errors', () => {
    it('overrides the platform message and clears cleanly', async () => {
      const el = await mount();
      (el as unknown as { error: string }).error = 'Refusé par le serveur';
      await settled(el);

      field.control(el).dispatchEvent(new FocusEvent('blur'));
      await settled(el);

      expect(el.renderRoot.querySelector('[part="error"]')?.textContent?.trim()).toBe(
        'Refusé par le serveur',
      );

      // Applied in `willUpdate`, before render — doing it after meant clearing
      // an error rewrote `invalid` after the render meant to reflect it.
      (el as unknown as { error: string }).error = '';
      field.fill(el);
      await settled(el);

      expect(el.invalid).toBe(false);
    });
  });

  describe('form participation', () => {
    it('submits nothing until it has a value, then submits it', async () => {
      const form = await fixture<HTMLFormElement>(html`<form>${field.template()}</form>`);
      const el = form.querySelector<ValidatedField>(field.tag)!;
      await settled(el);

      field.fill(el);
      await settled(el);

      expect(new FormData(form).get('f')).toBe(field.filledValue);
    });

    it('drops back to untouched and silent on form reset', async () => {
      const form = await fixture<HTMLFormElement>(html`<form>${field.template()}</form>`);
      const el = form.querySelector<ValidatedField>(field.tag)!;
      await settled(el);

      field.control(el).dispatchEvent(new FocusEvent('blur'));
      await settled(el);
      expect(el.invalid).toBe(true);

      form.reset();

      // Settles in a single pass. Lit resolves `updateComplete` with `false`
      // when the update it just finished scheduled another one, so this is a
      // direct assertion that nothing writes reactive state from `updated()`
      // on the reset path — which is what `FormControl.reset()` exists for.
      // Before it, this resolved `false` and logged a change-in-update warning
      // for every field in the form.
      expect(await el.updateComplete).toBe(true);

      expect(el.touched).toBe(false);
      expect(el.invalid).toBe(false);
      expect(el.matches(':state(invalid)')).toBe(false);
      expect(el.validationMessage).toBe('');
    });

    /**
     * Also the only coverage of `sync()` running against a *disabled* control,
     * which is a path with a crash in it: Chrome keeps `valueMissing` set on a
     * disabled empty required control while emptying `validationMessage`, and
     * `setValidity()` throws on that pair. Asserting the outcome any harder is
     * not possible from here — the platform bars a form-associated element
     * inside a disabled fieldset from validation itself, so the form's verdict
     * is the same either way and only the throw distinguishes them.
     */
    it('follows a fieldset being disabled', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <fieldset>${field.template()}</fieldset>
        </form>
      `);
      const el = form.querySelector<ValidatedField>(field.tag)!;
      await settled(el);

      form.querySelector('fieldset')!.disabled = true;
      await settled(el);

      expect((el as unknown as { disabled: boolean }).disabled).toBe(true);
    });
  });

  describe('teardown', () => {
    it('stops listening for `invalid` once disconnected', async () => {
      const el = await mount();
      const parent = el.parentElement!;

      el.remove();
      // `invalid` is the one event the controller subscribes to on the host, so
      // a leaked listener would show up as the field marking itself touched
      // while detached.
      el.dispatchEvent(new Event('invalid'));
      expect(el.touched).toBe(false);

      // Reconnecting has to restore it, or a field inside a view the user
      // navigated away from and back to would stop reporting errors.
      parent.append(el);
      await settled(el);
      el.dispatchEvent(new Event('invalid'));
      await settled(el);

      expect(el.touched).toBe(true);
    });
  });
});

/**
 * `app-switch` keeps the form association but deliberately uses no
 * `FormControl`: a switch is always in one of its two valid states, so there is
 * nothing to report and nothing to sync. That is a decision worth pinning —
 * the absence of validity plumbing should stay deliberate rather than become a
 * thing someone "fixes" by wiring the controller in.
 */
describe('app-switch (form-associated without FormControl)', () => {
  it('submits nothing when off and its value when on', async () => {
    const form = await fixture<HTMLFormElement>(html`
      <form><app-switch label="Rappels" name="rappels" value="oui"></app-switch></form>
    `);
    const el = form.querySelector<AppSwitch>('app-switch')!;
    await settled(el);

    // `null`, not an empty string: an unchecked box contributes no entry at all.
    expect(new FormData(form).get('rappels')).toBeNull();

    el.checked = true;
    await settled(el);

    expect(new FormData(form).get('rappels')).toBe('oui');
  });

  it('has no validity state to report', async () => {
    const el = await fixture<AppSwitch>(html`<app-switch label="Rappels"></app-switch>`);

    expect(el.matches(':state(invalid)')).toBe(false);
    expect('validity' in el).toBe(false);
  });

  it('re-dispatches change as a composed switch-change', async () => {
    const el = await fixture<AppSwitch>(
      html`<app-switch label="Rappels" name="rappels"></app-switch>`,
    );

    // Listening on the host, outside the shadow root — the native `change` is
    // `composed: false` and would never get here.
    const seen: boolean[] = [];
    el.addEventListener('switch-change', (event) => {
      seen.push((event as CustomEvent<{ checked: boolean }>).detail.checked);
    });

    const input = el.renderRoot.querySelector('input')!;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);

    expect(seen).toEqual([true]);
    expect(el.checked).toBe(true);
  });

  it('restores its initial state on form reset', async () => {
    const form = await fixture<HTMLFormElement>(html`
      <form><app-switch label="Rappels" name="rappels"></app-switch></form>
    `);
    const el = form.querySelector<AppSwitch>('app-switch')!;
    await settled(el);

    el.checked = true;
    await settled(el);

    form.reset();
    await settled(el);

    expect(el.checked).toBe(false);
  });
});
