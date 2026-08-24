import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { fixture, settled } from '../__tests__/fixture.ts';
import './app-input.ts';
import type { AppInput } from './app-input.ts';

/**
 * The behaviour here is all platform integration — `ElementInternals`, the
 * custom state set, constraint validation and form participation — so these run
 * in a real browser. In jsdom every assertion below would be checking a mock.
 */
describe('app-input', () => {
  describe('labelling', () => {
    it('wires the label to the input by id', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Quantité"></app-input>`);

      const label = el.renderRoot.querySelector('label');
      const input = el.renderRoot.querySelector('input');

      expect(label?.htmlFor).toBe(input?.id);
      expect(input?.id).toBeTruthy();
      expect(label?.textContent?.trim()).toBe('Quantité');
    });

    it('keeps the label for assistive tech when hide-label is set', async () => {
      const el = await fixture<AppInput>(
        html`<app-input label="Rechercher" hide-label></app-input>`,
      );

      // Clipped, not removed — dropping it would leave the field with no
      // accessible name at all, which is the trap the property exists to avoid.
      const label = el.renderRoot.querySelector('label');
      expect(label).not.toBeNull();
      expect(label?.textContent?.trim()).toBe('Rechercher');
      expect(getComputedStyle(label!).clipPath).not.toBe('none');
    });

    it('describes the field with its suffix, hint and error together', async () => {
      const el = await fixture<AppInput>(
        html`<app-input label="Poids" suffix="kg" help-text="Au dernier pesage"></app-input>`,
      );

      const input = el.renderRoot.querySelector('input');
      const described = input?.getAttribute('aria-describedby')?.split(' ') ?? [];

      expect(described).toHaveLength(2);
      for (const id of described) {
        expect(el.renderRoot.querySelector(`#${id}`)).not.toBeNull();
      }
    });
  });

  describe('validity', () => {
    it('is invalid to the form but shows nothing until the field is touched', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Nom" required></app-input>`);

      // Read through `validity`, not `checkValidity()`: the latter has a side
      // effect this assertion would trip over — see the test below.
      expect(el.validity.valueMissing).toBe(true);

      // Nothing is shown yet, because the user has not had their turn. The
      // node still exists — see the live-region test below — so "shows
      // nothing" means hidden and empty, not absent.
      expect(el.matches(':state(invalid)')).toBe(false);

      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error).not.toBeNull();
      expect(error?.hasAttribute('hidden')).toBe(true);
      expect(error?.textContent?.trim()).toBe('');
    });

    it('keeps one error node across the whole pristine -> invalid -> fixed cycle', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Nom" required></app-input>`);
      const input = el.renderRoot.querySelector('input')!;

      // Identity, not just presence. A `role`-carrying node rendered into
      // existence at the moment it has something to say is announced as
      // nothing by most screen readers — the region has to be in the
      // accessibility tree first. Re-querying and comparing the element
      // catches a regression to `${cond ? html`<p>` : nothing}`, which would
      // still pass every content assertion above.
      const pristine = el.renderRoot.querySelector('[part="error"]');
      expect(pristine).not.toBeNull();

      input.dispatchEvent(new FocusEvent('blur'));
      await settled(el);
      expect(el.renderRoot.querySelector('[part="error"]')).toBe(pristine);

      input.value = 'Ladympala';
      input.dispatchEvent(new InputEvent('input'));
      await settled(el);
      expect(el.renderRoot.querySelector('[part="error"]')).toBe(pristine);
    });

    it('reveals the error when something checks its validity', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Nom" required></app-input>`);

      // `checkValidity()` fires an `invalid` event on an invalid element — that
      // is the platform's behaviour, not this component's — and the field
      // treats that event as "the user has had their chance", the same way it
      // treats a failed submission. So the silent-looking check is not silent.
      //
      // Pinned deliberately: it is the behaviour a caller gets today, and the
      // alternative (telling a bare `checkValidity()` apart from a submission)
      // is not something the platform offers. Anything relying on a genuinely
      // side-effect-free read should use `validity` instead.
      expect(el.checkValidity()).toBe(false);
      await settled(el);

      expect(el.matches(':state(invalid)')).toBe(true);
    });

    it('surfaces the error on blur', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Nom" required></app-input>`);

      el.renderRoot.querySelector('input')!.dispatchEvent(new FocusEvent('blur'));
      await settled(el);

      expect(el.matches(':state(invalid)')).toBe(true);

      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error).not.toBeNull();
      expect(error?.hasAttribute('hidden')).toBe(false);
      // The browser's own message, not one this component invented.
      expect(error?.textContent?.trim()).toBe(el.validationMessage);
      expect(el.validationMessage).not.toBe('');

      // No live-region role: the message reaches the user through
      // `aria-describedby` on the control, read on focus. An assertive region
      // firing on every blur is noise, and the form-level failure path focuses
      // the offending field instead — see `event-sheet`.
      expect(error?.hasAttribute('role')).toBe(false);
      expect(
        el.renderRoot.querySelector('input')?.getAttribute('aria-describedby'),
      ).toContain(error!.id);
    });

    it('clears the error once the field is filled in', async () => {
      const el = await fixture<AppInput>(html`<app-input label="Nom" required></app-input>`);
      const input = el.renderRoot.querySelector('input')!;

      input.dispatchEvent(new FocusEvent('blur'));
      await settled(el);
      expect(el.matches(':state(invalid)')).toBe(true);

      input.value = 'Ladympala';
      input.dispatchEvent(new InputEvent('input'));
      await settled(el);

      expect(el.value).toBe('Ladympala');
      expect(el.checkValidity()).toBe(true);
      expect(el.matches(':state(invalid)')).toBe(false);

      // Hidden and emptied rather than removed, and dropped from the
      // description so nothing points at a blank node.
      const error = el.renderRoot.querySelector('[part="error"]');
      expect(error?.hasAttribute('hidden')).toBe(true);
      expect(error?.textContent?.trim()).toBe('');
      expect(
        el.renderRoot.querySelector('input')?.getAttribute('aria-describedby') ?? '',
      ).not.toContain(error!.id);
    });

    it('prefers an externally supplied error message, and shows it untouched', async () => {
      const el = await fixture<AppInput>(
        html`<app-input label="Email" error="Déjà utilisé"></app-input>`,
      );

      // No blur, and none needed. Waiting for the user's turn is right for a
      // native constraint they may still be in the middle of satisfying; an
      // `error` set from outside is the app stating a verdict it has already
      // reached. A `novalidate` form has nothing else that would ever reveal it.
      expect(el.touched).toBe(true);
      expect(el.matches(':state(invalid)')).toBe(true);
      expect(el.checkValidity()).toBe(false);
      expect(el.renderRoot.querySelector('[part="error"]')?.textContent?.trim()).toBe(
        'Déjà utilisé',
      );

      el.error = '';
      await settled(el);
      expect(el.checkValidity()).toBe(true);
    });

    it('marks itself touched when a submission finds it invalid', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form><app-input label="Nom" name="nom" required></app-input></form>
      `);
      const el = form.querySelector('app-input')!;
      await settled(el);

      // Never focused, never blurred — reportValidity is the only thing that
      // has told this field anything, via the `invalid` event on the host.
      expect(form.reportValidity()).toBe(false);
      await settled(el);

      expect(el.matches(':state(invalid)')).toBe(true);
    });
  });

  describe('form participation', () => {
    it('contributes its value to FormData under its name', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form><app-input label="Nom" name="nom" value="Ladympala"></app-input></form>
      `);
      await settled(form.querySelector('app-input')!);

      expect(new FormData(form).get('nom')).toBe('Ladympala');
    });

    it('tracks later edits', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form><app-input label="Nom" name="nom" value="Ladympala"></app-input></form>
      `);
      const el = form.querySelector('app-input')!;
      await settled(el);

      el.value = 'Lea';
      await settled(el);

      expect(new FormData(form).get('nom')).toBe('Lea');
    });

    it('restores its initial value on form reset', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form><app-input label="Nom" name="nom" value="Ladympala"></app-input></form>
      `);
      const el = form.querySelector('app-input')!;
      await settled(el);

      el.value = 'Lea';
      await settled(el);

      form.reset();
      await settled(el);

      expect(el.value).toBe('Ladympala');
      expect(new FormData(form).get('nom')).toBe('Ladympala');
    });

    it('exposes the form it belongs to', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form><app-input label="Nom" name="nom"></app-input></form>
      `);
      const el = form.querySelector('app-input')!;
      await settled(el);

      expect(el.form).toBe(form);
    });

    it('follows a fieldset being disabled', async () => {
      const form = await fixture<HTMLFormElement>(html`
        <form>
          <fieldset><app-input label="Nom" name="nom"></app-input></fieldset>
        </form>
      `);
      const el = form.querySelector('app-input')!;
      await settled(el);
      expect(el.disabled).toBe(false);

      form.querySelector('fieldset')!.disabled = true;
      await settled(el);

      expect(el.disabled).toBe(true);
    });
  });
});
