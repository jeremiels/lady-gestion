import { css } from "lit";

/**
 * A background that travels to whichever child is currently selected, rather
 * than disappearing from one and reappearing on another.
 *
 * Two classes, no extra DOM node — the moving pill is the container's
 * `::after`:
 *
 * - `.sliding-selection` on the row;
 * - `.sliding-selection__active` on the selected child, moved as the selection
 *   moves. That is the whole API: nothing measures a box, nothing runs on
 *   `updated()`. The browser reads the anchor's four edges and interpolates
 *   between the old ones and the new ones by itself.
 *
 * Composed into a component's own `componentStyles` rather than shipped in
 * `component-utilities.css`, because only the handful of components with a row
 * of mutually exclusive items want it and no document CSS does. `css` caches
 * the result, so every consumer adopts the same `CSSStyleSheet` by reference.
 * Put it *first* in the array so a component can still override at equal
 * specificity.
 *
 * Tune per consumer with `--sliding-selection-background` / `-radius` /
 * `-duration` / `-easing`; the defaults are the segmented control's.
 *
 * The anchor name is scoped to a tree, so one shadow root per consumer already
 * keeps two instances apart.
 */
export const slidingSelectionStyles = css`
  /*
   * Anchor positioning sits *above* the browser floor on two engines out of
   * three — Chrome 125, but Safari 26 and Firefox 147 (the floor is Safari
   * 18.2 / Firefox 137). Everything below is therefore an enhancement: without
   * it the consumer's own [selected] background rule stands and the control
   * looks exactly as it did before this file existed. See "Browser floor" in
   * AGENTS.md.
   */
  @supports (anchor-name: --sliding-selection) {
    .sliding-selection {
      position: relative;
      /* Shadow DOM already scopes the name per instance; this is what keeps two
         rows apart if the pattern is ever used in the light DOM. */
      anchor-scope: --sliding-selection;
    }

    .sliding-selection__active {
      anchor-name: --sliding-selection;
    }

    /* Lifted so the pill passes *behind* them: an absolutely positioned
       ::after paints above non-positioned siblings, and mid-travel it crosses
       every item between the two ends. */
    .sliding-selection > * {
      position: relative;
      z-index: 1;
    }

    /*
     * :has() because the pill has nowhere to be until something is selected.
     * With no element carrying the anchor name the anchor() calls are invalid
     * at computed-value time, the insets fall back to auto, and the pill
     * paints as a stray rectangle in the container's top-left corner —
     * app-segmented starts with an empty value, so this is a state that
     * really occurs.
     */
    .sliding-selection:has(.sliding-selection__active)::after {
      content: "";
      position: absolute;
      z-index: 0;
      position-anchor: --sliding-selection;
      /* All four sides, so the pill takes the anchor's size as well as its
         place — the text segments "Mois" and "Année" are not the same width. */
      top: anchor(top);
      right: anchor(right);
      bottom: anchor(bottom);
      left: anchor(left);
      border-radius: var(--sliding-selection-radius, var(--radius-pill));
      background: var(--sliding-selection-background, var(--color-white));
      /* A transition rather than keyframes or the WAAPI: it retargets from
         wherever the pill currently is, so holding down an arrow key slides it
         on from mid-travel instead of restarting each time. */
      transition: inset
        var(--sliding-selection-duration, var(--duration-medium))
        var(--sliding-selection-easing, var(--easing-standard));
    }

    /* The travel *is* the animation here, so there is no gentler variant to
       keep — the pill snaps and the consumer's colour change carries the state
       on its own. Declared once here rather than in each consumer. */
    @media (prefers-reduced-motion: reduce) {
      .sliding-selection:has(.sliding-selection__active)::after {
        transition: none;
      }
    }
  }
`;
