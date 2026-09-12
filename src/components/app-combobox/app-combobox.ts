import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { describedBy, fieldMessages } from "../../commons/field-parts.ts";
import { FormFieldElement } from "../../commons/form-field-element.ts";

export interface AppComboboxOption {
  value: string;
  label: string;
}

/**
 * Labeled text field with a suggestions list, form-associated so it works
 * with native <form>, FormData and constraint validation like a built-in
 * field.
 *
 * Unlike `app-select`, the value is never restricted to `options`: picking a
 * suggestion (click or Enter) submits its `value`, and typing something no
 * suggestion matches submits the typed text itself. That is the whole point
 * of a combobox over a select here — the Nom field on a `travail` event wants
 * both "pick one already used" and "name a new one" from one control.
 *
 * @fires combobox-change - `{ value: string }`. Listen for this, not the
 * native `input`, which is `composed: false` and never leaves the shadow root.
 */
@customElement("app-combobox")
export class AppCombobox extends FormFieldElement {
  @property({ type: String }) value = "";
  @property({ type: Array }) options: AppComboboxOption[] = [];
  @property({ type: String }) placeholder = "";
  @property({ type: Number }) maxlength?: number;
  /** Drops the card behind the field, for a surface that already provides one. */
  @property({ type: Boolean, reflect: true }) flat = false;

  /**
   * Whether the suggestions list is open.
   *
   * Not `private`: `changed.has(...)` in `updated()` needs it in `keyof AppCombobox`.
   */
  @state() open = false;
  /** Index into `#rows`, or `-1` when nothing is highlighted. */
  @state() private activeIndex = -1;

  @query("input") private inputEl?: HTMLInputElement;
  @query(".field__control") private controlEl?: HTMLElement;
  @query(".field__listbox") private listboxEl?: HTMLUListElement;

  protected get control(): HTMLInputElement | undefined {
    return this.inputEl;
  }
  #defaultValue = "";

  protected get formValue(): string {
    return this.value;
  }

  protected captureDefault() {
    this.#defaultValue = this.value;
  }

  protected restoreDefault() {
    this.value = this.#defaultValue;
  }

  // --- Form-associated custom element lifecycle ---

  formResetCallback() {
    this.value = this.#defaultValue;
    this.error = "";
    this.open = false;
    this.activeIndex = -1;
    this.field.reset();
  }

  formStateRestoreCallback(restored: string | FormData | null) {
    this.value = typeof restored === "string" ? restored : "";
  }

  /**
   * What the input shows.
   *
   * `value` is the *submitted* string, which is a known option's `value` right
   * after picking it — its own key, not its label. Resolving it back to a
   * label here is what lets a built-in like `trotting` read as "Trotting" in
   * the box; free text the user typed has no option to resolve against, so it
   * shows as itself.
   */
  get #displayValue(): string {
    return (
      this.options.find((option) => option.value === this.value)?.label ??
      this.value
    );
  }

  /** Options whose label contains what's typed so far, all of them when blank. */
  get #filteredOptions(): AppComboboxOption[] {
    const search = this.value.trim().toLocaleLowerCase("fr-FR");
    if (search === "") return this.options;
    return this.options.filter((option) =>
      option.label.toLocaleLowerCase("fr-FR").includes(search),
    );
  }

  /**
   * Whether an "add «typed text»" row belongs at the end of the list — only
   * when there is something to add and it isn't just an existing option
   * spelled back, case- and accent-insensitively (`sensitivity: "base"`), so
   * typing "trotting" for the built-in `trotting` (labelled "Trotting")
   * offers to select it rather than to duplicate it.
   */
  get #showCreateRow(): boolean {
    const typed = this.value.trim();
    if (typed === "") return false;
    return !this.options.some(
      (option) =>
        option.label.localeCompare(typed, "fr-FR", { sensitivity: "base" }) ===
        0,
    );
  }

  #onFocus = () => {
    this.open = true;
  };

  #onInput = (event: InputEvent) => {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.open = true;
    this.activeIndex = -1;
    this.field.sync();
  };

  #onBlur = () => {
    this.#commit();
    this.field.markTouched();
  };

  #dispatchChange() {
    // The native `input` is `composed: false`, so it stops at this shadow
    // boundary and a consumer's `@input` never fires. Re-dispatched as a
    // composed custom event, matching `select-change` / `checkbox-change`.
    this.dispatchEvent(
      new CustomEvent("combobox-change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #selectOption(option: AppComboboxOption) {
    this.value = option.value;
    this.open = false;
    this.activeIndex = -1;
    this.#dispatchChange();
  }

  #selectFreeText() {
    const typed = this.value.trim();
    if (typed !== "") this.value = typed;
    this.open = false;
    this.activeIndex = -1;
    this.#dispatchChange();
  }

  /** Applies whatever `activeIndex` currently points at, options first, then the create row. */
  #selectRow(index: number) {
    const options = this.#filteredOptions;
    if (index < options.length) {
      const option = options[index];
      if (option) this.#selectOption(option);
    } else if (this.#showCreateRow) {
      this.#selectFreeText();
    }
  }

  /**
   * What Enter and blur both resolve to: the highlighted row when there is
   * one, otherwise the typed text — matched against the options' labels first,
   * so leaving the field after typing "Trotting" lands on the built-in
   * `trotting` rather than a new, visually identical entry.
   */
  #commit() {
    if (this.open && this.activeIndex >= 0) {
      this.#selectRow(this.activeIndex);
    } else {
      const typed = this.value.trim();
      const match =
        typed !== "" &&
        this.options.find(
          (option) =>
            option.label.localeCompare(typed, "fr-FR", {
              sensitivity: "base",
            }) === 0,
        );
      if (match) this.value = match.value;
    }
    this.open = false;
    this.activeIndex = -1;
  }

  /**
   * `updated()` is unconditional in `FormFieldElement` (see its comment), so
   * this reads `changed` itself rather than relying on the base to gate it.
   *
   * The listbox is a `popover="manual"`, promoted to the top layer, because
   * `position: absolute` inside `.field__wrapper` was clipped by any ancestor
   * that clips overflow — `event-form__follow-up` does, to animate its own
   * height — and had no idea a keyboard had eaten the bottom of the viewport.
   * Showing/hiding it here, alongside the viewport tracking, is what a plain
   * `?hidden` binding can no longer do once the element lives in the top layer.
   */
  protected updated(changed?: PropertyValues<this>) {
    super.updated();
    if (!changed?.has("open")) return;
    const listbox = this.listboxEl;
    if (!listbox) return;
    if (this.open) {
      if (!listbox.matches(":popover-open")) listbox.showPopover();
      this.#startTracking();
    } else {
      this.#stopTracking();
      if (listbox.matches(":popover-open")) listbox.hidePopover();
    }
  }

  disconnectedCallback() {
    this.#stopTracking();
    super.disconnectedCallback();
  }

  /**
   * Anchors the listbox to the control on every open and on every scroll or
   * resize while it stays open — including `visualViewport`'s, which is what
   * actually shrinks when the on-screen keyboard appears (`window.innerHeight`
   * does not). Flipping above the control, not just capping the height, when
   * the keyboard leaves too little room below is what keeps the list from
   * opening half-hidden behind it.
   */
  #reposition = () => {
    const control = this.controlEl;
    const listbox = this.listboxEl;
    if (!control || !listbox) return;

    const rect = control.getBoundingClientRect();
    const viewport = window.visualViewport;
    const visibleTop = viewport?.offsetTop ?? 0;
    const visibleBottom = viewport
      ? viewport.offsetTop + viewport.height
      : window.innerHeight;
    const gap = 4;
    const rootFontSize =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const preferredMaxHeight = rootFontSize * 12;

    const spaceBelow = visibleBottom - rect.bottom - gap;
    const spaceAbove = rect.top - visibleTop - gap;
    const openUpward = spaceBelow < rootFontSize * 3 && spaceAbove > spaceBelow;

    listbox.style.left = `${rect.left}px`;
    listbox.style.width = `${rect.width}px`;
    if (openUpward) {
      listbox.style.top = "auto";
      listbox.style.bottom = `${window.innerHeight - rect.top + gap}px`;
      listbox.style.maxHeight = `${Math.max(0, Math.min(preferredMaxHeight, spaceAbove))}px`;
    } else {
      listbox.style.bottom = "auto";
      listbox.style.top = `${rect.bottom + gap}px`;
      listbox.style.maxHeight = `${Math.max(0, Math.min(preferredMaxHeight, spaceBelow))}px`;
    }
  };

  #startTracking() {
    this.#reposition();
    window.addEventListener("resize", this.#reposition);
    window.addEventListener("scroll", this.#reposition, true);
    window.visualViewport?.addEventListener("resize", this.#reposition);
    window.visualViewport?.addEventListener("scroll", this.#reposition);
  }

  #stopTracking() {
    window.removeEventListener("resize", this.#reposition);
    window.removeEventListener("scroll", this.#reposition, true);
    window.visualViewport?.removeEventListener("resize", this.#reposition);
    window.visualViewport?.removeEventListener("scroll", this.#reposition);
  }

  #onKeydown = (event: KeyboardEvent) => {
    const total = this.#filteredOptions.length + (this.#showCreateRow ? 1 : 0);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.open = true;
        this.activeIndex = total === 0 ? -1 : (this.activeIndex + 1) % total;
        break;
      case "ArrowUp":
        event.preventDefault();
        this.open = true;
        this.activeIndex =
          total === 0 ? -1 : (this.activeIndex - 1 + total) % total;
        break;
      case "Enter":
        // Only intercepted while the list is open: the first Enter accepts
        // the highlighted row (or resolves the typed text) and closes the
        // list, exactly like blurring would — a second Enter then submits
        // the form as normal, with nothing left for this field to do.
        if (this.open) {
          event.preventDefault();
          this.#commit();
        }
        break;
      case "Escape":
        if (this.open) {
          event.preventDefault();
          event.stopPropagation();
          this.open = false;
          this.activeIndex = -1;
        }
        break;
      default:
        break;
    }
  };

  static componentStyles = css`
    :host {
      display: block;
      font-family: var(--font-family-base);
    }

    :host([disabled]) .field__label {
      color: var(--color-brown-light);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      background-color: var(--color-white);
      border-radius: var(--radius-16);
      padding: var(--spacing-12);
    }

    .field__label {
      font-size: 0.75rem;
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--font-color);
    }

    :host([flat]) .field {
      background-color: transparent;
      padding: 0;
    }

    .field__wrapper {
      position: relative;
    }

    .field__control {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      background-color: var(
        --app-combobox-background,
        var(--color-input-drawer)
      );
      border: 1px solid
        var(--app-combobox-background, var(--color-input-drawer));
      border-radius: var(--radius-8);
      padding-inline: var(--spacing-12);
      min-height: 2.75rem;
      box-sizing: border-box;
      transition:
        border-color var(--duration-fast) ease,
        box-shadow var(--duration-fast) ease;
    }

    @media (hover: hover) and (pointer: fine) {
      :host(:not([disabled])) .field__control:hover {
        border-color: var(--color-brown-middle);
      }
    }

    .field__control:has(.field__input:focus-visible) {
      border-color: var(--color-brown-dark);
      box-shadow: 0 0 0 3px var(--color-theme-brown-background);
    }

    :host([disabled]) .field__control {
      background-color: var(--color-disabled-surface);
      cursor: not-allowed;
    }

    .field__input {
      grid-column: 1;
      font: inherit;
      /* Not 0.813rem, like app-input's: Safari on iOS zooms the whole page in
         when a control smaller than 16px takes focus, and a standalone PWA has
         no address bar to reset the zoom from — see app-select's own note by
         its .field__select rule. */
      font-size: var(--font-size-base);
      color: var(--font-color);
      background: none;
      border: 0;
      padding: var(--spacing-8) 0;
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
    }

    .field__input:focus {
      outline: none;
    }

    .field__input::placeholder {
      color: var(--color-brown-light);
    }

    .field__input:disabled {
      color: var(--color-disabled-content);
      cursor: not-allowed;
    }

    /* Hints there is a list behind the field, the same visual language
       app-select's arrow uses — this is the one thing that tells the two
       apart from a plain app-input at a glance. */
    .field__arrow {
      grid-column: 2;
      justify-self: end;
      width: 0.5rem;
      height: 0.5rem;
      pointer-events: none;
      border-right: 2px solid var(--color-brown-middle);
      border-bottom: 2px solid var(--color-brown-middle);
      transform: translateY(-15%) rotate(45deg);
    }

    :host([disabled]) .field__arrow {
      border-color: var(--color-disabled-content);
    }

    :host(:state(invalid)) .field__control {
      border-color: var(--app-field-error-color);
    }

    :host(:state(invalid)) .field__control:has(.field__input:focus-visible) {
      box-shadow: var(--app-field-error-ring);
    }

    /*
     * A popover, not position: absolute inside .field__wrapper: this field can
     * sit inside .event-form__follow-up, which clips overflow to animate its
     * own height, and an absolutely-positioned list was clipped along with it.
     * position: fixed here, with left/width/top or bottom written by
     * #reposition, is what lets the list escape that clip and still track the
     * control across scrolls, resizes and the on-screen keyboard.
     */
    .field__listbox {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: var(--spacing-4);
      list-style: none;
      background-color: var(--color-white);
      border: 1px solid var(--color-brown-light);
      border-radius: var(--radius-8);
      box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
      max-height: 12rem;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .field__option {
      padding: var(--spacing-8) var(--spacing-12);
      border-radius: var(--radius-8);
      font-size: 0.813rem;
      color: var(--font-color);
      cursor: pointer;
    }

    .field__option--active {
      background-color: var(--color-theme-brown-background);
    }

    .field__option--create {
      color: var(--color-brown-dark);
      font-weight: 600;
    }

    .field__empty {
      padding: var(--spacing-8) var(--spacing-12);
      font-size: 0.813rem;
      color: var(--color-brown-light);
    }
  `;

  render() {
    const { hintId, errorId, message } = this.messages;
    const described = describedBy(this.helpText && hintId, message && errorId);

    const options = this.#filteredOptions;
    const showCreateRow = this.#showCreateRow;
    const listId = `${this.fieldId}-listbox`;
    const optionId = (index: number) => `${this.fieldId}-option-${index}`;
    const activeId =
      this.activeIndex >= 0 ? optionId(this.activeIndex) : undefined;

    return html`
      <div class="field">
        <label class="field__label" part="label" for=${this.fieldId}>
          ${this.label}${
            this.required
              ? html`<span
                  class="field__required"
                  part="required"
                  aria-hidden="true"
                >
                  *</span
                >`
              : nothing
          }
        </label>
        <div class="field__wrapper">
          <div class="field__control" part="control">
            <input
              id=${this.fieldId}
              part="input"
              class="field__input"
              type="text"
              role="combobox"
              autocomplete="off"
              aria-autocomplete="list"
              aria-expanded=${this.open ? "true" : "false"}
              aria-controls=${listId}
              aria-activedescendant=${ifDefined(activeId)}
              name=${ifDefined(this.name || undefined)}
              .value=${live(this.#displayValue)}
              placeholder=${ifDefined(this.placeholder || undefined)}
              maxlength=${ifDefined(this.maxlength)}
              ?required=${this.required}
              ?disabled=${this.disabled}
              aria-invalid=${this.invalid ? "true" : "false"}
              aria-describedby=${ifDefined(described)}
              @focus=${this.#onFocus}
              @input=${this.#onInput}
              @keydown=${this.#onKeydown}
              @blur=${this.#onBlur}
            />
            <span class="field__arrow" aria-hidden="true"></span>
          </div>
          <ul
            id=${listId}
            class="field__listbox"
            part="listbox"
            role="listbox"
            popover="manual"
          >
            ${options.map(
              (option, index) => html`
                <li
                  id=${optionId(index)}
                  role="option"
                  class="field__option ${
                    index === this.activeIndex ? "field__option--active" : ""
                  }"
                  aria-selected=${option.value === this.value ? "true" : "false"}
                  @mousedown=${(event: Event) => event.preventDefault()}
                  @click=${() => this.#selectOption(option)}
                >
                  ${option.label}
                </li>
              `,
            )}
            ${
              showCreateRow
                ? html`
                    <li
                      id=${optionId(options.length)}
                      role="option"
                      class="field__option field__option--create ${
                        options.length === this.activeIndex
                          ? "field__option--active"
                          : ""
                      }"
                      aria-selected="false"
                      @mousedown=${(event: Event) => event.preventDefault()}
                      @click=${() => this.#selectFreeText()}
                    >
                      Ajouter « ${this.value.trim()} »
                    </li>
                  `
                : nothing
            }
            ${
              options.length === 0 && !showCreateRow
                ? html`<li class="field__empty">Aucun résultat</li>`
                : nothing
            }
          </ul>
        </div>
        ${fieldMessages({ hintId, errorId, helpText: this.helpText, message })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-combobox": AppCombobox;
  }
}
