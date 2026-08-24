import type { ReactiveController, ReactiveElement } from 'lit';

/** The native element a field wraps and reads its validity from. */
export type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * What a field has to expose for this controller to drive it.
 *
 * All three are `@state()` and deliberately not `private` on the components —
 * `changed.has(...)` in `updated()` needs them in `keyof`.
 */
export interface ValidatedField extends ReactiveElement {
  /** True once the user has blurred the field or submission has flagged it. */
  touched: boolean;
  /** `touched && !valid` — the only thing the error styling keys off. */
  invalid: boolean;
  /** The native control's message, shown when no external `error` overrides it. */
  validationMessage: string;
  /** App-supplied message. Non-empty means the app has judged this field wrong. */
  error: string;
}

/**
 * The `ElementInternals` half of a form-associated field: attach internals,
 * listen for `invalid`, and mirror the wrapped native control's validity onto
 * both the host's own state and its custom state set.
 *
 * It is one object rather than a mixin per field because the sync is
 * timing-sensitive — the native control updates asynchronously, so it has to
 * re-run from `updated()` once the DOM has caught up — and a correction to that
 * timing must land in one place or silently apply to some fields and not others.
 *
 * **Who holds one.** `FormFieldElement` does, once, and `app-input`,
 * `app-select` and `app-checkbox` extend it. That base class also owns the
 * parts a controller cannot take because the browser calls them on the
 * *element*: `formDisabledCallback`, and the `checkValidity()` /
 * `reportValidity()` / `validity` / `form` quartet that is the field's public
 * API.
 *
 * What stays per-field is `formResetCallback` and `formStateRestoreCallback` —
 * a checkbox resets to a boolean, an input to a string — along with the
 * property they differ about.
 *
 * `app-switch` is form-associated but deliberately holds no `FormControl`: a
 * switch has no constraint to violate. Its own docblock says why.
 */
export class FormControl implements ReactiveController {
  readonly internals: ElementInternals;

  #host: ValidatedField;
  #getControl: () => NativeControl | undefined;

  /**
   * Construct from a field's own constructor — `attachInternals()` may only be
   * called once per element, and must happen before the browser needs the form
   * value. `FormFieldElement` does this as a class field initializer, reading
   * the control through its abstract `control` getter; the getter is lazy, so it
   * is fine that `renderRoot` does not exist yet.
   */
  constructor(host: ValidatedField, getControl: () => NativeControl | undefined) {
    this.#host = host;
    this.#getControl = getControl;
    this.internals = host.attachInternals();
    host.addController(this);
  }

  hostConnected() {
    // `invalid` fires on the host when a form submission finds it invalid,
    // which is the one path that has to mark the field touched without the user
    // ever having focused it.
    this.#host.addEventListener('invalid', this.#onInvalid);
  }

  hostDisconnected() {
    this.#host.removeEventListener('invalid', this.#onInvalid);
  }

  /** What this field contributes to `FormData`. `null` submits nothing. */
  setFormValue(value: string | File | FormData | null) {
    this.internals.setFormValue(value);
  }

  /**
   * Copies the wrapped control's validity onto the host.
   *
   * Call from `updated()` after anything that can change it, not straight after
   * the event that caused it: the native control's `validity` is not settled
   * until the DOM has caught up with the new `value`/`checked`.
   *
   * Passing the control as `setValidity`'s anchor is what makes the browser's
   * own validation bubble point at the visible field rather than at the host.
   */
  sync() {
    const control = this.#getControl();
    if (!control) return;

    /*
     * A disabled control is barred from constraint validation, and asking the
     * browser to report its validity anyway throws.
     *
     * Chrome keeps `validity.valueMissing` set on a disabled empty required
     * control while emptying its `validationMessage`, and `setValidity()`
     * rejects exactly that pair: "the second argument should not be empty if one
     * or more flags in the first argument are true". So this branch is about not
     * crashing, not about the form's verdict — the platform already bars a
     * form-associated element inside a `<fieldset disabled>` from validation on
     * its own, whatever we report here. Clearing is simply the honest thing to
     * report for a control that currently constrains nothing.
     */
    if (control.disabled) {
      this.internals.setValidity({});
      this.#host.invalid = false;
      this.#host.validationMessage = '';
      this.internals.states.delete('invalid');
      return;
    }

    // The form always knows the truth, touched or not — this is what makes
    // submission blocked and `reportValidity()` point at the right field.
    this.internals.setValidity(control.validity, control.validationMessage, control);

    const invalid = this.#host.touched && !control.validity.valid;
    this.#host.invalid = invalid;

    /*
     * Mirrored onto the host only while something can display it.
     *
     * Every field renders the message behind `invalid`, so writing it to a
     * still-untouched field changes reactive state that nothing reads. That
     * would be merely wasteful anywhere else — but the first `sync()` runs from
     * `firstUpdated()`, which is *inside* the first update, so an unguarded
     * write schedules a second render for every field on the page and trips
     * Lit's `change-in-update` warning on each one.
     *
     * Assigning `''` rather than skipping the write keeps it honest: a field
     * that has been fixed, or reset back to untouched, clears its stale
     * message instead of keeping one nothing will ever show again.
     */
    this.#host.validationMessage = invalid ? control.validationMessage : '';

    // Drives `:host(:state(invalid))` in every field's stylesheet — a custom
    // state rather than a reflected attribute, so it cannot be spoofed from
    // markup and does not show up in the DOM inspector as author intent.
    this.internals.states.delete('invalid');
    if (invalid) this.internals.states.add('invalid');
  }

  /**
   * Applies an app-supplied error message, or clears it with `''`.
   *
   * Call from the host's `willUpdate` when `error` changes — Lit's designated
   * place for state writes, so the `touched` flip below folds into the update
   * already in flight rather than scheduling another.
   *
   * **The `touched` write is the point.** `sync()` only shows a message once
   * the user has had their turn, which is right for a native constraint the
   * user is still in the middle of satisfying. An `error` set from outside is
   * not that: it is the app stating a verdict it has already reached, and it
   * has to be visible the moment it is set. Without this, a `novalidate` form
   * whose rules live in `forms.ts` sets every message on a failed submit and
   * displays none of them, so the submit button appears to do nothing.
   *
   * Reveal therefore does not run through native validity. `checkValidity()`
   * would work only because `setCustomValidity` below makes the control invalid
   * too, and it would ask the browser to fire an `invalid` event just so this
   * controller's own listener could set a boolean it can set here.
   *
   * `reset()` is unaffected: it clears `touched` and the host clears `error` in
   * the same pass, so nothing flips back.
   */
  setExternalError(message: string) {
    // Set before the control is even looked at, because a field can be created
    // with an `error` already on it — and then the only call that reaches a
    // control is the seeding one from `firstUpdated()`, which is *inside* the
    // first update. Deriving these there instead would flip them mid-update:
    // a change-in-update warning and a wasted second render, exactly the
    // hazard `reset()` below is written the way it is to avoid.
    //
    // Safe to do early for the same reason it is there: none of the three
    // depends on what the control currently holds. `setCustomValidity` with a
    // non-empty message makes it invalid by definition, and makes that message
    // its `validationMessage`, so this is not a guess about the outcome — it is
    // the outcome, written down before `sync()` reads it back.
    if (message) {
      this.#host.touched = true;
      this.#host.invalid = true;
      this.#host.validationMessage = message;
    }

    const control = this.#getControl();
    if (!control) return;

    // What keeps the *form* honest — submission stays blocked and
    // `reportValidity()` still points here — independently of what is shown.
    control.setCustomValidity(message);
    this.sync();
  }

  /**
   * What the field should display: nothing until invalid, then the app's word
   * over the platform's.
   *
   * The rule every field's `render()` needs, and the reason it moved here
   * instead of staying inline in three of them: it has to agree with the
   * `aria-describedby` wiring and with `fieldMessages`'s `message` prop, and a
   * rule three files have to keep restating is a rule three files can restate
   * differently.
   */
  get message(): string {
    return this.#host.invalid ? this.#host.error || this.#host.validationMessage : '';
  }

  /** Blur and failed submission both mean "the user has had their chance". */
  markTouched = () => {
    this.#host.touched = true;
    this.sync();
  };

  /**
   * Back to pristine. Call from the component's `formResetCallback`.
   *
   * The user-visible state is cleared here, in the reset itself, rather than
   * left for the post-render `sync()` to work out. `sync()` derives `invalid`
   * from `touched`, so clearing only `touched` would leave `invalid` to flip
   * inside `updated()` — a change-in-update, a wasted second render for every
   * field in the form, and a console warning on each one. It is the same hazard
   * the `validationMessage` guard in `sync()` covers, on the one path that
   * guard does not reach.
   *
   * Safe to do early, unlike the rest of the sync: a reset goes to a state that
   * does not depend on what the native control currently holds, so there is
   * nothing to wait for the DOM about. `sync()` still runs from `updated()`
   * afterwards and still reports the reset value's validity to the form — it
   * simply finds these three already correct and changes nothing.
   */
  reset() {
    this.#host.touched = false;
    this.#host.invalid = false;
    this.#host.validationMessage = '';
    this.internals.states.delete('invalid');
  }

  #onInvalid = () => this.markTouched();
}
