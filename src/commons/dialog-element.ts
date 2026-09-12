import { css, html, nothing, type TemplateResult } from "lit";
import { property, query } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { BaseElement } from "./base-element.ts";
import { ModalDialog } from "./controllers/modal-dialog.ts";

import "../components/app-icon/app-icon.ts";

/**
 * What `app-modal` and `app-bottom-sheet` are before they differ.
 *
 * `ModalDialog` already took the JS plumbing — `open` to `showModal()` and back
 * out as an event, the stashed close reason, backdrop detection. What it left
 * behind was copied verbatim in both components anyway: the same four
 * properties, the same `show()`/`close()` pair, the same `@query('dialog')`, the
 * same `::backdrop` transition, and the same header markup — hgroup, title,
 * optional description, `dismissible`-gated close button with `aria-label="Fermer"`
 * — differing in nothing but a BEM prefix. The controller's own docblock said a
 * third dialog primitive should take it rather than copy either component; a
 * third one would still have hand-copied all of the above, because none of it
 * was anywhere to take it from.
 *
 * **The BEM prefix was the only thing forcing the copy**, so it is gone: both
 * now render `dialog__header` / `dialog__title` / `dialog__close` and style
 * those class names from their own stylesheets. The `part=` names never differed
 * in the first place, which is what made this safe — a consumer reaching in
 * through `::part(title)` sees exactly what it saw before.
 *
 * What each component still owns is everything that is genuinely its own: the
 * `<dialog>`'s geometry and entry animation, the layout of the header it is
 * handed, the sheet's drag-to-dismiss and `app-modal`'s `full-bleed`.
 */
export abstract class DialogElement extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) heading = "";
  /**
   * Optional line under the heading. Wired to `aria-describedby` rather than
   * folded into the title, so a screen reader announces the dialog's name and
   * its explanation as separate things.
   */
  @property({ type: String }) description = "";
  /** When false, the close button, backdrop click and Esc are all inert. */
  @property({ type: Boolean }) dismissible = true;

  @query("dialog") protected dialogEl?: HTMLDialogElement;

  /**
   * Everything from `open` to `showModal()` and back out as an event. It syncs
   * itself from `hostUpdated`, so no subclass needs an `updated()` for it.
   */
  protected readonly dialog: ModalDialog;

  /**
   * `name` prefixes the two events the controller dispatches — `'sheet'` gives
   * `sheet-open`/`sheet-close`, `'modal'` gives `modal-open`/`modal-close`.
   *
   * Taken as a constructor argument rather than read off an abstract accessor,
   * which is what a field initializer here would need and what TypeScript
   * rightly refuses: the subclass half of the object does not exist yet at that
   * point. `super('modal')` is one line and says the same thing out loud.
   */
  constructor(name: string) {
    super();
    this.dialog = new ModalDialog(this, () => this.dialogEl, name);
  }

  show() {
    this.open = true;
  }

  close() {
    this.dialog.close();
  }

  /**
   * The chrome both dialogs draw, around whatever they slot in.
   *
   * `leading` is content before the header — the bottom sheet's drag handle, and
   * nothing at all for a modal. Everything else here was identical in both
   * components, comment for comment.
   */
  protected renderDialog(options: {
    /** `::part` name for the dialog element. Public API, so it stays per-component. */
    part: string;
    /** The component's own block class, which its stylesheet keys off. */
    className: string;
    leading?: unknown;
  }): TemplateResult {
    return html`
      <dialog
        part=${options.part}
        class=${options.className}
        aria-labelledby="dialog-title"
        aria-describedby=${ifDefined(this.description ? "dialog-description" : undefined)}
        @click=${this.dialog.onBackdropClick}
        @cancel=${this.dialog.onCancel}
        @close=${this.dialog.onNativeClose}
      >
        ${options.leading ?? nothing}
        <header class="dialog__header" part="header">
          <hgroup class="dialog__heading">
            <h2 class="dialog__title" part="title" id="dialog-title">
              ${this.heading}
            </h2>
            ${
              this.description
                ? html`<p
                    class="dialog__description"
                    part="description"
                    id="dialog-description"
                  >
                    ${this.description}
                  </p>`
                : nothing
            }
          </hgroup>
          ${
            this.dismissible
              ? html`
                  <button
                    type="button"
                    class="dialog__close"
                    part="close-button"
                    aria-label="Fermer"
                    @click=${() => this.close()}
                  >
                    <app-icon icon="close"></app-icon>
                  </button>
                `
              : nothing
          }
        </header>
        <div class="dialog__body" part="body">
          <slot></slot>
        </div>
        <footer class="dialog__footer" part="footer">
          <slot name="footer"></slot>
        </footer>
      </dialog>
    `;
  }

  /**
   * The backdrop, and the rule that hides an unfilled footer.
   *
   * Both were verbatim in the two components apart from which duration token
   * they named, so that is the one thing left parameterised: a component sets
   * `--dialog-duration` on its own `:host` and the timing follows. The sheet
   * wants `--duration-slow` (it travels the full height of the screen), the
   * modal `--duration-medium`.
   *
   * `@starting-style` is here too, since it only restates the closed state the
   * transition above already describes. Each component still declares its *own*
   * entry animation — a slide up versus a scale in — which is the part that
   * actually differs.
   */
  static sharedStyles = css`
    :host {
      --dialog-duration: var(--duration-medium);
    }

    dialog::backdrop {
      background-color: rgb(0 0 0 / 0%);
      transition:
        background-color var(--dialog-duration) ease,
        overlay var(--dialog-duration) allow-discrete,
        display var(--dialog-duration) allow-discrete;
    }

    dialog[open]::backdrop {
      background-color: rgb(0 0 0 / 45%);
    }

    @starting-style {
      dialog[open]::backdrop {
        background-color: rgb(0 0 0 / 0%);
      }
    }

    /* The exit half, for platforms with no overlay support — see the closing
       note on ModalDialog. The dialog is still [open] while this plays, which is
       what keeps it in the top layer, so this has to out-specify the open-state
       rule above rather than simply follow it. */
    dialog[open][data-closing]::backdrop {
      background-color: rgb(0 0 0 / 0%);
    }

    .dialog__heading {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .dialog__description {
      margin: 0;
      font-size: 0.688rem;
      line-height: 1rem;
      color: var(--color-brown-light);
    }

    /* The skeleton only. Both dialogs draw the same button and colour it
       differently — the modal from currentcolor so full-bleed can turn it
       white, the sheet from the brown palette — so the colour and the focus
       ring stay with each of them. */
    .dialog__close {
      --icon-color: var(--color-brown-dark);
      appearance: none;
      border: none;
      background: var(--color-brown-light-bg);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border-radius: var(--radius-8);
      cursor: pointer;
    }

    @media (hover: hover) and (pointer: fine) {
      .dialog__close:hover {
        background-color: var(--color-brown-light-bg);
        color: var(--color-brown-dark);
      }
    }

    /* contain, not none: the body still gets its own overscroll glow at the
       ends, it just stops handing the leftover delta to the page behind.
       Without it a flick that runs out of body scrolls the document under the
       dialog — the half of "the page must not move" that the scroll lock in
       commons/scroll-lock.ts cannot cover, because the gesture starts on a
       scroller that is legitimately allowed to move. */
    .dialog__body {
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 var(--spacing-20) var(--spacing-20);
    }

    .dialog__footer {
      flex-shrink: 0;
      padding: var(--spacing-12) var(--spacing-20)
        calc(var(--spacing-20) + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--color-divider);
    }

    /* An empty footer slot must not draw its border or claim its padding. */
    .dialog__footer:not(:has(*)) {
      display: none;
    }
  `;
}
