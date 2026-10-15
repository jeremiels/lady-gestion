import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Where a row dragged out of `from` lands: past every other row whose middle
 * it has crossed. `middles` are the rows' vertical middles as the drag began,
 * `middle` is the dragged row's own now — both in the same coordinates.
 */
export const dropIndex = (
  middles: readonly number[],
  from: number,
  middle: number,
): number =>
  middles.filter((other, index) => index !== from && other < middle).length;

/** px from the viewport's top or bottom edge at which the page starts scrolling. */
const SCROLL_EDGE = 64;
/** px scrolled per frame at the very edge — less further in. */
const SCROLL_SPEED = 12;

/**
 * The bottom of the area a row can be dragged over: above the fixed nav bar,
 * which covers the end of the page.
 */
const usableBottom = (): number => {
  const nav = document.querySelector(".navigation");
  const top = nav?.getBoundingClientRect().top;
  return top !== undefined && top > 0 ? top : innerHeight;
};

type Drag = {
  pointerId: number;
  handle: HTMLElement;
  from: number;
  to: number;
  rows: HTMLElement[];
  middles: number[];
  /** How far the other rows move to make room: the dragged row and one gap. */
  shift: number;
  startY: number;
  startScroll: number;
  clientY: number;
  frame: number;
};

/**
 * Reordering a list by dragging a row's handle — Pointer Events, so a finger,
 * a mouse and a pen all work the same way, with no library.
 *
 * Only the handle starts a drag: it carries `touch-action: none`, so the rest
 * of the row, and the page around it, still scrolls under a finger. The row
 * follows the pointer; the rows it passes slide out of its way; letting go
 * hands `onMove(from, to)` to the host, which reorders its data, and the row
 * settles into the slot it was rendered in. Esc, or the browser taking the
 * pointer back, puts everything where it was.
 *
 * Near the top of the viewport, or just above the nav bar, the page scrolls,
 * so a row can be taken further than one screen.
 *
 * The host draws the list; this only moves its rows with `transform` while
 * the finger is down, and leaves no inline style behind once they settle.
 * The keyboard path — ↑/↓ on a focused handle — is the host's: it is a plain
 * `onMove` with no motion to drive.
 */
export class DragReorder implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #rows: () => HTMLElement[];
  readonly #onMove: (from: number, to: number) => void;
  #drag: Drag | null = null;

  constructor(
    host: ReactiveControllerHost,
    options: {
      /** The list's rows, in their current order. */
      rows: () => HTMLElement[];
      onMove: (from: number, to: number) => void;
    },
  ) {
    this.#host = host;
    this.#rows = options.rows;
    this.#onMove = options.onMove;
    host.addController(this);
  }

  /** The index being dragged, or `null`. */
  get dragging(): number | null {
    return this.#drag?.from ?? null;
  }

  hostDisconnected() {
    this.#cancel();
  }

  /** Bind to the handle's `pointerdown`, with the row's index. */
  start(event: PointerEvent, index: number): void {
    if (this.#drag || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const handle = event.currentTarget as HTMLElement;
    const rows = this.#rows();
    const row = rows[index];
    if (!row) return;

    event.preventDefault();
    // Synthetic pointers in tests, and a pointer already gone, refuse capture;
    // the drag still works, it only stops following outside the handle.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // See above.
    }

    const rects = rows.map((one) => one.getBoundingClientRect());
    const next = rects[index + 1] ?? rects[index - 1];
    const gap = next
      ? Math.max(
          0,
          next.top > rects[index]!.top
            ? next.top - rects[index]!.bottom
            : rects[index]!.top - next.bottom,
        )
      : 0;

    this.#drag = {
      pointerId: event.pointerId,
      handle,
      from: index,
      to: index,
      rows,
      middles: rects.map((rect) => rect.top + rect.height / 2),
      shift: rects[index]!.height + gap,
      startY: event.clientY,
      startScroll: scrollY,
      clientY: event.clientY,
      frame: 0,
    };

    row.dataset.dragging = "";
    for (const other of rows) {
      if (other !== row) other.dataset.dragShifting = "";
    }
    handle.addEventListener("pointermove", this.#onPointerMove);
    handle.addEventListener("pointerup", this.#onPointerUp);
    handle.addEventListener("pointercancel", this.#onPointerCancel);
    addEventListener("keydown", this.#onKeyDown);
    this.#drag.frame = requestAnimationFrame(this.#autoScroll);
    this.#host.requestUpdate();
  }

  #onPointerMove = (event: PointerEvent) => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientY = event.clientY;
    this.#follow();
  };

  /** Moves the dragged row under the pointer and the others out of its way. */
  #follow() {
    const drag = this.#drag;
    if (!drag) return;
    const offset = drag.clientY - drag.startY + (scrollY - drag.startScroll);
    drag.to = dropIndex(
      drag.middles,
      drag.from,
      drag.middles[drag.from]! + offset,
    );

    drag.rows.forEach((row, index) => {
      if (index === drag.from) {
        row.style.transform = `translateY(${offset}px)`;
        return;
      }
      const shift =
        drag.from < drag.to && index > drag.from && index <= drag.to
          ? -drag.shift
          : drag.to < drag.from && index >= drag.to && index < drag.from
            ? drag.shift
            : 0;
      row.style.transform = shift === 0 ? "" : `translateY(${shift}px)`;
    });
  }

  #autoScroll = () => {
    const drag = this.#drag;
    if (!drag) return;
    const bottom = usableBottom();
    const speed =
      drag.clientY < SCROLL_EDGE
        ? -SCROLL_SPEED * (1 - drag.clientY / SCROLL_EDGE)
        : drag.clientY > bottom - SCROLL_EDGE
          ? SCROLL_SPEED * (1 - (bottom - drag.clientY) / SCROLL_EDGE)
          : 0;
    if (speed !== 0) {
      scrollBy(0, Math.max(-SCROLL_SPEED, Math.min(SCROLL_SPEED, speed)));
      this.#follow();
    }
    drag.frame = requestAnimationFrame(this.#autoScroll);
  };

  #onPointerUp = (event: PointerEvent) => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    void this.#drop(drag);
  };

  #onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.#drag?.pointerId) this.#cancel();
  };

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.#drag) return;
    event.preventDefault();
    this.#cancel();
  };

  /** Stops listening; the rows keep whatever transform they were left with. */
  #release(): Drag | null {
    const drag = this.#drag;
    if (!drag) return null;
    this.#drag = null;
    cancelAnimationFrame(drag.frame);
    drag.handle.removeEventListener("pointermove", this.#onPointerMove);
    drag.handle.removeEventListener("pointerup", this.#onPointerUp);
    drag.handle.removeEventListener("pointercancel", this.#onPointerCancel);
    removeEventListener("keydown", this.#onKeyDown);
    try {
      drag.handle.releasePointerCapture(drag.pointerId);
    } catch {
      // Already released by the browser.
    }
    return drag;
  }

  /**
   * Hands the move to the host, then lets the row glide from where the finger
   * left it into the slot the host rendered it in — a FLIP: the others are
   * already where the new order puts them, so they only lose their transform.
   */
  async #drop(drag: Drag) {
    this.#release();
    const row = drag.rows[drag.from]!;
    const before = row.getBoundingClientRect().top;

    for (const one of drag.rows) {
      one.style.transition = "none";
      one.style.transform = "";
      delete one.dataset.dragShifting;
    }
    if (drag.to !== drag.from) this.#onMove(drag.from, drag.to);
    this.#host.requestUpdate();
    // The move travels up to whoever owns the data and back down as a new
    // order, one Lit update per level — all microtasks, so all done by the
    // next frame, and that frame is not painted before this measures it.
    await new Promise(requestAnimationFrame);

    const after = row.getBoundingClientRect().top;
    for (const one of drag.rows) one.style.transition = "";
    this.#settle(row, before - after);
  }

  /** Back where everything was, without telling the host anything moved. */
  #cancel() {
    const drag = this.#release();
    if (!drag) return;
    const row = drag.rows[drag.from]!;
    const before = row.getBoundingClientRect().top;

    // The others still carry their sliding transition, so they glide back.
    for (const one of drag.rows) one.style.transform = "";
    const after = row.getBoundingClientRect().top;
    this.#settle(row, before - after);
    setTimeout(() => {
      for (const one of drag.rows) delete one.dataset.dragShifting;
    }, 400);
    this.#host.requestUpdate();
  }

  /** Glides `row` from `offset` px away into its own place, then cleans up. */
  #settle(row: HTMLElement, offset: number) {
    const done = () => {
      row.style.transition = "";
      row.style.transform = "";
      delete row.dataset.dragging;
      delete row.dataset.settling;
    };
    if (
      Math.abs(offset) < 1 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      done();
      return;
    }

    row.style.transition = "none";
    row.style.transform = `translateY(${offset}px)`;
    row.dataset.settling = "";
    // Commit the starting position before the transition is turned back on.
    row.getBoundingClientRect();
    row.style.transition = "";
    row.style.transform = "";
    row.addEventListener("transitionend", done, { once: true });
    // A transition that never runs — the row hidden, or the page in the
    // background — sends no `transitionend`.
    setTimeout(done, 400);
  }
}
