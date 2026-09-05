import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { DialogElement } from "../../commons/dialog-element.ts";

const DRAG_CLOSE_DISTANCE = 120; // px dragged down before the sheet dismisses itself
/**
 * px/ms. Measured over the trailing `VELOCITY_WINDOW_MS`, not over the whole
 * gesture — a slow drag that ends in a flick has to read as a flick, which is
 * the whole reason this threshold exists alongside the distance one.
 */
const DRAG_CLOSE_VELOCITY = 0.11;
/**
 * How far back the velocity sample reaches — the minimum age of the sample
 * pointerup divides by, so the measured window lands in 100–200ms rather than
 * collapsing to whatever happened to be left of it. Long enough to survive a
 * jittery frame, short enough that only the end of the gesture counts.
 */
const VELOCITY_WINDOW_MS = 100;
/**
 * px. The asymptote an upward drag approaches but never reaches — the sheet
 * keeps answering the finger with steadily less travel, which is what tells the
 * user the edge is real. A hard clamp reads as a dropped gesture instead.
 */
const RUBBER_BAND_LIMIT = 96;

/** Rising resistance: 0 → 0, and `overshoot → ∞` → `RUBBER_BAND_LIMIT`. */
const rubberBand = (overshoot: number): number =>
  RUBBER_BAND_LIMIT * (1 - 1 / (overshoot / RUBBER_BAND_LIMIT + 1));

/**
 * Native-app-style bottom sheet built on <dialog>: top-layer stacking, a real
 * ::backdrop, focus trap and Esc-to-dismiss come from the platform for free.
 * Drag the handle down (or flick it) to dismiss, like a native sheet.
 */
@customElement("app-bottom-sheet")
export class AppBottomSheet extends DialogElement {
  constructor() {
    super("sheet");
  }

  /**
   * The pointer that owns the gesture, or `null` when no gesture is running.
   *
   * This is the whole of "am I dragging" — there used to be a `#dragging`
   * boolean beside it, set and cleared in lockstep, and every guard below tested
   * both. A pointer id is never `null` while a gesture is live, so the second
   * flag could only ever agree with this one, and two fields that must agree are
   * a state to get wrong rather than a state to read.
   */
  #dragPointerId: number | null = null;
  #dragStartY = 0;
  #dragDistance = 0;
  /**
   * Two trailing velocity samples, not one.
   *
   * A single sample is only refreshed once it is older than the window, so its
   * age at pointerup is anywhere in [0, `VELOCITY_WINDOW_MS`] — refresh two
   * milliseconds before the finger lifts and the release is measured over two
   * milliseconds, where one pixel of touch jitter reads as 0.5 px/ms and clears
   * the 0.11 threshold five times over. Keeping the previous sample means there
   * is always one at least a window old to divide by.
   */
  #sampleY = 0;
  #sampleTime = 0;
  #prevSampleY = 0;
  #prevSampleTime = 0;

  #onHandlePointerDown = (event: PointerEvent) => {
    // A second finger landing mid-drag would re-anchor `#dragStartY` on itself
    // and the sheet would jump to meet it. The gesture belongs to whichever
    // pointer started it until that pointer lifts.
    if (!this.dismissible || this.#dragPointerId !== null) return;
    this.#dragPointerId = event.pointerId;
    this.#dragStartY = event.clientY;
    this.#dragDistance = 0;
    this.#sampleY = event.clientY;
    this.#sampleTime = performance.now();
    this.#prevSampleY = event.clientY;
    this.#prevSampleTime = this.#sampleTime;
    this.dialogEl?.classList.add("sheet--dragging");
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  #onHandlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;

    const offset = event.clientY - this.#dragStartY;
    this.#dragDistance = offset >= 0 ? offset : -rubberBand(-offset);

    // Age the current sample into the previous slot rather than dropping it, so
    // pointerup always has one to divide by that is at least a window old. What
    // it reads is then the last 100–200ms of the gesture — never the last two.
    const now = performance.now();
    if (now - this.#sampleTime > VELOCITY_WINDOW_MS) {
      this.#prevSampleY = this.#sampleY;
      this.#prevSampleTime = this.#sampleTime;
      this.#sampleY = event.clientY;
      this.#sampleTime = now;
    }

    if (this.dialogEl)
      this.dialogEl.style.transform = `translateY(${this.#dragDistance}px)`;
  };

  #onHandlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;
    const distance = this.#endDrag();

    // Prefer the older sample: the newer one can be microseconds old, and
    // dividing a pixel of jitter by that is what turns a settled finger into a
    // flick. Falling back to the newer one covers a gesture too short to have
    // aged a sample yet, where both slots still hold the pointerdown position.
    const now = performance.now();
    const stale = now - this.#prevSampleTime >= VELOCITY_WINDOW_MS;
    const sampleY = stale ? this.#prevSampleY : this.#sampleY;
    const sampleTime = stale ? this.#prevSampleTime : this.#sampleTime;

    const elapsed = now - sampleTime || 1;
    // Signed, so an upward flick can never dismiss no matter how fast it is.
    const velocity = (event.clientY - sampleY) / elapsed;
    if (distance > DRAG_CLOSE_DISTANCE || velocity > DRAG_CLOSE_VELOCITY) {
      this.close();
    }
  };

  /**
   * The platform took the gesture away — a system edge-swipe, an incoming call,
   * the pointer being cancelled out from under us.
   *
   * It shares the teardown with pointerup and deliberately not the decision: a
   * cancelled gesture has to spring back, never commit. Routing cancel straight
   * into the up handler dismissed any sheet that happened to be more than
   * `DRAG_CLOSE_DISTANCE` down when the interruption arrived, which reads as the
   * app closing the sheet on its own.
   */
  #onHandlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;
    this.#endDrag();
  };

  /** Releases the gesture and lets the sheet transition home. Returns how far it got. */
  #endDrag(): number {
    this.#dragPointerId = null;
    // Class first, then transform: dropping `sheet--dragging` restores the
    // transition, so clearing the inline transform animates back instead of
    // snapping.
    this.dialogEl?.classList.remove("sheet--dragging");
    if (this.dialogEl) this.dialogEl.style.transform = "";

    const distance = this.#dragDistance;
    this.#dragDistance = 0;
    return distance;
  }

  static componentStyles = css`
    :host {
      display: contents;
      /* Full-height travel, so the sheet runs on the slow token where the
         modal's scale-in uses the medium one. */
      --dialog-duration: var(--duration-slow);
    }

    dialog {
      margin: 0;
      padding: 0;
      border: none;
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      max-width: 32rem;
      margin-inline: auto;
      max-height: min(85dvh, 45rem);
      background-color: var(--color-page);
      border-radius: var(--radius-24) var(--radius-24) 0 0;
      box-shadow: 0 -8px 32px rgb(0 0 0 / 16%);
      display: none;
      flex-direction: column;
      overflow: hidden;
      transform: translateY(100%);
      opacity: 0;
      transition:
        transform var(--duration-slow) var(--easing-sheet),
        opacity var(--duration-slow) var(--easing-sheet),
        overlay var(--duration-slow) allow-discrete,
        display var(--duration-slow) allow-discrete;
    }

    dialog.sheet--dragging {
      transition: none;
    }

    dialog[open] {
      display: flex;
      transform: translateY(0);
      opacity: 1;
    }

    @starting-style {
      dialog[open] {
        transform: translateY(100%);
        opacity: 0;
      }
    }

    /* And the exit half, where overlay cannot hold the sheet in the top layer
       long enough for the closed-state rule above to be seen. This is also what
       a drag-dismiss lands in: endDrag() clears the inline transform first, so
       the sheet carries on down from wherever the finger left it. */
    dialog[open][data-closing] {
      transform: translateY(100%);
      opacity: 0;
    }

    .sheet__handle {
      display: flex;
      justify-content: center;
      flex-shrink: 0;
      padding: var(--spacing-12) 0 var(--spacing-8);
      touch-action: none;
      cursor: grab;
    }

    .sheet__handle:active {
      cursor: grabbing;
    }

    .sheet__grabber {
      width: 2.5rem;
      height: 0.25rem;
      border-radius: var(--radius-pill);
      background-color: var(--color-brown-light);
    }

    .dialog__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-12);
      flex-shrink: 0;
      padding: 0 var(--spacing-20) var(--spacing-12);
    }

    .dialog__title {
      font-size: 1rem;
      line-height: 1.5rem;
      font-weight: 700;
      color: var(--font-color);
    }

    .dialog__close {
      color: var(--color-brown-middle);
    }

    .dialog__close:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      dialog,
      dialog[open],
      dialog[open][data-closing] {
        transform: none;
      }

      dialog {
        transition:
          opacity var(--duration-medium) var(--easing-sheet),
          overlay var(--duration-medium) allow-discrete,
          display var(--duration-medium) allow-discrete;
      }
    }
  `;

  render() {
    return this.renderDialog({
      part: "sheet",
      className: "sheet",
      // The one thing a sheet has and a modal does not: a grab handle above the
      // header, which is also the drag target.
      leading: html`
        <div
          class="sheet__handle"
          part="handle"
          @pointerdown=${this.#onHandlePointerDown}
          @pointermove=${this.#onHandlePointerMove}
          @pointerup=${this.#onHandlePointerUp}
          @pointercancel=${this.#onHandlePointerCancel}
        >
          <span class="sheet__grabber"></span>
        </div>
      `,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-bottom-sheet": AppBottomSheet;
  }
}
