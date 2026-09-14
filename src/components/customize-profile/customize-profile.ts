import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { customizeFormStyles } from "../../commons/customize-form.styles.ts";
import type { DisplayProfile } from "../../data/account.ts";

export type ProfileSubmitDetail = { data: FormData };

/** The field names, shared by the markup and the view's `readForm` schema. */
export const PROFILE_FIELDS = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
} as const;

export type ProfileFieldErrors = Partial<
  Record<keyof typeof PROFILE_FIELDS, string>
>;

/** Display only — no password is stored anywhere in this app. */
const PASSWORD_MASK = "*".repeat(9);

/**
 * The Profil tab of Personnaliser mon interface: first name, last name and
 * email as inline fields in the profile page's label-left / value-right rows,
 * and a save button.
 *
 * Presentational — the owning view parses the form and writes it. The inputs
 * are prefilled from `profile` through `.value`, which Lit re-applies only
 * when the saved value itself changes, so typing is never overwritten.
 *
 * @fires profile-submit - The form was submitted; `detail.data` is its FormData.
 */
@customElement("customize-profile")
export class CustomizeProfile extends BaseElement {
  @property({ attribute: false }) profile: DisplayProfile | null = null;
  @property({ attribute: false }) errors: ProfileFieldErrors = {};
  @property({ type: String }) status = "";

  static componentStyles = customizeFormStyles;

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    this.dispatchEvent(
      new CustomEvent<ProfileSubmitDetail>("profile-submit", {
        detail: { data: new FormData(form) },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    const profile = this.profile;
    return html`
      <form novalidate @submit=${this.#onSubmit}>
        <section class="section">
          <h2 class="title">Informations personnelles</h2>
          <ul class="list">
            ${this.#renderField("firstName", "Prénom", profile?.firstName, {
              autocomplete: "given-name",
            })}
            ${this.#renderField("lastName", "Nom", profile?.lastName, {
              autocomplete: "family-name",
            })}
            ${this.#renderField("email", "Email", profile?.email, {
              autocomplete: "email",
              type: "email",
            })}
            <li class="item">
              <span class="item__label">Mot de passe</span>
              <span class="item__value">${PASSWORD_MASK}</span>
            </li>
          </ul>
        </section>
        <button class="submit pressable" type="submit">Enregistrer</button>
        ${
          this.status
            ? html`<p class="status" role="status">${this.status}</p>`
            : nothing
        }
      </form>
    `;
  }

  #renderField(
    name: keyof typeof PROFILE_FIELDS,
    label: string,
    value: string | undefined,
    options: { autocomplete: string; type?: string },
  ) {
    const id = `profile-${name}`;
    const error = this.errors[name];
    return html`
      <li class="item">
        <label class="item__label" for=${id}>${label}</label>
        <input
          class="item__input"
          id=${id}
          name=${PROFILE_FIELDS[name]}
          type=${options.type ?? "text"}
          autocomplete=${options.autocomplete}
          .value=${value ?? ""}
          aria-invalid=${error ? "true" : "false"}
          aria-describedby=${error ? `${id}-error` : nothing}
        />
        ${
          error
            ? html`<p class="item__error" id=${`${id}-error`}>${error}</p>`
            : nothing
        }
      </li>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-profile": CustomizeProfile;
  }
}
