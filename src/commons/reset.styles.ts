import { css, unsafeCSS } from 'lit';
import componentResetCSSText from '../styles/layers/component-reset.css?inline';
import componentUtilitiesCSSText from '../styles/layers/component-utilities.css?inline';

/**
 * The shared reset every `BaseElement` prepends to its own styles.
 *
 * Pulls `component-reset.css`, not the document `reset.css`: the latter's
 * `:root`, `html` and `body` rules can never match inside a shadow root, so
 * shipping them into every component was dead weight and obscured which rules a
 * component actually gets.
 *
 * `css` caches the `CSSResult`, so this is one `CSSStyleSheet` adopted by
 * reference into every shadow root rather than a copy per component.
 */
export const resetStyles = css`${unsafeCSS(componentResetCSSText)}`;

/**
 * The shared utilities every `BaseElement` appends *after* its own styles.
 *
 * A separate export from `resetStyles` because the two have to sit on opposite
 * sides of a component's own rules — merging them would break the ordering that
 * makes a utility win inside a shadow root.
 */
export const utilityStyles = css`${unsafeCSS(componentUtilitiesCSSText)}`;
