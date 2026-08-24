import { taxonomy, type TaxonomyMeta } from './taxonomy.ts';

/**
 * Short, stable keys for document categories. Use these in code and storage.
 *
 * The presentation triple is `TaxonomyMeta`, shared with `EVENT_TYPE_META` in
 * `event.types.ts` rather than restated here — the two tables used to declare
 * it separately with a comment promising they matched.
 */
export type DocumentCategory =
  | 'facture'
  | 'compte-rendu'
  | 'ordonnance'
  | 'identite'
  | 'photo'
  | 'autre';

// No dedicated image icon exists in `icons.ts` yet, so `photo` and `autre`
// both fall back to `folder` and lean on their theme colour to differ.
export const DOCUMENT_CATEGORY_META: Record<DocumentCategory, TaxonomyMeta> = {
  facture: {
    label: 'Factures',
    icon: 'shoppingCart',
    theme: 'taupe',
  },
  'compte-rendu': {
    label: 'Compte rendu',
    icon: 'firstAidKit',
    theme: 'pink',
  },
  ordonnance: {
    label: 'Ordonnances',
    icon: 'pawPrint',
    theme: 'purple',
  },
  identite: {
    label: 'Identité',
    icon: 'user',
    theme: 'brown',
  },
  photo: {
    label: 'Photos',
    icon: 'folder',
    theme: 'turquoise',
  },
  autre: {
    label: 'Autres',
    icon: 'folder',
    theme: 'green',
  },
};

/** `keys`, `label`, `icon` and `theme` for the table above — see `taxonomy.ts`. */
export const documentCategory = taxonomy(DOCUMENT_CATEGORY_META);

export const DOCUMENT_CATEGORIES = documentCategory.keys;
