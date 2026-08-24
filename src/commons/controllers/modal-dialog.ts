import type { ReactiveController, ReactiveElement } from 'lit';
import { lockScroll, unlockScroll } from '../scroll-lock.ts';

/** What a dialog host has to expose for this controller to drive it. */
export interface DialogHost extends ReactiveElement {
  /** The requested state. The controller drives the real `<dialog>` to match. */
  open: boolean;
  /** When false, backdrop click, Esc and the close button are all inert. */
  dismissible: boolean;
}

/**
 * The `<dialog showModal()>` machinery behind `app-modal` and
 * `app-bottom-sheet`.
 *
 * Both are built on a native modal dialog for the same reasons — top-layer
 * stacking, a real `::backdrop`, a focus trap and Esc-to-dismiss all come from
 * the platform — and both would otherwise carry a verbatim copy of the plumbing
 * that gets from a declarative `open` property to `showModal()`/`close()` and
 * back out as an event. The pieces that look trivial are the ones worth having
 * in one place:
 *
 * - **`open` is a request, not the truth.** The `<dialog>`'s own `open` is, so
 *   every transition is guarded against re-entering a state it is already in —
 *   calling `showModal()` on an open dialog throws.
 * - **Backdrop detection is `event.target === dialog`.** Clicking the
 *   `::backdrop` dispatches on the dialog element; clicks on the content
 *   dispatch on the content.
 * - **The page behind must not scroll.** `showModal()` makes the rest of the
 *   document inert, which blocks clicks and focus but *not* scrolling, so the
 *   lock is ours to take — see `commons/scroll-lock.ts`. This controller is the
 *   only thing that knows when a real `<dialog>` is showing, which is why it
 *   holds the lock rather than a CSS rule on the document: `event-sheet` and
 *   `document-viewer` both nest their dialog inside a shadow root, where a
 *   `html:has(app-modal[open])` rule cannot see it.
 *
 * A third dialog primitive should take this rather than copy either of them.
 */
export class ModalDialog implements ReactiveController {
  #host: DialogHost;
  #getDialog: () => HTMLDialogElement | undefined;
  #name: string;

  /**
   * `name` prefixes the two events this dispatches — `'sheet'` gives
   * `sheet-open`/`sheet-close`, `'modal'` gives `modal-open`/`modal-close`.
   */
  constructor(host: DialogHost, getDialog: () => HTMLDialogElement | undefined, name: string) {
    this.#host = host;
    this.#getDialog = getDialog;
    this.#name = name;
    host.addController(this);
  }

  /**
   * Drives the real `<dialog>` to match `open` after every host update.
   *
   * Runs unconditionally rather than behind a `changed.has('open')` check
   * because `sync()` is idempotent — it compares against the dialog's own
   * `open`, which is the actual state, and does nothing when the two already
   * agree. That keeps the whole of this out of the components' `updated()`.
   */
  hostUpdated() {
    this.sync();
  }

  /**
   * Releases the scroll lock if this dialog was still holding it.
   *
   * A dialog removed from the DOM while open never fires `close`, so without
   * this the page behind would stay locked with nothing left on screen to
   * explain why. `unlockScroll` is keyed on this instance and idempotent, so
   * calling it here when the dialog was already shut costs nothing.
   */
  hostDisconnected() {
    unlockScroll(this);
  }

  /** Opens or closes the dialog to match the host's `open` property. */
  sync() {
    const dialog = this.#getDialog();
    if (!dialog) return;

    if (this.#host.open && !dialog.open) {
      dialog.showModal();
      lockScroll(this);
      this.#dispatch('open');
    } else if (!this.#host.open && dialog.open) {
      dialog.close();
    }
  }

  /**
   * Closes the dialog. A no-op when it is not open, so a consumer can call it
   * defensively.
   */
  close() {
    const dialog = this.#getDialog();
    if (!dialog?.open) return;
    dialog.close();
  }

  // --- Handlers to bind on the <dialog> in the host's template ---

  /** `@close` — the native event, fired however the dialog was dismissed. */
  onNativeClose = () => {
    this.#host.open = false;
    unlockScroll(this);
    this.#dispatch('close');
  };

  /** `@cancel` — Esc, fired before the native close so it can be blocked. */
  onCancel = (event: Event) => {
    if (!this.#host.dismissible) event.preventDefault();
  };

  /** `@click` — only a click on the dialog element itself is the backdrop. */
  onBackdropClick = (event: MouseEvent) => {
    if (this.#host.dismissible && event.target === this.#getDialog()) {
      this.close();
    }
  };

  #dispatch(kind: 'open' | 'close') {
    // Composed, so it crosses the host's shadow boundary and a consumer's
    // listener on the element actually fires — the same rule every field's
    // re-dispatched change event follows.
    this.#host.dispatchEvent(new CustomEvent(`${this.#name}-${kind}`, { bubbles: true, composed: true }));
  }
}
