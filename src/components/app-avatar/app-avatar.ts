import { css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";

/**
 * A round initial badge standing in for a profile picture.
 *
 * Lifted out of `ProfileView`, which drew it inline until the dashboard also
 * needed one, linking to `/profile` — sizing it per call site rather than
 * duplicating the markup and its font-size math at each one.
 */
@customElement("app-avatar")
export class AppAvatar extends BaseElement {
  @property({ type: String }) initial = "";

  /**
   * Diameter, any CSS length. Sets `--avatar-size` rather than the host's own
   * width/height, the same pattern `app-icon`'s `size` uses for `--icon-size`.
   */
  @property({ type: String }) size: string | null = null;

  static componentStyles = css`
    :host {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: var(--avatar-size, 3.5rem);
      height: var(--avatar-size, 3.5rem);
      border-radius: var(--radius-pill);
      background: var(--color-theme-brown-background);
      color: var(--color-brown-middle);
      /* Keeps the letter at the same proportion of the badge at every size
         (1.5rem on the original 3.5rem badge) instead of pinning a fixed size
         that would overflow a small one or look lost in a large one. */
      font-size: calc(var(--avatar-size, 3.5rem) * 0.4286);
      font-weight: 700;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if (!changed.has("size")) return;

    if (this.size) this.style.setProperty("--avatar-size", this.size);
    else this.style.removeProperty("--avatar-size");
  }

  render() {
    return html`${this.initial}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-avatar": AppAvatar;
  }
}
