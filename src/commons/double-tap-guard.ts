/**
 * Backstop for Safari's double-tap-to-zoom, for the gap `touch-action:
 * manipulation` doesn't reliably close.
 *
 * `layers/reset.css` and `layers/component-reset.css` already declare
 * `touch-action: manipulation` on `html` and on every component's `:host` (see
 * `reset.styles.ts`), which should be enough on paper: the *used* touch-action
 * is the intersection of an element's own value with every ancestor's,
 * computed over the flat tree, so a `:host` declaration ought to reach across
 * its own shadow boundary same as any other ancestor. In practice Safari does
 * not always honour that intersection *across* a shadow boundary — the miss
 * shows up as an occasional zoom on a tap landing near a shadow-root edge,
 * between two components, which is exactly the "random, between components"
 * shape of bug no additional CSS rule can chase: the CSS is already applied
 * everywhere there is a selector to put it on.
 *
 * This listens where no shadow boundary can hide from it. `touchend` is a
 * composed event, so it bubbles to `document` from inside every shadow root
 * regardless of nesting depth. If two land on the same element within
 * Safari's own double-tap window, the second is the one it would zoom for —
 * pre-empted here before it gets the chance. The same-element check is what
 * keeps two quick taps on two different controls — a real double-tap-shaped
 * interaction, just not aimed at one target — from losing their second tap.
 */

const DOUBLE_TAP_WINDOW_MS = 300;

let lastTouchEnd = 0;
let lastTarget: EventTarget | null = null;

export const initDoubleTapGuard = (): void => {
  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now();
      if (event.target === lastTarget && now - lastTouchEnd <= DOUBLE_TAP_WINDOW_MS) {
        event.preventDefault();
      }
      lastTouchEnd = now;
      lastTarget = event.target;
    },
    { passive: false },
  );
};
