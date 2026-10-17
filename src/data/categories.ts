import { isIconName, type IconName } from "../components/app-icon/icons.ts";
import { isThemeKey } from "../theme/theme.ts";
import type { ThemeKey } from "../theme/theme.types.ts";
import type { IsoTimestamp } from "./dates.ts";
import type {
  CustomFieldDef,
  FieldOption,
  FieldRole,
  Category,
  Post,
} from "./types.ts";

/**
 * Pure functions over the category catalogue, and its built-in seed data.
 *
 * Mirrors `posts.ts`: that file holds pure functions over `Post`, this
 * one holds pure functions over `Category` — the row `Post.categoryKey`
 * points at (`types.ts`). Deliberately does not import `posts.ts` and is not
 * imported by it, even though both are needed together by the day-sheet write
 * path and the week strip: `posts.ts` already owns the `FollowUpInterval`
 * encoding, and either direction of import between the two would be circular
 * the moment the other reaches back.
 */

/**
 * The follow-up intervals, and the units a quantity is measured in.
 *
 * The one statement of this list. `posts.ts` used to carry a second one as
 * `FOLLOW_UP_INTERVALS`, in the structured `{ amount, unit }` encoding rather
 * than the `6w`/`3m` codes stored here — and the two had already drifted apart
 * (`3w`/`7w` here against `2w`/`4w` there) before anything noticed, because
 * nothing read the other copy. It is gone; this is what the form offers, and
 * `followUpValue`/`parseFollowUpValue` (`posts.ts`) is the round trip between
 * these codes and the structure. Exported for the test that holds them to it.
 */
export const FOLLOW_UP_OPTIONS: FieldOption[] = [
  { value: "3w", label: "3 semaines" },
  { value: "6w", label: "6 semaines" },
  { value: "7w", label: "7 semaines" },
  { value: "8w", label: "8 semaines" },
  { value: "3m", label: "3 mois" },
  { value: "6m", label: "6 mois" },
  { value: "12m", label: "1 an" },
];

/**
 * How long before a record's date and time its push reminder goes out. The
 * codes are what `customFields.reminder` stores; `REMINDER_OFFSET_MINUTES`
 * (`posts.ts`) turns them back into a duration.
 */
export const REMINDER_OPTIONS: FieldOption[] = [
  { value: "10min", label: "10 minutes avant" },
  { value: "1h", label: "1 heure avant" },
  { value: "12h", label: "12 heures avant" },
  { value: "24h", label: "1 jour avant" },
  { value: "48h", label: "2 jours avant" },
];

export const QUANTITY_UNIT_NAMES = ["mL", "kg", "L"] as const;

/**
 * The fields that land on a `Post` column rather than in
 * `customFields`. A type lists them in its own `fields` like any other row —
 * that is what makes the array the whole form and not just its variable part.
 */
export const BASE_FIELD_IDS = new Set(["title", "date", "time", "notes"]);

/**
 * What every field constructor below takes: everything `CustomFieldDef` has
 * beyond its `control` (each constructor fixes that itself), with `required`
 * defaulted to `false` — the common case for everything but a handful of
 * built-ins that opt into it explicitly.
 *
 * One config shape per `FieldControl` value is what makes a type's `fields`
 * array read as data — `id`, storage key; `label`, what's shown; the rest are
 * the composable modifiers `CustomFieldDef` documents (`role`, `reveals`,
 * `units`, `suggestions`, `suffix`, `defaultValue`) — rather than a pile of
 * differently-shaped one-off helpers.
 */
type FieldConfig = Omit<CustomFieldDef, "control" | "required"> & {
  required?: boolean;
};

const buildField =
  (control: CustomFieldDef["control"]) =>
  (config: FieldConfig): CustomFieldDef => ({
    required: false,
    ...config,
    control,
  });

/** A free-text field — a name, a note, a practitioner. */
const inputTextField = buildField("text");

/** A numeric field, optionally paired with a unit picker (`units`). */
const inputNumberField = buildField("number");

/** A date picker. */
const inputDateField = buildField("date");

/** A clock-time picker, `HH:mm`. */
const inputTimeField = buildField("time");

/** A currency amount, stored in cents. */
const inputMoneyField = buildField("money");

/** A checkbox, optionally revealing more fields while ticked (`reveals`). */
const inputCheckboxField = buildField("checkbox");

/** A closed list (`options`). */
const inputSelectField = buildField("select");

/** An open list: `options` plus, optionally, a live catalogue (`suggestions`). */
const comboBoxField = buildField("combobox");

/** How much product a purchase brought in, with its unit — `alimentation`'s. */
export const quantityField = () =>
  inputNumberField({
    id: "quantity",
    label: "Quantité du produit",
    units: QUANTITY_UNIT_NAMES,
  });

/**
 * What makes a cure or a traitement a course rather than a one-off: when it
 * stops (empty while it is still running) and how much is given a day. Read
 * back by `courseEndDate` and `formatDosePerDay` (`posts.ts`) for the horse
 * page's Cures and Traitements tabs.
 */
const courseFields = () => [
  inputDateField({ id: "endDate", label: "Date de fin" }),
  inputNumberField({
    id: "dosage",
    label: "Dose par jour",
    units: QUANTITY_UNIT_NAMES,
  }),
];

/**
 * One definition per row the built-ins share.
 *
 * `BUILT_IN_CATEGORIES` below is data and is allowed to be long, but a row that
 * appears in eight types should be *declared* in one place: the follow-up
 * checkbox and the select it reveals are thirteen lines that every care type
 * needs identically, and Nom, Date, Note and Budget are carried by almost all
 * fourteen.
 */

/** Nom — the record's title. A `workActivity` type has no Nom of its own. */
export const titleField = () =>
  inputTextField({ id: "title", label: "Nom", required: true });

/** Date — the one field every single type carries. */
export const dateField = () =>
  inputDateField({ id: "date", label: "Date", required: true });

/**
 * Heure de début — the record's `time` column. What a reminder counts back
 * from, so a type that carries `reminderField` carries this too.
 */
export const timeField = () =>
  inputTimeField({ id: "time", label: "Heure de début" });

/** Note — the free-text row every type ends on. */
export const notesField = () => inputTextField({ id: "notes", label: "Note" });

/** What it cost. `concours` calls it an entry fee rather than a budget. */
const budgetField = (label = "Budget") =>
  inputMoneyField({ id: "amountCents", label, suffix: "€", role: "budget" });

/**
 * Who it was with — a practitioner for a care type, a merchant for a purchase.
 *
 * One role for both, so the detail view and the search box find it whatever a
 * type calls it. The label is the type's own wording, and `defaultValue` is
 * only written when there is one: under `exactOptionalPropertyTypes` an
 * explicit `undefined` is a key that is *present*, which would change the
 * stored row.
 */
const counterpartyField = (label: string, defaultValue?: string) =>
  inputTextField({
    id: "counterparty",
    label,
    role: "counterparty",
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });

/**
 * "Planifier un rendez-vous", and the interval it reveals while ticked.
 *
 * The most-repeated compound field in the catalogue: eight types carry it,
 * and `cures` words it as a renewal rather than an appointment.
 */
export const followUpField = (label = "Planifier un rendez-vous") =>
  inputCheckboxField({
    id: "followUp",
    label,
    role: "followUp",
    reveals: [
      inputSelectField({
        id: "followUp-interval",
        label: "Prochain rendez-vous à planifier",
        required: true,
        options: FOLLOW_UP_OPTIONS,
      }),
    ],
  });

/**
 * "Créer une notification", and the delay it reveals while ticked — a push
 * reminder sent that long before the record's date and `timeField`.
 */
export const reminderField = () =>
  inputCheckboxField({
    id: "reminder",
    label: "Créer une notification",
    role: "reminder",
    reveals: [
      inputSelectField({
        id: "reminder-offset",
        label: "Me prévenir",
        required: true,
        options: REMINDER_OPTIONS,
      }),
    ],
  });

/**
 * The type catalogue's seed data: the fourteen types a new install starts
 * with, ten of them roots. `cures` files under `alimentation`, `traitement`
 * under `veto`, and `osteo` and `massage` under `soins`, so each inherits its
 * parent's presentation and its spend rolls into the parent's wedge.
 *
 * Stamped into rows by `seedCategories` below on a first install only
 * (`seedCategoriesOnFirstInstall`, `seed.ts`): the model a new device starts
 * from. An installed device's categories are hers, so an edit here never
 * reaches them.
 */
export const BUILT_IN_CATEGORIES: Omit<
  Category,
  "id" | "ownerId" | "createdAt" | "updatedAt" | "deletedAt"
>[] = [
  {
    key: "achat",
    label: "Achats",
    parentId: null,
    icon: "shoppingCart",
    theme: "taupe",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    enabled: true,
    order: 0,
    fields: [
      titleField(),
      dateField(),
      budgetField(),
      counterpartyField("Site"),
      notesField(),
    ],
  },
  {
    key: "alimentation",
    label: "Alimentation",
    parentId: null,
    icon: "carrot",
    theme: "coral",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    enabled: true,
    order: 1,
    fields: [
      titleField(),
      dateField(),
      budgetField(),
      quantityField(),
      counterpartyField("Site"),
      notesField(),
    ],
  },
  {
    key: "travail",
    label: "Travail",
    parentId: null,
    icon: "cowboyHat",
    theme: "orange",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: true,
    enabled: true,
    order: 2,
    fields: [
      dateField(),
      comboBoxField({
        id: "activity",
        label: "Nom",
        required: true,
        role: "workActivity",
        suggestions: "activities",
      }),
      notesField(),
    ],
  },
  {
    key: "cours",
    label: "Cours",
    parentId: null,
    icon: "cactus",
    theme: "brown",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    enabled: true,
    order: 3,
    fields: [
      titleField(),
      budgetField(),
      inputTextField({
        id: "coach",
        label: "Coach",
        defaultValue: "Fabien Cassagnaud",
      }),
      dateField(),
      notesField(),
    ],
  },
  {
    key: "dentiste",
    label: "Dentiste",
    parentId: null,
    icon: "tooth",
    theme: "purple",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 4,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien", "Valérie de Picciotto"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
  {
    key: "marechal",
    label: "Maréchal",
    parentId: null,
    icon: "footprints",
    theme: "grey",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 5,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien", "Carl Delepine"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
  {
    key: "veto",
    label: "Vétérinaire",
    parentId: null,
    icon: "firstAidKit",
    theme: "mint",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 6,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien", "Dr. Orange"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
  {
    key: "osteo",
    label: "Ostéopathe",
    // A child of `soins`, alongside `massage` below — both are care
    // appointments a client books through the same "Soins" entry point.
    // `parentId` holds the parent's `id`, not its `key` — see the note on
    // `cures` further down for why a literal slug is valid here.
    parentId: "soins",
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 7,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
  {
    key: "pension",
    label: "Pension",
    parentId: null,
    icon: "farm",
    theme: "green",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    enabled: true,
    order: 8,
    fields: [titleField(), dateField(), budgetField(), notesField()],
  },
  {
    key: "concours",
    label: "Concours",
    // Placeholder — see the module doc comment. A real "trophy" icon doesn't
    // exist yet; a competition's venue is the fixed `location` field, so no
    // counterparty field is needed here the way the care types have one.
    parentId: null,
    icon: "pawPrint",
    theme: "gold",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    enabled: true,
    order: 9,
    fields: [
      titleField(),
      dateField(),
      inputTextField({ id: "competition", label: "Épreuve", required: true }),
      budgetField("Budget engagement"),
      inputSelectField({
        id: "result",
        label: "Résultat",
        options: [
          { value: "Sans Faute", label: "Sans Faute" },
          { value: "Sans faute classé", label: "Sans faute classé" },
          { value: "4pts", label: "4 pts" },
          { value: "8pts", label: "8 pts" },
          { value: "12pts", label: "12 pts" },
          { value: "16pts", label: "16 pts" },
          { value: "20pts", label: "20 pts" },
          { value: "Éliminées", label: "Éliminées" },
        ],
        required: true,
      }),
      notesField(),
    ],
  },
  {
    key: "soins",
    label: "Soins",
    parentId: null,
    icon: "heart",
    theme: "peach",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 10,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
  {
    key: "cures",
    label: "Cures",
    // A child of `alimentation`: a cure is a course of supplements, which is
    // what the group reads as. `parentId` holds the parent's `id`, not its
    // `key` — the two happen to be equal for a built-in because
    // `seedCategories` below stamps `id: def.key` on purpose, and that is
    // the only reason a literal slug is writable here.
    parentId: "alimentation",
    // Both null: inherited from the parent. `theme` always is — a group reads
    // as one colour in the budget ring, and that is the invariant the whole
    // feature rests on. `icon` is inherited too, for want of one of its own; a
    // real `IconName` written on this row takes over from the parent's.
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    acceptsAttachments: true,
    enabled: true,
    order: 11,
    fields: [
      titleField(),
      dateField(),
      timeField(),
      ...courseFields(),
      followUpField("Planifier un renouvellement"),
      reminderField(),
      notesField(),
    ],
  },
  {
    key: "traitement",
    label: "Traitement",
    // A child of `veto`, the same way `cures` is one of `alimentation` — see
    // the note there for why a literal slug is a valid `id` in this table.
    parentId: "veto",
    // `info` was this row's placeholder icon, and it is also what
    // `resolveCatalogue` falls back to for a row carrying nothing usable —
    // inheriting Vétérinaire's `firstAidKit` says more than either.
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    acceptsAttachments: true,
    enabled: true,
    order: 12,
    fields: [
      titleField(),
      dateField(),
      timeField(),
      ...courseFields(),
      counterpartyField("Practicien"),
      budgetField(),
      followUpField(),
      reminderField(),
      notesField(),
    ],
  },
  {
    key: "massage",
    label: "Massage",
    parentId: "soins",
    // Both null: inherited from `soins`, like its sibling `osteo` — there is
    // no dedicated icon for this type.
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    enabled: true,
    order: 13,
    fields: [
      titleField(),
      dateField(),
      counterpartyField("Practicien"),
      budgetField(),
      followUpField(),
      notesField(),
    ],
  },
];

/**
 * Stamps `BUILT_IN_CATEGORIES` into real rows, for a first install
 * (`seedCategoriesOnFirstInstall`, `seed.ts`).
 *
 * `id` is the type's own `key`, not a fresh `newId()`: every device seeds the
 * *same* built-in catalogue on its own — a phone, then the new phone its
 * backup is restored onto — and a row is addressed by its `id`. A random id
 * each time would make every install produce a *different* 14 rows for the
 * same 14 types, and the built-ins' `parentId`s, which name their parent by
 * `id`, would point at nothing. Deriving `id` from `key` is what makes two
 * independent seeds agree on what the row *is* without either one having to
 * ask the other first.
 */
export const seedCategories = (
  ownerId: string,
  timestamp: IsoTimestamp,
): Category[] =>
  BUILT_IN_CATEGORIES.map((def) => ({
    ...def,
    id: def.key,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));

/**
 * A type whose presentation is settled: no `null` left to think about.
 *
 * What every view consumes — `categories.repo.ts`'s `listResolved` produces
 * it, and it stays assignable to `Category`, so the accessors below take
 * either. The raw row is still what the type editor wants: only it needs to
 * see the `null` that means "inherited" in order to say so.
 */
export type ResolvedCategory = Omit<Category, "icon" | "theme"> & {
  icon: IconName;
  theme: ThemeKey;
};

/**
 * What a root falls back to when it carries no usable presentation of its own.
 *
 * Not reachable from the app's own write paths — the editor requires both on a
 * root — but very reachable from a restored backup, which `assertSnapshot`
 * checks for `id` and `updatedAt` and nothing else. `"info"` is already what
 * `post-card` fell back to in that case before this file did; `"taupe"` is the
 * catalogue's most neutral tone.
 */
const DEFAULT_ICON: IconName = "info";
const DEFAULT_THEME: ThemeKey = "taupe";

/** The stored value if it is one this build can actually draw, else nothing. */
const ownIcon = (type: Category): IconName | undefined =>
  type.icon !== null && isIconName(type.icon) ? type.icon : undefined;

const ownTheme = (type: Category): ThemeKey | undefined =>
  type.theme !== null && isThemeKey(type.theme) ? type.theme : undefined;

/**
 * This type's parent, or `undefined` when it is a root.
 *
 * A `parentId` that resolves to nothing in the caller's own list counts as a
 * root, not as an error: the parent may have been soft-deleted on another
 * device, or a hand-edited backup may hold the child without it.
 * Rendering the child as a root is the one outcome that keeps it visible and
 * editable — dropping it, or throwing, loses it. `rootsOf` applies the same
 * rule from the other side, so the two can never disagree about what a root is.
 */
const parentOf = <T extends Category>(types: T[], type: T): T | undefined =>
  type.parentId === null
    ? undefined
    : types.find((candidate) => candidate.id === type.parentId);

/**
 * Fills in every row's `icon`/`theme` from its parent, in one pass.
 *
 * A single hop, because the depth cap says a parent is a root
 * (`canBeParentOf`). A deeper chain is only reachable from data this build did
 * not write, and resolves against its immediate parent's *own* values, falling
 * back to the defaults above rather than walking — bounded by construction, so
 * no cycle in imported data can hang a render.
 *
 * This is also the app's only guard on those two columns. `THEME_META[key]` is
 * a mapped type, so an unknown theme string from a backup file is a `TypeError`
 * at render rather than a missing colour; `ownTheme`/`ownIcon` above turn it
 * into the default here instead, once, for every read site at the same time.
 */
export const resolveCatalogue = (types: Category[]): ResolvedCategory[] => {
  const byId = new Map(types.map((type) => [type.id, type]));

  return types.map((type) => {
    const parent = type.parentId === null ? undefined : byId.get(type.parentId);

    return {
      ...type,
      // A dangling parent is normalised away here, so a resolved catalogue can
      // be filtered on `parentId === null` directly.
      parentId: parent ? type.parentId : null,
      icon: ownIcon(type) ?? (parent && ownIcon(parent)) ?? DEFAULT_ICON,
      theme: ownTheme(type) ?? (parent && ownTheme(parent)) ?? DEFAULT_THEME,
    };
  });
};

/**
 * The categories switched on — what every view offers and draws.
 *
 * Takes a *resolved* catalogue on purpose: a child keeps the icon and theme it
 * inherits from a parent that is switched off, because resolving happened on
 * the whole table first. Its `parentId` still names that parent, which is no
 * longer in the list — and `rootsOf` already reads a parent missing from the
 * caller's list as "root", so the child stands on its own in pickers, chips
 * and the budget ring without a special case. A parent's switch does not
 * reach its children.
 */
export const enabledOf = <T extends Category>(types: T[]): T[] =>
  types.filter((type) => type.enabled);

/**
 * The keys whose posts are hidden: every category switched off. The other
 * half of `enabledOf`, for the posts side — a post whose key names no category
 * at all is not in here, so it stays visible: nothing switched it off.
 */
export const hiddenKeys = (types: Category[]): Set<string> =>
  new Set(types.filter((type) => !type.enabled).map((type) => type.key));

/** The types with no parent, in `order` — the top level of the picker, the
 * chips and the budget ring. The whole shipped catalogue is one of these. */
export const rootsOf = <T extends Category>(types: T[]): T[] => {
  const ids = new Set(types.map((type) => type.id));
  return byOrder(
    types.filter((type) => type.parentId === null || !ids.has(type.parentId)),
  );
};

/** The direct children of `parentId`, in `order`. Empty for a leaf. */
export const childrenOf = <T extends Category>(
  types: T[],
  parentId: string,
): T[] => byOrder(types.filter((type) => type.parentId === parentId));

/** The root this type hangs under — itself when it is one. */
export const rootOf = <T extends Category>(types: T[], type: T): T =>
  parentOf(types, type) ?? type;

/**
 * The `Post.categoryKey` slugs a filter on `key` should match: the type's own,
 * plus its children's.
 *
 * Keys rather than ids because this is compared against `Post.categoryKey`,
 * which stores the slug. A flat catalogue makes this a singleton, which is
 * exactly today's `event.categoryKey === filter`.
 */
export const subtreeKeys = (types: Category[], key: string): Set<string> => {
  const type = findCategory(types, key);
  if (!type) return new Set([key]);
  return new Set([
    key,
    ...childrenOf(types, type.id).map((child) => child.key),
  ]);
};

/**
 * The depth-2 invariant, as one predicate — the only thing standing between
 * this table and a cycle.
 *
 * Four rules, and together they make a cycle unrepresentable without any
 * recursive check: a type cannot be its own parent, both rows must exist, the
 * proposed parent must itself be a root, and a type that already has children
 * cannot be given one. The last two are the same rule seen from each end, and
 * dropping either would let a three-deep chain in.
 *
 * `childId` is `null` for a category not made yet: it has no row and no
 * children, so only the parent's end is checked.
 */
export const canBeParentOf = (
  types: Category[],
  childId: string | null,
  parentId: string,
): boolean => {
  if (childId === parentId) return false;

  const parent = types.find((type) => type.id === parentId);
  if (!parent || parentOf(types, parent) !== undefined) return false;
  if (childId === null) return true;

  const child = types.find((type) => type.id === childId);
  return child !== undefined && childrenOf(types, childId).length === 0;
};

/**
 * The type whose `key` matches, or `undefined` if the caller's list has none.
 *
 * Generic over the row rather than fixed to `Category` — the views hand it
 * a `ResolvedCategory[]` and would otherwise get a raw `Category` back,
 * losing exactly the non-null `icon`/`theme` they resolved the catalogue for.
 * Same reason for `byLabel` and `byOrder` below.
 */
export const findCategory = <T extends Category>(
  types: T[],
  key: string,
): T | undefined => types.find((type) => type.key === key);

/** Alphabetical by label — the order a filter list or a type picker offers them in. */
export const byLabel = <T extends Category>(types: T[]): T[] =>
  [...types].sort((a, b) => a.label.localeCompare(b.label, "fr"));

/**
 * By `order` — the stable sequence that keeps a category, and therefore its
 * colour and its neighbours, in the same place in the budget donut from one
 * month to the next. Replaces the fixed `EVENT_TYPES` array `sumByCategory` used
 * to iterate before types became data.
 */
export const byOrder = <T extends Category>(types: T[]): T[] =>
  [...types].sort((a, b) => a.order - b.order);

/**
 * The field that plays `role` in this type, if one does. A category carries at
 * most one field per role — the form builder refuses a second
 * (`category-editor.ts`).
 */
export const fieldWithRole = (
  type: Category,
  role: FieldRole,
): CustomFieldDef | undefined =>
  type.fields.find((field) => field.role === role);

/**
 * The amount the budget counts for this post — its type's `budget` field —
 * or `null` when the type has none, the post left it blank, or the type is
 * not in the caller's list.
 */
export const amountOf = (
  post: Post,
  type: Category | undefined,
): number | null => {
  const field = type && fieldWithRole(type, "budget");
  const value = field ? post.customFields[field.id] : undefined;
  return typeof value === "number" ? value : null;
};

/** Who the post was with — its type's `counterparty` field — or `null`. */
export const counterpartyOf = (
  post: Post,
  type: Category | undefined,
): string | null => {
  const field = type && fieldWithRole(type, "counterparty");
  const value = field ? post.customFields[field.id] : undefined;
  return typeof value === "string" && value !== "" ? value : null;
};

/** The field with this stable `id`, if the type has one. */
export const fieldById = (
  type: Category,
  id: string,
): CustomFieldDef | undefined => type.fields.find((field) => field.id === id);

/**
 * The types the dashboard's "Rendez-vous à venir" list is about.
 *
 * Replaces the hardcoded `APPOINTMENT_TYPES` Set `posts.ts` used to keep: a
 * rendez-vous is booked with someone, and which types that is is now a
 * property of the type itself (`isAppointment`) rather than a closed list in
 * code — `categories.repo.ts`'s seed sets it exactly the way the old Set did.
 */
export const isAppointmentCategory = (
  types: Category[],
  key: string,
): boolean => findCategory(types, key)?.isAppointment ?? false;

/**
 * Narrows a list of events to the ones that are actually *appointments* — see
 * `isAppointmentCategory` — capped to `limit`.
 *
 * Pure, over events and types the caller already fetched: `HomeView` holds
 * both in their own `LiveQuery`, and joining them here rather than inside
 * `postsRepo.listUpcoming`'s own query is what keeps the dashboard reactive
 * to a type's `isAppointment` flag changing — a Dexie `liveQuery` only re-runs
 * for tables its own query function reads, and `eventTypes` is not one of
 * them for a query that receives the catalogue as a plain argument instead.
 */
export const upcomingAppointments = (
  events: Post[],
  types: Category[],
  limit?: number,
): Post[] => {
  const appointments = events.filter((event) =>
    isAppointmentCategory(types, event.categoryKey),
  );
  return limit === undefined ? appointments : appointments.slice(0, limit);
};
