import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { LightElement } from "../commons/base-element.ts";
import { goBack, navigateTo } from "../commons/navigation.ts";
import {
  eventTypesRepo,
  fieldById,
  fieldOfKind,
  findEventType,
  LiveQuery,
  documentsRepo,
  eventsRepo,
  formatCents,
  formatDateMedium,
  formatFileKind,
  formatFileSize,
  formatFollowUpInterval,
  formatTime,
  formatWorkActivity,
  parseFollowUpValue,
  type ResolvedEventType,
} from "../data/index.ts";
import type { HorseEvent, StoredDocument } from "../data/types.ts";
import { THEME_META } from "../theme/theme.ts";
import type { IconName } from "../components/app-icon/icons.ts";
import { documentCategory } from "../types/document.types.ts";

import "../components/app-icon/app-icon.ts";
import { tagStyle } from "../components/app-tag/app-tag.ts";
import "../components/app-modal/app-modal.ts";
import "../components/document-viewer/document-viewer.ts";
import "../components/event-sheet/event-sheet.ts";

/** Where back falls to, and where a delete lands. */
const EVENTS_LIST = "/events";

/** One row of the Informations card. `null` values are dropped, not shown blank. */
type InfoRow = { label: string; value: TemplateResult | string };

@customElement("event-detail-view")
export class EventDetailView extends LightElement {
  /** Sliced out of the pathname by the route table; nothing else parses the URL. */
  @property({ attribute: false }) eventId = "";

  @state() private editOpen = false;
  @state() private deleteOpen = false;
  @state() private viewing: StoredDocument | null = null;
  @state() private actionError = "";

  // Both read `this.eventId`, which never changes for a given element: the
  // route keys this view by path, so a different event is a different element.
  #event = new LiveQuery(this, () => eventsRepo.get(this.eventId));
  #documents = new LiveQuery<StoredDocument[]>(this, () =>
    documentsRepo.listByEvent(this.eventId),
  );
  #eventTypes = new LiveQuery<ResolvedEventType[]>(this, () =>
    eventTypesRepo.listResolved(),
  );

  /** Back to the calendar or the list, whichever this was opened from. */
  #goBack = () => goBack(EVENTS_LIST);

  render() {
    if (this.#event.loading) {
      return html`<section class="event-detail">
        <p class="event-detail__empty">Chargement…</p>
      </section>`;
    }

    const event = this.#event.value;
    if (!event) return this.#renderNotFound();
    const type = findEventType(this.#eventTypes.value ?? [], event.type);

    return html`
      <section class="event-detail">
        <header class="event-detail__header">
          <button
            class="event-detail__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="event-detail__title" tabindex="-1">${event.title}</h1>
        </header>

        <section class="event-detail__section">
          <h2 class="section-title-small">Informations</h2>
          <!-- The card is a wrapper, not the list itself: .meta-list zeroes its
               own padding and sits in a later sub-layer than .container, so
               putting both on one element silently drops the card's inset. -->
          <div class="container">
            <ul class="meta-list">
              ${this.#infoRows(event, type).map(
                (row) => html`
                  <li class="meta-item">
                    <span class="meta-label">${row.label}</span>
                    <span class="meta-value">${row.value}</span>
                  </li>
                `,
              )}
            </ul>
          </div>
        </section>

        ${this.#renderDocuments()}

        <section class="event-detail__section">
          <h2 class="section-title-small">Actions</h2>
          <div class="container">
            <ul class="event-detail__actions">
              ${this.#renderActions(event, type)}
            </ul>
          </div>
          <!--
            Mounted with the section and never hidden — only its contents
            change. A \`role="alert"\` element that enters the accessibility
            tree at the moment it has something to say is typically announced as
            nothing, and \`hidden\` takes a region out of that tree just as
            surely as never rendering it. Same shape as \`app-update-toast\`'s
            status region and \`event-sheet\`'s.
          -->
          <div class="event-detail__error-region" role="alert">
            ${
              this.actionError
                ? html`<p class="event-detail__error">${this.actionError}</p>`
                : nothing
            }
          </div>
        </section>
      </section>

      ${this.#renderOverlays(event)}
    `;
  }

  #renderNotFound() {
    return html`
      <section class="event-detail">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">Évènement introuvable</h1>
          <p class="section-subtitle">Il a peut-être été supprimé.</p>
        </hgroup>
        <button
          class="event-detail__back-link pressable"
          type="button"
          @click=${this.#goBack}
        >
          Retour
        </button>
      </section>
    `;
  }

  /**
   * The rows of the Informations card, in the order the design draws them.
   *
   * The practitioner/merchant row reads its label *and* its `customFields` key
   * straight off the record's own type — the very definition the entry form
   * writes from — so what is shown here and what was captured there cannot
   * drift apart. Empty rows are dropped rather than rendered with a dash: a
   * card of blanks reads as broken.
   *
   * `type` is `undefined` for the tick before the type catalogue's `LiveQuery`
   * settles, or a type since deleted — every row but Nom/Date is guarded on a
   * field actually being found, so the card degrades to its bare minimum
   * rather than throwing.
   */
  #infoRows(event: HorseEvent, type: ResolvedEventType | undefined): InfoRow[] {
    const rows: InfoRow[] = [
      // `app-tag` resolves both the label and the colours from the type alone.
      {
        label: "Type",
        value: html`<app-tag
          label=${type?.label ?? ""}
          style=${styleMap(type ? tagStyle(THEME_META[type.theme]) : {})}
        ></app-tag>`,
      },
      { label: "Nom", value: event.title },
      {
        label: "Date",
        value: event.time
          ? `${formatDateMedium(event.date)} · ${formatTime(event.time)}`
          : formatDateMedium(event.date),
      },
    ];

    const activityField = type && fieldOfKind(type, "workActivity");
    const activityValue = activityField && event.customFields[activityField.id];
    if (typeof activityValue === "string" && activityValue) {
      rows.push({
        label: "Activité",
        value: formatWorkActivity(activityValue),
      });
    }

    const counterpartyField = type && fieldById(type, "counterparty");
    const counterpartyValue =
      counterpartyField && event.customFields[counterpartyField.id];
    if (
      counterpartyField &&
      typeof counterpartyValue === "string" &&
      counterpartyValue
    ) {
      rows.push({ label: counterpartyField.label, value: counterpartyValue });
    }

    const amountField = type && fieldById(type, "amountCents");
    const amountValue = amountField && event.customFields[amountField.id];
    if (typeof amountValue === "number") {
      rows.push({
        label: "Budget",
        value: formatCents(amountValue, event.currency),
      });
    }

    // Already display-ready — `formatQuantity` (`events.ts`) is what wrote
    // this string in the first place, so there is nothing left to format.
    const quantityField = type && fieldById(type, "quantity");
    const quantityValue = quantityField && event.customFields[quantityField.id];
    if (typeof quantityValue === "string" && quantityValue) {
      rows.push({ label: quantityField.label, value: quantityValue });
    }

    const followUpField = type && fieldOfKind(type, "followUp");
    const followUpValueRaw =
      followUpField && event.customFields[followUpField.id];
    const interval =
      typeof followUpValueRaw === "string"
        ? parseFollowUpValue(followUpValueRaw)
        : null;
    if (interval) {
      rows.push({
        label: "Prochain rendez-vous",
        value: formatFollowUpInterval(interval),
      });
    }

    if (event.location) rows.push({ label: "Lieu", value: event.location });
    if (event.notes) rows.push({ label: "Note", value: event.notes });

    return rows;
  }

  #renderDocuments() {
    const documents = this.#documents.value ?? [];
    if (documents.length === 0) return nothing;

    return html`
      <ul class="event-detail__files">
        ${repeat(
          documents,
          (doc) => doc.id,
          (doc) => html`
            <li>
              <button
                class="container event-detail__file pressable"
                type="button"
                @click=${() => this.#openViewer(doc)}
              >
                <app-icon
                  class="event-detail__file-icon"
                  icon="file"
                ></app-icon>
                <span class="event-detail__file-name">${doc.name}</span>
                <span class="event-detail__file-meta">
                  ${formatFileKind(doc.mimeType)} • ${formatFileSize(doc.size)}
                </span>
                <app-tag
                  class="event-detail__file-tag"
                  label=${documentCategory.label(doc.category)}
                  style=${styleMap(tagStyle(documentCategory.theme(doc.category)))}
                ></app-tag>
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  #renderActions(event: HorseEvent, type: ResolvedEventType | undefined) {
    const doc = this.#documents.value?.[0] ?? null;

    return html`
      ${this.#renderAction({
        icon: "download",
        label: "Télécharger",
        // Deliberately inert: the file lives only in IndexedDB until Drive sync
        // exists, so there is nothing to download *from the drive* yet.
        hint: "Bientôt disponible",
        disabled: true,
      })}
      ${this.#renderAction({
        icon: "edit",
        label: "Modifier",
        onClick: () => {
          this.editOpen = true;
        },
      })}
      ${
        // Hidden rather than disabled where the API is missing: an action that
        // throws on tap is worse than one that was never offered.
        "share" in navigator
          ? this.#renderAction({
              icon: "share",
              label: "Partager",
              onClick: () => void this.#share(event, type, doc),
            })
          : nothing
      }
      ${this.#renderAction({
        icon: "trash",
        label: "Supprimer",
        destructive: true,
        onClick: () => {
          this.deleteOpen = true;
        },
      })}
    `;
  }

  #renderAction(action: {
    icon: IconName;
    label: string;
    hint?: string;
    disabled?: boolean;
    destructive?: boolean;
    onClick?: () => void;
  }) {
    return html`
      <li>
        <button
          class="event-detail__action pressable ${action.destructive ? "event-detail__action--danger" : ""}"
          type="button"
          ?disabled=${action.disabled ?? false}
          @click=${action.onClick}
        >
          <app-icon
            class="event-detail__action-icon"
            icon=${action.icon}
          ></app-icon>
          <span class="event-detail__action-label">${action.label}</span>
          ${
            action.hint
              ? html`<span class="event-detail__action-hint"
                  >${action.hint}</span
                >`
              : nothing
          }
        </button>
      </li>
    `;
  }

  #renderOverlays(event: HorseEvent) {
    return html`
      <event-sheet
        .event=${event}
        .open=${this.editOpen}
        @sheet-close=${() => {
          this.editOpen = false;
        }}
      ></event-sheet>

      <document-viewer
        .doc=${this.viewing}
        .open=${this.viewing !== null}
        @viewer-close=${() => {
          this.viewing = null;
        }}
      ></document-viewer>

      <app-modal
        heading="Supprimer l’évènement ?"
        description=${`« ${event.title} » sera retiré du calendrier et des dépenses.`}
        .open=${this.deleteOpen}
        @modal-close=${() => {
          this.deleteOpen = false;
        }}
      >
        <p class="event-detail__confirm">
          Les fichiers qui y sont attachés restent dans vos documents.
        </p>
        <div slot="footer" class="event-detail__confirm-actions">
          <button
            class="event-detail__button"
            type="button"
            @click=${() => {
              this.deleteOpen = false;
            }}
          >
            Annuler
          </button>
          <button
            class="event-detail__button event-detail__button--danger"
            type="button"
            @click=${this.#confirmDelete}
          >
            Supprimer
          </button>
        </div>
      </app-modal>
    `;
  }

  #openViewer(doc: StoredDocument) {
    this.viewing = doc;
  }

  /**
   * Hands the file to the OS share sheet when it can take one, and a written
   * summary when it can't — a vet report shared without the actual PDF is the
   * less useful half, but it beats an action that silently does nothing.
   */
  async #share(
    event: HorseEvent,
    type: ResolvedEventType | undefined,
    doc: StoredDocument | null,
  ) {
    this.actionError = "";

    const amount = event.customFields.amountCents;
    const summary = [
      type?.label ?? "",
      formatDateMedium(event.date),
      typeof event.customFields.counterparty === "string"
        ? event.customFields.counterparty
        : "",
      typeof amount === "number" ? formatCents(amount, event.currency) : "",
    ]
      .filter(Boolean)
      .join(" · ");

    try {
      const file = doc && (await this.#toFile(doc));
      // `canShare` is what decides, not the presence of a file: iOS refuses
      // some types outright, and `share` would reject rather than degrade.
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: event.title,
          text: summary,
        });
      } else {
        await navigator.share({ title: event.title, text: summary });
      }
    } catch (error: unknown) {
      // Dismissing the OS sheet rejects with AbortError. That is the user
      // saying no, not a failure, and must not surface as one.
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.actionError = "Le partage n’a pas abouti.";
    }
  }

  async #toFile(doc: StoredDocument): Promise<File | null> {
    const blob = await documentsRepo.getBlob(doc.id);
    return blob ? new File([blob], doc.name, { type: doc.mimeType }) : null;
  }

  #confirmDelete = async () => {
    this.deleteOpen = false;
    try {
      await eventsRepo.remove(this.eventId);
    } catch {
      this.actionError = "La suppression a échoué.";
      return;
    }
    // The record is gone from every read path, so staying here would only show
    // this view's own not-found state.
    navigateTo(EVENTS_LIST);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "event-detail-view": EventDetailView;
  }
}
