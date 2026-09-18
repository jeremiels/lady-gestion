import type { IconName } from "../components/app-icon/icons.ts";
import { THEME_META, type ThemeKey, type ThemeMeta } from "../theme/theme.ts";

/**
 * Short, stable keys for document categories. Use these in code and storage.
 *
 * The one closed, compile-time taxonomy left in the app: the wording of a
 * folder name is a design decision, so it lives here rather than in a row.
 * Event types were the same shape until schema v6 turned them into user data
 * (`Category` in `data/types.ts`), which is why the generic `taxonomy()`
 * factory this file used to call had exactly one caller left — it is inlined
 * below, since what it produced was four one-line lookups over the table
 * immediately above them.
 */
export type DocumentCategory =
  | "facture"
  | "compte-rendu"
  | "ordonnance"
  | "identite"
  | "photo"
  | "autre";

// No dedicated image icon exists in `icons.ts` yet, so `photo` and `autre`
// both fall back to `folder` and lean on their theme colour to differ.
/** What to call a category, what to draw for it, and which palette entry colours it. */
type DocumentCategoryMeta = {
  label: string;
  icon: IconName;
  theme: ThemeKey;
};

export const DOCUMENT_CATEGORY_META: Record<
  DocumentCategory,
  DocumentCategoryMeta
> = {
  facture: {
    label: "Factures",
    icon: "shoppingCart",
    theme: "taupe",
  },
  "compte-rendu": {
    label: "Compte rendu",
    icon: "firstAidKit",
    theme: "pink",
  },
  ordonnance: {
    label: "Ordonnances",
    icon: "pawPrint",
    theme: "purple",
  },
  identite: {
    label: "Identité",
    icon: "user",
    theme: "brown",
  },
  photo: {
    label: "Photos",
    icon: "folder",
    theme: "turquoise",
  },
  autre: {
    label: "Autres",
    icon: "folder",
    theme: "green",
  },
};

/**
 * The accessors for the table above.
 *
 * `keys` comes out of the same object, so a category cannot be added to the
 * table and forgotten in the list — the failure that would otherwise show up
 * as a folder missing from the documents view.
 */
export const documentCategory = {
  keys: Object.keys(DOCUMENT_CATEGORY_META) as DocumentCategory[],
  label: (key: DocumentCategory): string => DOCUMENT_CATEGORY_META[key].label,
  icon: (key: DocumentCategory): IconName => DOCUMENT_CATEGORY_META[key].icon,
  theme: (key: DocumentCategory): ThemeMeta =>
    THEME_META[DOCUMENT_CATEGORY_META[key].theme],
};

export const DOCUMENT_CATEGORIES = documentCategory.keys;
