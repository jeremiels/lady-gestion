import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import { appHref } from '../../commons/base-path.ts';
import type { ThemeMeta } from '../../theme/theme.ts';
import { ICON_NAMES, SPRITE_PATH, isIconName, type IconName } from './icons.ts';

/**
 * Fills the two custom properties below from any theme, for `styleMap`.
 *
 * Exported because the *names* are this component's contract while the theme
 * belongs to whichever taxonomy the caller is rendering — so composing them is
 * the call site's job, and it reads the same for an event type as for a
 * document category:
 *
 *     style=${styleMap(iconStyle(eventType.theme(event.type)))}
 *
 * This replaced a generated `:host([event-type="..."])` rule per event
 * category. That gave one taxonomy a private shortcut through a general
 * component — and left the other, documents, passing custom properties by hand
 * because it had no such door. One door now, and this file no longer imports
 * the event taxonomy at all.
 */
export const iconStyle = (theme: ThemeMeta) => ({
  '--icon-color': theme.color,
  '--icon-background': theme.backgroundColor,
});

@customElement('app-icon')
export class AppIcon extends BaseElement {
  @property({ type: String })
  icon: IconName | '' = '';

  /**
   * Glyph size, any CSS length. Sets `--icon-size` rather than the host's
   * width/height — the host also carries padding, so sizing *it* squeezes the
   * SVG into whatever is left. Equivalent to setting `--icon-size` in CSS,
   * which is the preferred way when a stylesheet is already involved.
   */
  @property({ type: String })
  size: string | null = null;

  /** Draws the padded tile behind the glyph, without a theme to colour it. */
  @property({ type: Boolean, reflect: true })
  background = false;

  static componentStyles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-8);
      padding: var(--spacing-8);
      color: var(--icon-color, currentColor);
      background: var(--icon-background, transparent);
    }

    :host([background]) {
      --icon-background: var(--color-brown-middle);
    }

    svg {
      width: var(--icon-size, 1.25rem);
      height: var(--icon-size, 1.25rem);
      fill: currentColor;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if (!changed.has('size')) return;

    // The one property still written to the host, because a custom property is
    // the host's own API surface rather than a cascade override.
    if (this.size) this.style.setProperty('--icon-size', this.size);
    else this.style.removeProperty('--icon-size');
  }

  /**
   * Icon names are camelCase, matching the `ICON_NAMES` entries — one spelling,
   * so this takes the name as given and never normalises.
   *
   * Do not re-add kebab-case acceptance: it made the property type (`IconName`)
   * and the values templates actually write disagree, so every
   * `icon="chevron-left"` was a template type error only lit-plugin saw —
   * `tsc` does not look inside `html` templates.
   */
  render() {
    if (!isIconName(this.icon)) {
      // `''` is the legitimate "no icon" state and is not worth a warning.
      if (import.meta.env.DEV && this.icon) {
        console.warn(`Icône introuvable : "${this.icon}". Disponibles :`, ICON_NAMES);
      }
      return nothing;
    }

    // An external reference, so a glyph is fetched once and cached rather than
    // parsed out of a JS string per element. `currentColor` still resolves
    // against this host's `color` — inherited properties cross into the shadow
    // tree a `<use>` builds, which is what keeps `--icon-color` working.
    //
    // No viewBox here on purpose: the symbol carries its own, which is what
    // lets the set mix 16, 20 and 24 unit grids and still draw at one size.
    return html`<svg><use href="${appHref(SPRITE_PATH)}#${this.icon}"></use></svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-icon': AppIcon;
  }
}
