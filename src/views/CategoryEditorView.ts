import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import { confirmDialog } from "../commons/confirm-dialog.ts";
import { goBack } from "../commons/navigation.ts";
import { customizeTabPath } from "../commons/sections.ts";
import {
  LiveQuery,
  categoriesRepo,
  categoriesService,
  draftOf,
  errorMessage,
  newCategoryDraft,
  postsRepo,
  sameData,
  validateCategory,
  type CategoryDraft,
} from "../data/index.ts";
import type { Category } from "../data/types.ts";
import type { DraftChangeDetail } from "../components/category-editor/category-editor.ts";

import "../components/app-icon/app-icon.ts";
import "../components/category-editor/category-editor.ts";

/** Where Retour, Enregistrer and a delete land. */
const CATEGORIES_TAB = customizeTabPath("categories");

/**
 * The form builder: one category — how it looks, what it is linked to in the
 * app, and the form its posts are entered with.
 *
 * Holds the draft until Enregistrer: nothing reaches the database while she
 * edits, so a half-built form never shows in the entry sheet, and leaving
 * with changes asks first. The page body is `category-editor`, which hands
 * every edit back as a new draft.
 */
@customElement("category-editor-view")
export class CategoryEditorView extends LightElement {
  /** From the route: the category edited, `null` to make a new one. */
  @property({ attribute: false }) categoryId: string | null = null;

  @state() private draft: CategoryDraft | null = null;
  @state() private errors: Record<string, string> = {};
  @state() private actionError = "";
  @state() private saving = false;
  @state() private discardOpen = false;
  @state() private deleteOpen = false;

  /** What the draft started as, to tell an edited one from an untouched one. */
  #initial: CategoryDraft | null = null;

  /** Raw: only the raw row carries the `null` that means "inherited". */
  #catalogue = new LiveQuery<Category[]>(this, () => categoriesRepo.listAll());

  #postCount = new LiveQuery<number>(this, async () => {
    const category = (await categoriesRepo.listAll()).find(
      (type) => type.id === this.categoryId,
    );
    return category ? postsRepo.countByCategory(category.key) : 0;
  });

  get #category(): Category | null {
    return (
      this.#catalogue.value?.find((type) => type.id === this.categoryId) ?? null
    );
  }

  protected willUpdate(_changed: PropertyValues<this>) {
    // The draft is made once, from the row as it first loads; later writes to
    // the catalogue do not pull the rug from under an edit in progress.
    if (this.draft !== null || this.#catalogue.value === undefined) return;
    if (this.categoryId !== null && !this.#category) return;
    this.draft = this.#category ? draftOf(this.#category) : newCategoryDraft();
    this.#initial = this.draft;
  }

  get #dirty(): boolean {
    return (
      this.draft !== null &&
      this.#initial !== null &&
      !sameData(this.draft, this.#initial)
    );
  }

  #leave = () => goBack(CATEGORIES_TAB);

  #onBack = () => {
    if (this.#dirty) this.discardOpen = true;
    else this.#leave();
  };

  #onDraftChange = (event: CustomEvent<DraftChangeDetail>) => {
    this.draft = event.detail.draft;
    // An error clears as soon as what caused it is fixed, not at the next save.
    if (Object.keys(this.errors).length > 0) {
      this.errors = validateCategory(
        this.draft,
        this.#catalogue.value ?? [],
        this.categoryId,
      );
    }
  };

  #save = async () => {
    const draft = this.draft;
    if (!draft || this.saving) return;
    this.saving = true;
    this.actionError = "";
    try {
      const result = await categoriesService.saveCategory({
        existing: this.#category,
        draft,
      });
      if (!result.ok) {
        this.errors = result.errors;
        this.actionError =
          result.errors.form ?? "Vérifiez les champs signalés.";
        return;
      }
      this.#initial = draft;
      this.#leave();
    } catch (error: unknown) {
      this.actionError = errorMessage(error, "Enregistrement impossible.");
    } finally {
      this.saving = false;
    }
  };

  #delete = async () => {
    const category = this.#category;
    this.deleteOpen = false;
    if (!category) return;
    try {
      const deleted = await categoriesService.deleteCategory(category.id);
      if (deleted) this.#leave();
      else {
        this.actionError =
          "Des évènements utilisent cette catégorie : elle ne peut plus être supprimée.";
      }
    } catch (error: unknown) {
      this.actionError = errorMessage(error, "Suppression impossible.");
    }
  };

  render() {
    const category = this.#category;
    const notFound =
      this.categoryId !== null &&
      this.#catalogue.value !== undefined &&
      !category;

    return html`
      <section class="category-editor-view">
        <header class="category-editor-view__header">
          <button
            class="category-editor-view__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#onBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="page-title" tabindex="-1">
            ${category ? category.label : "Nouvelle catégorie"}
          </h1>
        </header>

        ${
          notFound
            ? html`<p class="category-editor-view__note">
                Cette catégorie n’existe plus.
              </p>`
            : html`<category-editor
                  .draft=${this.draft}
                  .catalogue=${this.#catalogue.value ?? []}
                  .category=${category}
                  .errors=${this.errors}
                  @draft-change=${this.#onDraftChange}
                ></category-editor>
                ${this.#renderActions(category)}`
        }

        <!-- Always mounted, so a failure is announced when its text lands. -->
        <div class="category-editor-view__error-region" role="alert">
          ${
            this.actionError
              ? html`<p class="category-editor-view__error">
                  ${this.actionError}
                </p>`
              : nothing
          }
        </div>
      </section>
      ${this.#renderModals(category)}
    `;
  }

  #renderActions(category: Category | null) {
    if (!this.draft) return nothing;
    const posts = this.#postCount.value ?? 0;
    return html`
      <div class="category-editor-view__actions">
        <button
          class="category-editor-view__save pressable"
          type="button"
          ?disabled=${this.saving}
          aria-busy=${this.saving}
          @click=${this.#save}
        >
          Enregistrer
        </button>
        ${
          category === null
            ? nothing
            : posts === 0
              ? html`<button
                  class="category-editor-view__delete pressable"
                  type="button"
                  @click=${() => {
                    this.deleteOpen = true;
                  }}
                >
                  Supprimer la catégorie
                </button>`
              : html`<p class="category-editor-view__note">
                  ${posts} évènement${posts > 1 ? "s sont" : " est"}
                  rangé${posts > 1 ? "s" : ""} dans cette catégorie : pour la
                  masquer, désactivez-la depuis la liste des catégories.
                </p>`
        }
      </div>
    `;
  }

  #renderModals(category: Category | null) {
    return html`
      ${confirmDialog({
        heading: "Abandonner les modifications ?",
        description: "Ce que vous avez changé ne sera pas enregistré.",
        open: this.discardOpen,
        cancel: "Continuer",
        confirm: "Abandonner",
        onCancel: () => {
          this.discardOpen = false;
        },
        onConfirm: () => {
          this.discardOpen = false;
          this.#leave();
        },
      })}
      ${confirmDialog({
        heading: "Supprimer la catégorie ?",
        description: category
          ? `« ${category.label} » et son formulaire seront supprimés.`
          : "",
        open: this.deleteOpen,
        cancel: "Annuler",
        confirm: "Supprimer",
        onCancel: () => {
          this.deleteOpen = false;
        },
        onConfirm: this.#delete,
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "category-editor-view": CategoryEditorView;
  }
}
