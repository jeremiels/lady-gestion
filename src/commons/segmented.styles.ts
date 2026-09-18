import { css } from "lit";
import { slidingSelectionStyles } from "./sliding-selection.styles.ts";

/**
 * The look of a segmented row: a pill-shaped track, one segment per option, the
 * sliding pill under the current one.
 *
 * Shared by `app-segmented` (pick a value — a radio group of buttons) and
 * `app-subnav` (pick a page — a nav of links). Same pixels, different
 * semantics: they stay two components so neither has to fake the other's
 * roles, and this module is what keeps them looking identical.
 *
 * Selectors key on `.segmented__option--current` rather than on an ARIA
 * attribute, because the two components spell "current" differently
 * (`aria-checked` vs `aria-current`).
 */
export const segmentedStyles = [
  // The shared pill first, so the rules below still win at equal specificity.
  slidingSelectionStyles,
  css`
    :host {
      display: inline-flex;
    }

    .segmented {
      display: inline-flex;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      border-radius: var(--radius-pill);
      background: var(--color-brown-light-bg);
    }

    .segmented__option {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.25rem;
      padding: 0;
      border: none;
      border-radius: var(--radius-pill);
      background: transparent;
      font: inherit;
      color: var(--color-brown-light);
      text-decoration: none;
      cursor: pointer;
      /* The ink is on the same clock as the pill that travels under it —
         at --duration-fast the incoming label finished darkening 50ms
         before the pill arrived beneath it. */
      transition:
        background-color var(--duration-fast) ease,
        color var(--duration-medium) var(--easing-standard);
    }

    /* A word cannot live in the fixed square an icon sits in. */
    .segmented__option--text {
      width: auto;
      padding-inline: var(--spacing-16);
      font-size: var(--font-size-sm);
      font-weight: 600;
      white-space: nowrap;
    }

    .segmented__option--current {
      background: var(--color-white);
      color: var(--color-brown-dark);
    }

    /*
     * Where the pill exists it is the selected surface, and this one has to
     * go: the segment being left keeps its own background for as long as it
     * takes to fade, which is a second white shape sitting in the path of the
     * one still travelling. The colour above stays — it carries the state on
     * both paths.
     */
    @supports (anchor-name: --sliding-selection) {
      .segmented__option--current {
        background: transparent;
      }
    }

    .segmented__option:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  `,
];
