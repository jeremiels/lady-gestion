import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import { isIconName, type IconName } from "../app-icon/icons.ts";

import "../app-icon/app-icon.ts";

/**
 * One destination in the bottom nav: an icon over a label, lit while active.
 *
 * An anchor, not a button — the Navigation API in `app-root` intercepts it for
 * free, and where that API is missing it still works as a real page load. Which
 * item is active is `app-root`'s answer from `SECTIONS`, not this component's:
 * a drill-down like `/budget` has no nav item of its own and must not unlight
 * the one it was opened from.
 */
@customElement("nav-item")
export class NavItem extends BaseElement {
  @property({ type: String }) href = "";
  @property({ type: String }) label = "";
  @property({ type: String }) icon: IconName | "" = "";
  @property({ type: Boolean, reflect: true }) active = false;

  static componentStyles = css`
    .nav-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      align-items: center;
      text-decoration: none;
      color: var(--color-brown-light);

      padding: var(--spacing-4) var(--spacing-8);
    }

    .nav-item.is-active {
      color: var(--color-brown-dark);
    }

    /* Size the glyph, never the host: app-icon's :host carries its own padding,
       so a 1.25rem width/height here left a 0.25rem content box and the SVG
       rendered as a 4px sliver. */
    .nav-item__icon {
      --icon-size: 1.25rem;
      padding: 0;
    }

    .nav-item__label {
      font-weight: 600;
      font-size: 0.625rem;
      line-height: 1;
    }
  `;

  /**
   * The filled variant while active, where one exists.
   *
   * The concatenation is why icon names are camelCase: `home` + `Filled` is a
   * name, `home-filled` is not. `isIconName` narrows the built string back to
   * `IconName` without a cast, which is what lets `icon` stay typed as
   * `IconName` rather than widening to `string`.
   */
  #resolvedIcon(): IconName | "" {
    if (!this.active || !this.icon) return this.icon;

    const filled = `${this.icon}Filled`;
    return isIconName(filled) ? filled : this.icon;
  }

  render() {
    return html`
      <a
        class=${classMap({
          "nav-item": true,
          pressable: true,
          "pressable--small": true,
          "is-active": this.active,
        })}
        href=${this.href}
        aria-current=${this.active ? "page" : "false"}
      >
        <app-icon
          class="nav-item__icon"
          icon=${this.#resolvedIcon()}
        ></app-icon>
        <div class="nav-item__label">${this.label}</div>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nav-item": NavItem;
  }
}
