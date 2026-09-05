import { css, html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import type { IconName } from "../app-icon/icons.ts";
import "../app-icon/app-icon.ts";

const folderBgUrl = new URL(
  "../../assets/folder/folder-bg.svg",
  import.meta.url,
).href;

@customElement("app-folder")
export class AppFolder extends BaseElement {
  @property()
  icon: IconName | "" = "";

  @property()
  name: string = "";

  @property({ type: Number })
  number: number = 0;

  static componentStyles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
    }

    .folder {
      position: relative;
      width: 100%;
      aspect-ratio: 157 / 110;
      display: grid;
      justify-items: left;
      padding: var(--spacing-16) var(--spacing-16) var(--spacing-12)
        var(--spacing-16);
      gap: var(--spacing-4);
      background-image: url("${unsafeCSS(folderBgUrl)}");
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      box-sizing: border-box;
    }

    /* Colours are hooks rather than fixed values so a consumer can tint the
       tile per category from THEME_META — a custom property beats ::part here
       because it doesn't override the component's own states. */
    .folder-icon {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--radius-8);
      background-color: var(--app-folder-icon-background, var(--color-page));
      color: var(--app-folder-icon-color, var(--color-brown-dark));
      padding: var(--spacing-8);
      display: grid;
      place-items: center;
    }

    .folder-name {
      font-size: 1rem;
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--font-color);
    }

    .folder-number {
      font-size: 0.75rem;
      line-height: 0.875rem;
      font-weight: 600;
      color: var(--color-brown-light);
    }
  `;

  render() {
    return html`
      <div class="folder">
        <app-icon class="folder-icon" icon="${this.icon}"></app-icon>
        <span class="folder-name">${this.name}</span>
        <span class="folder-number">
          ${this.number} ${this.number === 1 ? "document" : "documents"}
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-folder": AppFolder;
  }
}
