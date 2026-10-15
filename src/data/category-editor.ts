import {
  BASE_FIELD_IDS,
  QUANTITY_UNIT_NAMES,
  canBeParentOf,
  dateField,
  followUpField,
  notesField,
  reminderField,
  timeField,
  titleField,
  type ResolvedCategory,
} from "./categories.ts";
import { editableDecimal, readForm } from "./forms.ts";
import { newId } from "./ids.ts";
import { fromCents } from "./money.ts";
import { fieldSchema, pairErrorsOf, valueOf } from "./post-form.ts";
import { COURSE_CATEGORY_KEYS } from "./posts.ts";
import { foldText } from "./text.ts";
import type {
  Category,
  CustomFieldDef,
  FieldControl,
  FieldOption,
  FieldRole,
} from "./types.ts";

/**
 * The form builder's rules: what a category being edited may hold, what
 * adding, moving, editing and removing a field does, and what a default value
 * parses to — pure functions over a draft, so the builder's screens keep only
 * their markup and `categories.service.ts` validates with the same code they
 * do.
 */

/**
 * What the editor changes on a category: everything but its identity, its
 * slug, its place in the budget ring, the flag saying it came with the app,
 * and its switch in the Catégories tab — a new one starts switched on
 * (`saveCategory`). `acceptsAttachments` is plain here — the row may lack it,
 * the draft may not.
 */
export type CategoryDraft = Pick<
  Category,
  | "label"
  | "parentId"
  | "icon"
  | "theme"
  | "isAppointment"
  | "tracksWork"
  | "fields"
> & { acceptsAttachments: boolean };

/** A new category's form: Nom, Date and Note — the rows every type opens on. */
export const newCategoryDraft = (): CategoryDraft => ({
  label: "",
  parentId: null,
  icon: null,
  theme: null,
  isAppointment: false,
  tracksWork: false,
  acceptsAttachments: false,
  fields: [titleField(), dateField(), notesField()],
});

/** The draft an existing category opens as. */
export const draftOf = (category: Category): CategoryDraft => ({
  label: category.label,
  parentId: category.parentId,
  icon: category.icon,
  theme: category.theme,
  isAppointment: category.isAppointment,
  tracksWork: category.tracksWork,
  acceptsAttachments: category.acceptsAttachments ?? false,
  fields: category.fields,
});

/** The kinds of field "Ajouter un champ" offers — see `FIELD_KINDS`. */
export type FieldKind =
  | "text"
  | "number"
  | "quantity"
  | "money"
  | "date"
  | "checkbox"
  | "select"
  | "combobox"
  | "title"
  | "notes"
  | "time"
  | "followUp"
  | "reminder";

/** What the builder knows about one kind of field. */
export type FieldKindSpec = {
  /** Its name in "Ajouter un champ", and under a row of the form. */
  label: string;
  /** Read by id or by role, so a form carries one at most. */
  unique: boolean;
  /** Whether the field sheet offers Obligatoire. */
  requirable: boolean;
  /** Whether the field sheet offers a value the form opens on. */
  defaultable: boolean;
  /** A fresh field of this kind, labelled by its kind until the user names it. */
  make: () => CustomFieldDef;
};

/** A field made from nothing: a fresh id, and optional. */
const blankField = (
  control: FieldControl,
  label: string,
  extra: Partial<CustomFieldDef> = {},
): CustomFieldDef => ({
  id: newId(),
  label,
  required: false,
  control,
  ...extra,
});

/**
 * Every kind of field the builder offers, in the order "Ajouter un champ"
 * lists them. The first eight are general — a category may carry any number
 * of each; the last five are the rows the app reads by id or by role.
 */
export const FIELD_KINDS: Record<FieldKind, FieldKindSpec> = {
  text: {
    label: "Texte",
    unique: false,
    requirable: true,
    defaultable: true,
    make: () => blankField("text", "Texte"),
  },
  number: {
    label: "Nombre",
    unique: false,
    requirable: true,
    defaultable: true,
    make: () => blankField("number", "Nombre"),
  },
  quantity: {
    label: "Quantité avec unité",
    unique: false,
    requirable: false,
    defaultable: true,
    make: () =>
      blankField("number", "Quantité", { units: QUANTITY_UNIT_NAMES }),
  },
  money: {
    label: "Montant",
    unique: false,
    requirable: true,
    defaultable: true,
    make: () => blankField("money", "Montant", { suffix: "€" }),
  },
  date: {
    label: "Date",
    unique: false,
    requirable: true,
    defaultable: false,
    make: () => blankField("date", "Date"),
  },
  checkbox: {
    label: "Case à cocher",
    unique: false,
    requirable: false,
    defaultable: true,
    make: () => blankField("checkbox", "Case à cocher"),
  },
  select: {
    label: "Liste de choix",
    unique: false,
    requirable: true,
    defaultable: true,
    make: () => blankField("select", "Liste de choix", { options: [] }),
  },
  combobox: {
    label: "Choix ou saisie libre",
    unique: false,
    requirable: true,
    defaultable: true,
    make: () =>
      blankField("combobox", "Choix ou saisie libre", { options: [] }),
  },
  title: {
    label: "Nom",
    unique: true,
    requirable: false,
    defaultable: true,
    make: titleField,
  },
  notes: {
    label: "Note",
    unique: true,
    requirable: true,
    defaultable: true,
    make: notesField,
  },
  time: {
    label: "Heure de début",
    unique: true,
    requirable: true,
    defaultable: false,
    make: timeField,
  },
  followUp: {
    label: "Planifier un rendez-vous",
    unique: true,
    requirable: false,
    defaultable: false,
    make: () => followUpField(),
  },
  reminder: {
    label: "Créer une notification",
    unique: true,
    requirable: false,
    defaultable: false,
    make: reminderField,
  },
};

/** `FIELD_KINDS`'s kinds, in its order. */
export const FIELD_KIND_KEYS = Object.keys(FIELD_KINDS) as FieldKind[];

/**
 * What kind of field this is, as the builder names it. `null` for the one
 * shape it does not offer to add — the work session's activity, which only
 * `Travail` carries.
 */
export const kindOf = (field: CustomFieldDef): FieldKind | null => {
  if (field.id === "title" || field.id === "notes" || field.id === "time") {
    return field.id;
  }
  if (field.role === "followUp" || field.role === "reminder") return field.role;
  if (field.role === "workActivity") return null;
  if (field.control === "number" && field.units) return "quantity";
  if (field.control === "time") return null;
  return field.control;
};

/** What the builder knows about this field's kind — `null` where `kindOf` is. */
export const kindSpecOf = (field: CustomFieldDef): FieldKindSpec | null => {
  const kind = kindOf(field);
  return kind === null ? null : FIELD_KINDS[kind];
};

/** The builder's name for this field's kind, for the row's summary. */
export const kindLabel = (field: CustomFieldDef): string =>
  field.role === "workActivity"
    ? "Activité"
    : (kindSpecOf(field)?.label ?? "Champ");

/**
 * Whether the form already has its one field of a unique kind. A work
 * session's activity counts as its Nom: it is what names the post
 * (`postFields`, `posts.service.ts`), so a second Nom would be asked for and
 * thrown away.
 */
export const hasKind = (
  fields: readonly CustomFieldDef[],
  kind: FieldKind,
): boolean =>
  fields.some(
    (field) =>
      kindOf(field) === kind ||
      (kind === "title" && field.role === "workActivity"),
  );

/**
 * The form with a field of `kind` added — just above Note when the form ends
 * on it, since Note is the row a form closes with — and that field, for the
 * builder to open. A notification needs a start time to count back from, so
 * it brings Heure de début along when the form has none.
 *
 * A first Montant links itself to the budget: a category with an amount and
 * no budget is the exception, not the rule.
 */
export const addField = (
  fields: readonly CustomFieldDef[],
  kind: FieldKind,
): { fields: CustomFieldDef[]; added: CustomFieldDef } => {
  const added = FIELD_KINDS[kind].make();
  if (kind === "money" && !fields.some((field) => field.role === "budget")) {
    added.role = "budget";
  }
  const adding =
    kind === "reminder" && !hasKind(fields, "time")
      ? [timeField(), added]
      : [added];

  const last = fields.at(-1);
  return {
    fields:
      last?.id === "notes"
        ? [...fields.slice(0, -1), ...adding, last]
        : [...fields, ...adding],
    added,
  };
};

/** The form with the field at `from` moved to `to`. */
export const moveField = (
  fields: readonly CustomFieldDef[],
  from: number,
  to: number,
): CustomFieldDef[] => {
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
};

/** The form with `field` replacing the field of the same id. */
const replaceField = (
  fields: readonly CustomFieldDef[],
  field: CustomFieldDef,
): CustomFieldDef[] => fields.map((one) => (one.id === field.id ? field : one));

/**
 * Whether the app depends on this field being in the form, so the builder
 * offers no way to remove it — its label stays editable.
 *
 * The date places a post on the calendar; Nom is what every list shows; a
 * work session's activity is what the week strip draws; a cure's end date
 * and dose are what its tab reads; and a notification counts back from the
 * start time.
 */
export const isProtectedField = (
  category: Pick<Category, "key" | "tracksWork"> & {
    fields: readonly CustomFieldDef[];
  },
  field: CustomFieldDef,
): boolean => {
  if (field.id === "date" || field.id === "title") return true;
  if (field.role === "workActivity" && category.tracksWork) return true;
  if (
    COURSE_CATEGORY_KEYS.includes(category.key) &&
    (field.id === "endDate" || field.id === "dosage")
  ) {
    return true;
  }
  return (
    field.id === "time" &&
    category.fields.some((one) => one.role === "reminder")
  );
};

/** Whether the field is always asked for: Nom, Date, and a session's activity. */
export const isRequiredLocked = (field: CustomFieldDef): boolean =>
  field.id === "date" || field.id === "title" || field.role === "workActivity";

/** The form without the field `id`. */
export const removeField = (
  fields: readonly CustomFieldDef[],
  id: string,
): CustomFieldDef[] => fields.filter((field) => field.id !== id);

/** The roles the builder lets a field take: its value feeding a feature. */
export type LinkableRole = Extract<FieldRole, "budget" | "counterparty">;

/**
 * Each link a field can make to the rest of the app: the control a field
 * needs to make it, and how the field sheet and the form's rows word it.
 */
export const LINKS: Record<
  LinkableRole,
  { control: FieldControl; label: string; hint: string; tag: string }
> = {
  budget: {
    control: "money",
    label: "Compter dans le budget",
    hint: "Le montant s’ajoute aux dépenses de la catégorie.",
    tag: "Budget",
  },
  counterparty: {
    control: "text",
    label: "Intervenant",
    hint: "Affiché sur la fiche, retrouvé par la recherche et repris dans un partage.",
    tag: "Intervenant",
  },
};

const LINKABLE_ROLES = Object.keys(LINKS) as LinkableRole[];

/**
 * The link this field can make to the rest of the app — `undefined` for none.
 * Nom and Note are text too, but they are the post's own columns, not answers
 * a link could be read from.
 */
export const linkableRole = (
  field: CustomFieldDef,
): LinkableRole | undefined =>
  BASE_FIELD_IDS.has(field.id)
    ? undefined
    : LINKABLE_ROLES.find((role) => LINKS[role].control === field.control);

/**
 * The field with its link to the app switched on or off. Switching it on
 * takes the role from whichever other field had it — a category carries one
 * field per role.
 */
export const linkField = (
  fields: readonly CustomFieldDef[],
  id: string,
  linked: boolean,
): CustomFieldDef[] => {
  const target = fields.find((field) => field.id === id);
  const role = target && linkableRole(target);
  if (role === undefined) return [...fields];
  return fields.map((field) => {
    if (field.id === id) return withRole(field, linked ? role : undefined);
    return linked && field.role === role ? withRole(field, undefined) : field;
  });
};

const withRole = (
  field: CustomFieldDef,
  role: FieldRole | undefined,
): CustomFieldDef => {
  const { role: _role, ...rest } = field;
  return role === undefined ? rest : { ...rest, role };
};

/** The field with `defaultValue` set, or removed when there is none. */
export const withDefault = (
  field: CustomFieldDef,
  value: CustomFieldDef["defaultValue"] | undefined,
): CustomFieldDef => {
  const { defaultValue: _defaultValue, ...rest } = field;
  return value === undefined ? rest : { ...rest, defaultValue: value };
};

/**
 * A default value as the field sheet's controls typed it, parsed the way the
 * entry form will parse the field — so a default can never be a value the
 * form would refuse. `values` is keyed by control name, as the form's are:
 * the field's own id, and its unit control's for a quantity.
 *
 * `value` is `undefined` when the controls were left blank: no default.
 */
export const parseDefaultValue = (
  field: CustomFieldDef,
  values: Record<string, string>,
):
  | { ok: true; value: CustomFieldDef["defaultValue"] | undefined }
  | { ok: false; errors: Record<string, string> } => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);

  const parsed = readForm(data, fieldSchema({ ...field, required: false }));
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors as Record<string, string> };
  }

  const answers = parsed.value as Record<string, unknown>;
  const pair = pairErrorsOf(field, answers);
  if (Object.keys(pair).length > 0) return { ok: false, errors: pair };

  // A default is the field's own answer, never what a checkbox reveals.
  const { reveals: _reveals, ...own } = field;
  const value = valueOf(own, answers);
  return {
    ok: true,
    value: value === null || value === false ? undefined : value,
  };
};

/** The default value as the field sheet's text control shows it. */
export const defaultAsText = (field: CustomFieldDef): string => {
  const value = field.defaultValue;
  if (value === undefined || typeof value === "boolean") return "";
  if (field.control === "money" && typeof value === "number") {
    return editableDecimal(fromCents(value));
  }
  return String(value);
};

/**
 * The choices as the field sheet edits them — `value` is `null` for one not
 * saved yet — as they are stored: blanks dropped, and a new one valued by its
 * label as first typed.
 */
export const savedOptions = (
  options: readonly { value: string | null; label: string }[],
): FieldOption[] =>
  options
    .filter((option) => option.label.trim() !== "")
    .map((option) => ({
      value: option.value ?? option.label.trim(),
      label: option.label.trim(),
    }));

/**
 * What stops one field being saved on its own, keyed by the part of the field
 * sheet that shows it: `label` or `options`. Empty when it can be saved.
 */
export const validateField = (
  field: CustomFieldDef,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (field.label.trim() === "") errors.label = "Donnez un nom à ce champ.";

  const options = field.options ?? [];
  const labels = options.map((option) => foldText(option.label));
  if (field.control === "select" && options.length === 0) {
    errors.options = "Ajoutez au moins un choix.";
  } else if (
    labels.some((one, index) => one === "" || labels.indexOf(one) !== index)
  ) {
    errors.options = "Chaque choix doit avoir un nom différent.";
  }
  return errors;
};

/** What the field sheet's controls hold when Valider is pressed. */
export type FieldEdit = {
  label: string;
  /** Obligatoire — kept as it was where the sheet offers it not, or locks it. */
  required: boolean;
  /** The choices as the sheet edits them, for a list. */
  options: readonly { value: string | null; label: string }[];
  /** The default value's controls, as `parseDefaultValue` takes them. */
  defaults: Record<string, string>;
  /** The link's switch, for a field that can make one. */
  linked: boolean;
};

/**
 * The form with `field` as the field sheet edited it — or what stops that,
 * keyed as the sheet shows it: `label`, `options`, or a default value's
 * control. Switching a link on takes it from the field that had it.
 */
export const applyFieldEdit = (
  fields: readonly CustomFieldDef[],
  field: CustomFieldDef,
  edit: FieldEdit,
):
  | { ok: true; fields: CustomFieldDef[] }
  | { ok: false; errors: Record<string, string> } => {
  const spec = kindSpecOf(field);
  const { options: _options, ...rest } = field;
  const edited: CustomFieldDef = {
    ...rest,
    label: edit.label.trim(),
    required:
      spec?.requirable && !isRequiredLocked(field)
        ? edit.required
        : field.required,
    ...(field.control === "select" || field.control === "combobox"
      ? { options: savedOptions(edit.options) }
      : {}),
  };
  const errors = validateField(edited);

  let saved = edited;
  if (spec?.defaultable) {
    const parsed = parseDefaultValue(edited, edit.defaults);
    if (parsed.ok) saved = withDefault(edited, parsed.value);
    else Object.assign(errors, parsed.errors);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const next = replaceField(fields, saved);
  return {
    ok: true,
    fields:
      linkableRole(field) === undefined
        ? next
        : linkField(next, field.id, edit.linked),
  };
};

/**
 * The draft filed under `parentId`, or a root again when that is `null`.
 *
 * A child always takes its parent's colour — what makes a group one wedge in
 * the budget ring — so filing it drops its own. Back to a root, it keeps the
 * look it was inheriting, so nothing repaints: the draft's counterpart of
 * `detachment` (`categories.repo.ts`). `catalogue` is resolved, since that
 * look is what the parent draws.
 */
export const reparent = (
  draft: CategoryDraft,
  parentId: string | null,
  catalogue: readonly ResolvedCategory[],
): CategoryDraft => {
  if (parentId === draft.parentId) return draft;
  if (parentId !== null) return { ...draft, parentId, theme: null };

  const parent = catalogue.find((type) => type.id === draft.parentId);
  return {
    ...draft,
    parentId: null,
    icon: draft.icon ?? parent?.icon ?? null,
    theme: draft.theme ?? parent?.theme ?? null,
  };
};

/**
 * What stops this draft being saved, keyed by what the editor shows it under:
 * `label`, `icon`, `theme`, `parentId`, or `field:<id>` for a row of the form.
 * Empty when it can be saved.
 *
 * `catalogue` is every live category; `selfId` the one being edited, `null`
 * for a new one.
 */
export const validateCategory = (
  draft: CategoryDraft,
  catalogue: Category[],
  selfId: string | null,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  const others = catalogue.filter((type) => type.id !== selfId);

  const label = draft.label.trim();
  if (label === "") errors.label = "Donnez un nom à la catégorie.";
  else if (label.length > 40) {
    errors.label = "Ce nom ne peut pas dépasser 40 caractères.";
  } else if (others.some((type) => foldText(type.label) === foldText(label))) {
    errors.label = "Une catégorie porte déjà ce nom.";
  }

  if (draft.parentId === null) {
    if (draft.icon === null) errors.icon = "Choisissez une icône.";
    if (draft.theme === null) errors.theme = "Choisissez une couleur.";
  } else if (!canBeParentOf(catalogue, selfId, draft.parentId)) {
    errors.parentId = "Cette catégorie ne peut pas être rangée ici.";
  }

  const roles = new Set<FieldRole>();
  for (const field of draft.fields) {
    const own = validateField(field);
    const sharedRole = field.role !== undefined && roles.has(field.role);
    if (field.role !== undefined) roles.add(field.role);
    const message =
      own.label ??
      (sharedRole ? "Un seul champ peut jouer ce rôle." : own.options);
    if (message !== undefined) errors[`field:${field.id}`] = message;
  }

  return errors;
};

/**
 * Whether two values hold the same data, whatever order their keys are in —
 * IndexedDB hands a row back with its keys as stored, and the editor rebuilds
 * a field with them in another order. What decides that saving a draft
 * changed nothing, and so writes nothing.
 */
export const sameData = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
};
