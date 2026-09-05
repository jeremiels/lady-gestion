import { css, html, nothing } from "lit";

/**
 * The hint and error nodes every field renders below its control, shared by
 * `app-input`, `app-select` and `app-checkbox`.
 *
 * Worth sharing for the DOM as well as the source: Lit preserves comment nodes
 * through template cloning, so a paragraph like the one below, written inline in
 * a field's template, ships into the DOM of every instance — and the event sheet
 * alone renders seven.
 */

/**
 * Joins the ids describing a control, dropping the ones not currently on
 * screen. `undefined` rather than `''` so `ifDefined` omits the attribute
 * outright instead of writing an empty one.
 */
export const describedBy = (
  ...ids: (string | false | undefined)[]
): string | undefined => ids.filter(Boolean).join(" ") || undefined;

export interface FieldMessagesOptions {
  hintId: string;
  errorId: string;
  /** Static guidance, always safe to show. */
  helpText: string;
  /** What to say about the field being wrong, or `''` for "nothing to say". */
  message: string;
}

/**
 * The error node is **permanent** — emptied and hidden when there is nothing to
 * say, never rendered into existence at the moment it has something. An element
 * only reaches the accessibility tree when it is in the DOM and displayed, so a
 * node created (or unhidden) together with its contents gives assistive tech
 * nothing to observe.
 *
 * It carries no live-region role of its own, though. The message reaches the
 * user through `aria-describedby` on the control, which is read on focus and
 * needs no announcement to interrupt them — an assertive region on every field
 * would fire on every blur. Submission failure is the case that has to be heard
 * immediately, and that is handled once, at form level, by focusing the first
 * field at fault.
 */
export const fieldMessages = ({
  hintId,
  errorId,
  helpText,
  message,
}: FieldMessagesOptions) => html`
  ${helpText ? html`<p class="field__hint" part="hint" id=${hintId}>${helpText}</p>` : nothing}
  <p class="field__error" part="error" id=${errorId} ?hidden=${!message}>
    ${message}
  </p>
`;

/**
 * How the nodes above are painted, plus the required marker beside a label.
 *
 * One override point for the error colour — `--app-field-error-color` — rather
 * than a differently-named hook per field, which is a public surface nobody can
 * find on purpose.
 *
 * What is *not* here is each field's `:host(:state(invalid))` rule. Those point
 * at different inner elements — `.field__control`, `.field__select`,
 * `.field__box` — so they stay with the component that owns the element, and
 * reach for `--app-field-error-ring` below rather than restating the
 * `color-mix`.
 *
 * Composed by `FormFieldElement` into `static styles`, the same way
 * `BaseElement` composes the reset.
 */
export const fieldStyles = css`
  :host {
    --app-field-error-color: var(--color-danger);
    --app-field-error-ring: 0 0 0 3px
      color-mix(in srgb, var(--app-field-error-color) 25%, transparent);
  }

  .field__required {
    color: var(--app-field-error-color);
  }

  .field__hint {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-brown-light);
  }

  .field__error {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--app-field-error-color);
  }
`;
