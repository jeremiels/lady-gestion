import { css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DialogElement } from "../../commons/dialog-element.ts";

/**
 * Centered dialog, for a decision that has to be made before anything else can
 * happen — confirming a delete, above all.
 *
 * The sibling of `app-bottom-sheet`, and built the same way on top of a native
 * `<dialog>`: top-layer stacking, a real `::backdrop`, a focus trap and
 * Esc-to-dismiss all come from the platform. A sheet is for a task (a form to
 * fill in); this is for an answer, which is why it sits in the middle of the
 * screen and cannot be dragged away.
 *
 * `full-bleed` drops the card entirely and fills the viewport — that is how
 * `document-viewer` reuses this dialog machinery instead of hand-rolling a
 * third `<dialog>`.
 */
@customElement("app-modal")
export class AppModal extends DialogElement {
  /** Fills the viewport with no card, no padding — for media. */
  @property({ type: Boolean, reflect: true, attribute: "full-bleed" })
  fullBleed = false;

  constructor() {
    super("modal");
  }

  static componentStyles = css`
    :host {
      display: contents;
    }

    dialog {
      margin: auto;
      padding: 0;
      border: none;
      width: calc(100% - 2 * var(--spacing-24));
      max-width: 20rem;
      max-height: min(85dvh, 40rem);
      background-color: var(--color-page);
      border-radius: var(--radius-16);
      box-shadow: 0 8px 32px rgb(0 0 0 / 20%);
      display: none;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      scale: 0.94;
      transition:
        scale var(--duration-medium) var(--easing-out),
        opacity var(--duration-medium) var(--easing-out),
        overlay var(--duration-medium) allow-discrete,
        display var(--duration-medium) allow-discrete;
    }

    dialog[open] {
      display: flex;
      opacity: 1;
      scale: 1;
    }

    /* The entry half of the animation. Without it the dialog would appear at
       its final scale, since there is no previous style to transition from. */
    @starting-style {
      dialog[open] {
        opacity: 0;
        scale: 0.94;
      }
    }

    /* And the exit half, where overlay cannot hold the dialog in the top layer
       long enough for the closed-state rule above to be seen. */
    dialog[open][data-closing] {
      opacity: 0;
      scale: 0.94;
    }

    /* Media wants the whole screen and no chrome around it. The header still
       renders — it carries the only close affordance. */
    :host([full-bleed]) dialog {
      width: 100%;
      max-width: none;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      background-color: var(--color-dark);
    }

    .dialog__header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: var(--spacing-12);
      flex-shrink: 0;
      padding: var(--spacing-20) var(--spacing-20) var(--spacing-12);
    }

    :host([full-bleed]) .dialog__header {
      padding-top: calc(var(--spacing-12) + env(safe-area-inset-top, 0px));
      color: var(--color-white);
    }

    .dialog__title {
      font-size: 1.0625rem;
      line-height: 1.25rem;
      font-weight: 700;
      color: var(--font-color);
    }

    :host([full-bleed]) .dialog__title {
      color: var(--color-white);
      /* A file name has no spaces to break on, so it must be told to wrap. */
      overflow-wrap: anywhere;
    }

    .dialog__description {
      line-height: 1.35;
    }

    /* currentcolor, so the full-bleed header below can turn it white. */
    .dialog__close {
      color: currentcolor;
      flex-shrink: 0;
      /* Not pulled out with a negative margin: the dialog gives this button
         focus on open, and its ring would then sit on the rounded corner. */
      margin-top: calc(-1 * var(--spacing-4));
    }

    .dialog__close:focus-visible {
      outline: 2px solid currentcolor;
      outline-offset: 2px;
    }

    .dialog__body {
      font-size: var(--font-size-base);
      line-height: 1.4;
    }

    :host([full-bleed]) .dialog__body {
      flex: 1;
      min-height: 0;
      padding: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      dialog,
      dialog[open] {
        scale: 1;
      }

      dialog {
        transition:
          opacity var(--duration-medium) var(--easing-out),
          overlay var(--duration-medium) allow-discrete,
          display var(--duration-medium) allow-discrete;
      }
    }
  `;

  render() {
    return this.renderDialog({ part: "modal", className: "modal" });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-modal": AppModal;
  }
}
