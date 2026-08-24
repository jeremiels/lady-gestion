import { css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import { UPDATE_READY_EVENT, applyUpdate } from '../../pwa/index.ts';

/**
 * Once a service worker caches the app, a new deploy is invisible until the
 * user is told about it — this is that prompt. It sits above the nav bar and
 * can be dismissed; the update then applies on its own the next time the app
 * is opened from scratch.
 *
 * **The toast is a popover, not a `z-index` layer.** It used to be a plain
 * fixed element at `z-index: 10`, which loses to anything in the top layer —
 * and both dialog primitives put themselves there via `showModal()`. An update
 * landing while the event sheet was open drew the toast *behind* the sheet's
 * backdrop, so the one moment the prompt matters most was the one moment it
 * could not be seen. `popover="manual"` promotes it to the top layer too, and
 * because it is promoted last it paints above a dialog that was already open.
 *
 * `manual` rather than `auto`: an `auto` popover light-dismisses on any outside
 * click, and a stray tap should not throw away the only notice the user gets
 * that they are running an old build.
 */
@customElement('app-update-toast')
export class AppUpdateToast extends BaseElement {
  @state() private visible = false;

  @query('.toast') private toastEl?: HTMLElement;

  static componentStyles = css`
    :host {
      display: contents;
    }

    /*
     * The live region itself, always in the DOM and never hidden — see the note
     * on render(). It generates no box of its own: the toast inside it is
     * position-fixed, so this leaves nothing behind in normal flow.
     */
    .toast-region {
      display: contents;
    }

    .toast {
      /* Undo the UA popover styles: a centred inset:0 + margin:auto, a solid
         border, a Canvas background and width:fit-content. */
      inset: auto;
      margin: 0;
      border: none;
      width: auto;
      height: auto;
      overflow: visible;

      position: fixed;
      bottom: calc(var(--nav-bar-height) + var(--spacing-12) + env(safe-area-inset-bottom, 0px));
      left: var(--spacing-16);
      right: var(--spacing-16);

      display: flex;
      align-items: center;
      gap: var(--spacing-12);
      padding: var(--spacing-12) var(--spacing-16);
      border-radius: var(--radius-16);
      background: var(--color-brown-dark);
      color: var(--color-white);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);

      /* Same entry pattern as the two dialogs: the settled state here, the
         pre-open state in @starting-style, and overlay/display listed as
         allow-discrete so the element stays painted while it animates. */
      opacity: 1;
      translate: 0 0;
      transition:
        opacity var(--duration-medium) var(--easing-out),
        translate var(--duration-medium) var(--easing-out),
        overlay var(--duration-medium) allow-discrete,
        display var(--duration-medium) allow-discrete;
    }

    @starting-style {
      .toast:popover-open {
        opacity: 0;
        translate: 0 var(--spacing-16);
      }
    }

    .toast__text {
      flex: 1;
      font-size: var(--font-size-sm);
    }

    .toast__button {
      appearance: none;
      border: none;
      border-radius: var(--radius-pill);
      padding: var(--spacing-6) var(--spacing-12);
      background: var(--color-white);
      color: var(--color-brown-dark);
      font: inherit;
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .toast__dismiss {
      appearance: none;
      border: none;
      background: none;
      padding: var(--spacing-4);
      color: inherit;
      font: inherit;
      cursor: pointer;
      opacity: 0.7;
    }

    .toast__button:focus-visible,
    .toast__dismiss:focus-visible {
      outline: 2px solid var(--color-white);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .toast {
        transition:
          opacity var(--duration-medium) var(--easing-out),
          overlay var(--duration-medium) allow-discrete,
          display var(--duration-medium) allow-discrete;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(UPDATE_READY_EVENT, this.#onUpdateReady);
  }

  disconnectedCallback() {
    window.removeEventListener(UPDATE_READY_EVENT, this.#onUpdateReady);
    super.disconnectedCallback();
  }

  #onUpdateReady = () => {
    this.visible = true;
  };

  protected updated() {
    // A popover is inert until something opens it, and the element only exists
    // on the tick `visible` turned true — so this is the open call, not a sync.
    const toast = this.toastEl;
    if (toast && !toast.matches(':popover-open')) toast.showPopover();
  }

  render() {
    // `role="status"` lives on the wrapper, which is always rendered, rather
    // than on the toast itself. A live region has to be in the accessibility
    // tree *before* its contents change or the change is not announced —
    // inserting a fully-formed `role="status"` element, as this did before,
    // typically says nothing at all. Now the region is established at first
    // paint and the toast is a genuine insertion into it.
    //
    // The cost is the exit animation: dismissing removes the element rather
    // than transitioning it out. That is the right trade — the user just asked
    // for it gone, and keeping it mounted to animate would mean holding a timer
    // whose only job is to delay a removal nobody is waiting to see.
    return html`
      <div class="toast-region" role="status">
        ${this.visible
          ? html`
              <div class="toast" popover="manual">
                <span class="toast__text">Une nouvelle version est disponible.</span>
                <button class="toast__button" type="button" @click=${applyUpdate}>Actualiser</button>
                <button
                  class="toast__dismiss"
                  type="button"
                  aria-label="Ignorer"
                  @click=${() => (this.visible = false)}
                >
                  ✕
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-update-toast': AppUpdateToast;
  }
}
