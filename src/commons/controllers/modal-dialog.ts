import type { ReactiveController, ReactiveElement } from 'lit';
import { lockScroll, unlockScroll } from '../scroll-lock.ts';

/**
 * How long to wait for an exit animation before closing anyway.
 *
 * A dialog left open because a transition never reported finishing is a far
 * worse failure than one that closes a little abruptly, so the wait is bounded.
 * Well above the slowest dialog duration (`--duration-slow`, 0.32s).
 */
const EXIT_TIMEOUT_MS = 1000;

/**
 * Waits out whatever the closing attribute just started.
 *
 * `subtree: true` so the `::backdrop`'s own fade is included — it is a
 * pseudo-element of the dialog, and closing while it is still dark would flash
 * the page behind.
 */
async function exitAnimations(dialog: HTMLDialogElement): Promise<void> {
  // Finding the transitions the closing attribute just described is fiddlier
  // than it looks, and getting it wrong reintroduces the exact bug this function
  // exists to fix — an instant close with the animation never seen.
  //
  // Reading a computed value commits the style change, but the `Animation`
  // objects are not in `getAnimations()` yet. A single `requestAnimationFrame`
  // is no better: its callback runs *before* the frame's style update. Only
  // after a frame has actually been produced are the transitions there to await,
  // which is what the second frame waits for. Measured, not assumed: the suite
  // read zero animations at both earlier points and two shortly after.
  void getComputedStyle(dialog).opacity;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const finished = dialog.getAnimations({ subtree: true }).map((animation) => animation.finished);

  await Promise.race([
    Promise.allSettled(finished),
    new Promise((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS)),
  ]);
}

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
 *
 * **Closing is two paths, because `overlay` is Chromium-only.** The declarative
 * exit both components describe in CSS — `transition: overlay … allow-discrete`
 * — is what keeps a closing dialog in the top layer long enough to animate out.
 * No Safari supports it, at any version, so there `close()` drops the dialog out
 * of the top layer on the spot and the exit is never seen: sheets that slide up
 * snap shut. Where the property is missing this drives the exit itself, holding
 * the dialog open under a `data-closing` attribute until the transitions it
 * starts have finished. Chromium keeps the native path untouched.
 */
export class ModalDialog implements ReactiveController {
  /**
   * Whether the platform can animate a dialog out on its own.
   *
   * A static rather than a module constant so the suite can flip it: Chromium
   * is the only engine the browser tests run on and it is the only engine that
   * answers `true`, so the animated path would otherwise ship uncovered — the
   * same gap, and the same fix, as `Router`'s `forceHistoryFallback`.
   */
  static supportsOverlay = typeof CSS !== 'undefined' && CSS.supports('overlay', 'auto');

  #host: DialogHost;
  #getDialog: () => HTMLDialogElement | undefined;
  #name: string;
  /** Set while a self-driven exit is playing. Always false on Chromium. */
  #exiting = false;

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

    if (this.#host.open) {
      // Re-opened while an exit was still playing: call the exit off and let
      // the open-state styles carry the dialog back where it came from, rather
      // than letting it finish closing and immediately re-open.
      if (this.#exiting) {
        this.#cancelExit(dialog);
        return;
      }

      if (!dialog.open) {
        dialog.showModal();
        lockScroll(this);
        this.#dispatch('open');
      }
      return;
    }

    // `#exiting` guards re-entry: `hostUpdated` calls this after every update,
    // and an exit in flight is already on its way to the same place.
    if (dialog.open && !this.#exiting) this.#beginClose(dialog);
  }

  /**
   * Closes the dialog. A no-op when it is not open, so a consumer can call it
   * defensively.
   */
  close() {
    const dialog = this.#getDialog();
    if (!dialog?.open || this.#exiting) return;
    this.#beginClose(dialog);
  }

  /**
   * Closes now, or plays the exit first where the platform cannot.
   *
   * The single funnel every close path reaches — the host's `open` going false,
   * the backdrop, the close button, Esc — so none of them can be the one that
   * forgets to animate.
   */
  #beginClose(dialog: HTMLDialogElement) {
    if (ModalDialog.supportsOverlay) {
      dialog.close();
      return;
    }

    // The host's requested state has to move *now*, before the exit begins.
    //
    // On the Chromium path `open` is set false by `onNativeClose`, which fires
    // the moment `close()` does. Here the real close is a few hundred ms away,
    // and every close that does not come from the host — Esc, the backdrop, the
    // close button — leaves `open` true for that whole window. Any re-render
    // landing in it would reach `sync()`, read `open === true` with an exit in
    // flight, take that for a re-open and call the exit off: the dialog would
    // sit there open with nothing left to close it.
    this.#host.open = false;
    void this.#exit(dialog);
  }

  async #exit(dialog: HTMLDialogElement) {
    this.#exiting = true;
    // The components' stylesheets key their exit state off this. It sits
    // alongside `[open]` rather than replacing it, which is the whole trick:
    // the dialog is still open, so it is still in the top layer and still
    // painting, while the transition runs.
    dialog.dataset.closing = '';

    await exitAnimations(dialog);

    // Re-opened while we waited. `sync()` has already cleared both the flag and
    // the attribute, and the dialog is meant to stay on screen.
    if (!this.#exiting) return;

    this.#exiting = false;
    delete dialog.dataset.closing;
    // The native `close` event this fires is what tells the host, releases the
    // scroll lock and dispatches `…-close`, exactly as on the Chromium path —
    // only later, once there is nothing left to look at.
    dialog.close();
  }

  #cancelExit(dialog: HTMLDialogElement) {
    this.#exiting = false;
    delete dialog.dataset.closing;
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
    if (!this.#host.dismissible) {
      event.preventDefault();
      return;
    }

    // Esc is the one close the platform performs for us, so where the exit has
    // to be driven by hand it must be taken over as well — otherwise Esc is the
    // single way out of a dialog that still snaps shut.
    if (!ModalDialog.supportsOverlay) {
      event.preventDefault();
      this.close();
    }
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
