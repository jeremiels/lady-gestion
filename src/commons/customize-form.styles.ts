import { css } from "lit";

/**
 * The inline-edit card shared by the Personnaliser mon interface tabs that edit
 * one record — Profil and Cheval: a section title, a white list of
 * label-left / value-right rows whose value *is* the input, an error under a
 * row, and the Enregistrer button with its status line.
 *
 * Title and row rules are restated from section.css / meta-list.css, which a
 * shadow root does not see — as horse-profile does.
 */
export const customizeFormStyles = css`
  :host {
    display: block;
  }

  form {
    display: grid;
    gap: 1.5rem;
  }

  .section {
    display: grid;
    gap: 0.5rem;
  }

  .title {
    margin: 0;
    font-size: 0.75rem;
    line-height: 0.875rem;
    font-weight: bold;
    color: var(--color-brown-middle);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    list-style: none;
    margin: 0;
    padding: var(--spacing-12);
    border-radius: var(--radius-12);
    background-color: var(--color-white);
  }

  .item {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 1rem;
  }

  .item:not(:last-child) {
    border-bottom: 1px solid var(--color-divider);
    padding-bottom: 1rem;
  }

  .item__label {
    font-weight: bold;
    font-size: 0.75rem;
    line-height: 1rem;
    color: var(--color-brown-middle);
  }

  .item__value,
  .item__input {
    min-width: 0;
    font-weight: bold;
    font-size: 0.875rem;
    line-height: 0.938rem;
    text-align: end;
    color: var(--font-color);
  }

  .item__input {
    appearance: none;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
  }

  .item__input:focus-visible {
    outline: 2px solid var(--color-brown-dark);
    outline-offset: 4px;
    border-radius: var(--radius-8);
  }

  .item__error {
    grid-column: 1 / -1;
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: end;
    color: var(--color-theme-pink);
  }

  .submit {
    appearance: none;
    padding: var(--spacing-12) var(--spacing-16);
    border: none;
    border-radius: var(--radius-8);
    background: var(--color-brown-dark);
    color: var(--color-white);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .status {
    margin: 0;
    font-size: 0.813rem;
    font-weight: 600;
    text-align: center;
  }
`;
