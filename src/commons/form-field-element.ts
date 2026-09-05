import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { BaseElement } from "./base-element.ts";
import { fieldStyles } from "./field-parts.ts";
import {
  FormControl,
  type NativeControl,
  type ValidatedField,
} from "./controllers/form-control.ts";

/** Unique-id counter for label/aria wiring, shared by every field type. */
let nextId = 0;

/**
 * What `app-input`, `app-select` and `app-checkbox` are before they differ.
 *
 * `FormControl` owns the fiddly half — attaching internals, mirroring validity,
 * getting the timing right. This class owns everything else the three share:
 * the four constraint-validation members, `formDisabledCallback`, the
 * `willUpdate` line that applies an external error, `static formAssociated`,
 * the `delegatesFocus` options, six properties, three `@state()` flags, and the
 * whole update lifecycle. It is the concrete shape of the `ValidatedField`
 * interface `form-control.ts` describes, so the compiler checks the agreement.
 *
 * **What stays on the subclass, and why.** The three genuinely differ about one
 * thing: which property holds their value, and what type it is. That difference
 * is three small members — `formValue`, `captureDefault`, `restoreDefault` —
 * and everything downstream of it is here.
 *
 * `formStateRestoreCallback` also stays per-subclass: it is the one member whose
 * *argument* has to be interpreted differently, not just stored differently.
 *
 * `static formAssociated = true` inherits correctly: the browser reads it off
 * the constructor at definition time and static lookup walks the prototype
 * chain, so declaring it here reaches all three.
 */
export abstract class FormFieldElement
  extends BaseElement
  implements ValidatedField
{
  static formAssociated = true;

  static shadowRootOptions = {
    ...BaseElement.shadowRootOptions,
    delegatesFocus: true,
  };

  /**
   * The hint/error/required painting all three fields render.
   *
   * `sharedStyles`, not `styles`: `BaseElement` owns where this lands in the
   * cascade (below `componentStyles`, so a field can still override it) and
   * overriding `styles` here would have to restate that ordering — or, done the
   * obvious wrong way, drop each subclass's own rules entirely.
   */
  static sharedStyles = fieldStyles;

  /**
   * Stable id for label/aria wiring, minted once per element.
   *
   * One counter for every field type rather than one per file: the prefix only
   * ever needed to be unique within a document, which a single sequence gives
   * for free.
   */
  readonly fieldId = `app-field-${++nextId}`;

  @property({ type: String }) label = "";
  @property({ type: String }) name = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String, attribute: "help-text" }) helpText = "";
  /** External/server-side validation message. Set to '' to clear. */
  @property({ type: String }) error = "";

  /**
   * Not `private`: `changed.has(...)` in `updated()` needs these in `keyof`, and
   * `ValidatedField` requires them to be readable by the controller.
   */
  @state() invalid = false;
  @state() validationMessage = "";
  @state() touched = false;

  /**
   * The native control inside this field's shadow root.
   *
   * A getter rather than a constructor argument because `renderRoot` does not
   * exist yet when `field` below is initialised — `@query` resolves lazily, and
   * so must this.
   */
  protected abstract get control(): NativeControl | undefined;

  /** Internals, the `invalid` listener and the validity mirror. */
  protected readonly field = new FormControl(this, () => this.control);

  // --- The three things a field type actually differs about ---

  /** What this field contributes to `FormData`. `null` submits nothing. */
  protected abstract get formValue(): string | File | FormData | null;

  /** Remember the pristine value, so `formResetCallback` can return to it. */
  protected abstract captureDefault(): void;

  /** Put that pristine value back. */
  protected abstract restoreDefault(): void;

  /**
   * The ids and message every field's `render()` needs, derived from `fieldId`.
   *
   * `message` is read from the controller rather than recomputed because it has
   * to agree with what `aria-describedby` points at, which is the whole reason
   * `FormControl.message` exists.
   */
  protected get messages() {
    const hintId = `${this.fieldId}-hint`;
    const errorId = `${this.fieldId}-error`;
    return { hintId, errorId, message: this.field.message };
  }

  // --- Update lifecycle, shared ---

  protected firstUpdated() {
    this.captureDefault();
    // Seeded here because `willUpdate` had no control to talk to yet.
    // `setExternalError` syncs once a control exists, and it does by now.
    this.field.setExternalError(this.error);
    this.field.setFormValue(this.formValue);
  }

  /**
   * Unconditional, not guarded on `changed`.
   *
   * Both calls are idempotent, Lit's property setters no-op on an unchanged
   * value, and the sync has to run *after* the DOM has caught up anyway — the
   * value reaches the native control through `live()` during render, so its
   * validity is not settled until here. A `changed.has(...)` guard would only
   * add a list to forget to extend when a new property is added.
   */
  protected updated() {
    this.field.setFormValue(this.formValue);
    this.field.sync();
  }

  // --- Form-associated custom element lifecycle ---

  formDisabledCallback(disabled: boolean) {
    this.disabled = disabled;
  }

  formResetCallback() {
    this.restoreDefault();
    this.error = "";
    this.field.reset();
  }

  // --- Public constraint-validation API, mirrors a native field ---

  checkValidity(): boolean {
    return this.field.internals.checkValidity();
  }

  reportValidity(): boolean {
    return this.field.internals.reportValidity();
  }

  get validity(): ValidityState {
    return this.field.internals.validity;
  }

  get form(): HTMLFormElement | null {
    return this.field.internals.form;
  }

  /**
   * An external error applies *before* render, not after.
   *
   * `setExternalError` depends only on `error` — never on what render is about
   * to do — so applying it and re-syncing here leaves the post-render `sync()`
   * in each subclass with nothing to change. Doing both in `updated()` meant the
   * mutation and the read of it landed in the same pass, so clearing an error
   * rewrote `invalid` *after* the render that was supposed to reflect it and
   * scheduled another one.
   *
   * A subclass that needs its own `willUpdate` must call `super.willUpdate()`.
   */
  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("error")) this.field.setExternalError(this.error);
  }
}
