import { html } from "lit";
import "../components/app-modal/app-modal.ts";

/**
 * An `app-modal` that asks before an action: a heading, a description, any
 * further lines, and two buttons — one that only closes it, then the action
 * itself, drawn as a danger. Deleting an event, a feed or a category,
 * dropping an edit, replacing the data with a backup.
 *
 * A template rather than an element, rendered into the caller's light DOM,
 * where `styles/components/confirm-dialog.css` reaches it. `activity-sheet`
 * keeps its own: its shadow root is out of that stylesheet's reach.
 *
 * `onCancel` also answers `modal-close`, which Esc and the backdrop send.
 */
export const confirmDialog = ({
  heading,
  description,
  lines = [],
  open,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  heading: string;
  description: string;
  /** Said below the description, a paragraph each. */
  lines?: readonly string[];
  open: boolean;
  /** The button that only closes it: "Annuler", "Continuer". */
  cancel: string;
  /** The action's own button: "Supprimer", "Remplacer". */
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => html`
  <app-modal
    heading=${heading}
    description=${description}
    .open=${open}
    @modal-close=${onCancel}
  >
    ${lines.map((line) => html`<p class="confirm-dialog__text">${line}</p>`)}
    <div slot="footer" class="confirm-dialog__actions">
      <button class="confirm-dialog__button" type="button" @click=${onCancel}>
        ${cancel}
      </button>
      <button
        class="confirm-dialog__button confirm-dialog__button--danger"
        type="button"
        @click=${onConfirm}
      >
        ${confirm}
      </button>
    </div>
  </app-modal>
`;
