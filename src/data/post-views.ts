import {
  BASE_FIELD_IDS,
  amountOf,
  counterpartyOf,
  fieldWithRole,
  findCategory,
  subtreeKeys,
  upcomingAppointments,
} from "./categories.ts";
import {
  formatDateMedium,
  formatTime,
  isIsoDate,
  type IsoDate,
} from "./dates.ts";
import { editableDecimal } from "./forms.ts";
import { formatCents } from "./money.ts";
import {
  coursePhase,
  formatFollowUpInterval,
  formatWorkActivity,
  isCourse,
  isCourseOngoing,
  parseFollowUpValue,
} from "./posts.ts";
import { foldText } from "./text.ts";
import type { Category, CustomFieldDef, Post } from "./types.ts";

/**
 * What the post views decide — which rows a post's card shows, what a share
 * says, which posts a search keeps, what the dashboard lists — as pure
 * functions over rows the views already hold, so they are tested without a
 * browser and a view keeps only its markup.
 */

/** One row of a post's Informations card, display-ready. */
export type InfoRow = { label: string; value: string };

/**
 * One stored answer as the detail card reads it, by the control that took it
 * — or `null` when there is nothing to say: a blank, or a box left unticked.
 *
 * A choice the field no longer offers still shows what was stored, rather
 * than nothing: the record is hers whatever became of the option.
 */
export const formatFieldValue = (
  field: CustomFieldDef,
  value: Post["customFields"][string] | undefined,
  currency: string,
): string | null => {
  if (value === null || value === undefined || value === "") return null;

  if (field.reveals?.length) {
    // A ticked box stores what it revealed — see `valueOf` (`post-form.ts`).
    const [revealed] = field.reveals;
    return revealed ? formatFieldValue(revealed, value, currency) : null;
  }

  switch (field.control) {
    case "money":
      return typeof value === "number" ? formatCents(value, currency) : null;
    case "date":
      return isIsoDate(value) ? formatDateMedium(value) : String(value);
    case "time":
      return typeof value === "string" ? formatTime(value) : null;
    case "checkbox":
      return value === true ? "Oui" : null;
    case "number":
      // A `units` field is stored already worded, "1,5 L".
      return typeof value === "number" ? editableDecimal(value) : String(value);
    case "select":
    case "combobox":
    case "text":
      return (
        field.options?.find((option) => option.value === value)?.label ??
        String(value)
      );
  }
};

/** The roles whose rows `postInfoRows` words itself rather than generically. */
const WORDED_ROLES = new Set<CustomFieldDef["role"]>([
  "workActivity",
  "counterparty",
  "budget",
  "followUp",
  "reminder",
]);

/**
 * The rows of a post's Informations card after its type, in the order the
 * design draws them; a row with nothing to say is left out, since a card of
 * blanks reads as broken.
 *
 * The fields the app has a role for come first and are worded by it; every
 * other field the type declares follows in its form's order — so a field made
 * in the form builder shows up here the moment it holds something. Labels and
 * `customFields` keys come off the post's own type, the definition the entry
 * form writes from, so what is shown and what was captured cannot drift.
 * `type` is `undefined` for the tick before the catalogue settles, or for a
 * type since deleted: the card then keeps Nom, Date, Lieu and Note rather than
 * throwing.
 */
export const postInfoRows = (
  post: Post,
  type: Category | undefined,
): InfoRow[] => {
  const rows: InfoRow[] = [
    { label: "Nom", value: post.title },
    {
      label: "Date",
      value: post.time
        ? `${formatDateMedium(post.date)} · ${formatTime(post.time)}`
        : formatDateMedium(post.date),
    },
  ];
  const value = (id: string | undefined) =>
    id === undefined ? undefined : post.customFields[id];

  const activity = value(type && fieldWithRole(type, "workActivity")?.id);
  if (typeof activity === "string" && activity) {
    rows.push({ label: "Activité", value: formatWorkActivity(activity) });
  }

  const counterpartyField = type && fieldWithRole(type, "counterparty");
  const counterparty = counterpartyOf(post, type);
  if (counterpartyField && counterparty !== null) {
    rows.push({ label: counterpartyField.label, value: counterparty });
  }

  const amount = amountOf(post, type);
  if (amount !== null) {
    rows.push({ label: "Budget", value: formatCents(amount, post.currency) });
  }

  for (const field of type?.fields ?? []) {
    if (BASE_FIELD_IDS.has(field.id) || WORDED_ROLES.has(field.role)) continue;
    const shown = formatFieldValue(field, value(field.id), post.currency);
    if (shown !== null) rows.push({ label: field.label, value: shown });
  }

  const followUp = value(type && fieldWithRole(type, "followUp")?.id);
  const interval =
    typeof followUp === "string" ? parseFollowUpValue(followUp) : null;
  if (interval) {
    rows.push({
      label: "Prochain rendez-vous",
      value: formatFollowUpInterval(interval),
    });
  }

  // Read back through the field's own options, which is where the wording
  // the form offered lives.
  const reminderField = type && fieldWithRole(type, "reminder");
  const reminder = value(reminderField?.id);
  const reminderLabel = reminderField?.reveals
    ?.flatMap((child) => child.options ?? [])
    .find((option) => option.value === reminder)?.label;
  if (reminderLabel) rows.push({ label: "Notification", value: reminderLabel });

  if (post.location) rows.push({ label: "Lieu", value: post.location });
  if (post.notes) rows.push({ label: "Note", value: post.notes });

  return rows;
};

/**
 * The text a shared post carries: its type, date, practitioner or merchant
 * and amount — read through the type's fields, as the card reads them.
 */
export const shareSummary = (
  post: Post,
  type: Category | undefined,
): string => {
  const amount = amountOf(post, type);
  return [
    type?.label ?? "",
    formatDateMedium(post.date),
    counterpartyOf(post, type) ?? "",
    amount === null ? "" : formatCents(amount, post.currency),
  ]
    .filter(Boolean)
    .join(" · ");
};

/**
 * The list's posts: not cancelled, under `categoryKey` or one of its children
 * when one is picked, and matching `query` — in the title, note,
 * practitioner or merchant, place or category name, ignoring case and accents.
 */
export const filterPosts = (
  posts: Post[],
  types: Category[],
  { categoryKey, query }: { categoryKey: string | null; query: string },
): Post[] => {
  const needle = foldText(query);
  // A root chip covers its children too — `subtreeKeys` is a singleton for a
  // type with none.
  const keys = categoryKey === null ? null : subtreeKeys(types, categoryKey);

  return posts.filter((post) => {
    if (post.status === "cancelled") return false;
    if (keys && !keys.has(post.categoryKey)) return false;
    if (!needle) return true;

    const type = findCategory(types, post.categoryKey);
    const haystack = [
      post.title,
      post.notes ?? "",
      counterpartyOf(post, type) ?? "",
      post.location ?? "",
      type?.label ?? "",
    ].join(" ");
    return foldText(haystack).includes(needle);
  });
};

/**
 * The calendar's two kinds of post: cures and traitements, drawn as a bar over
 * the days they run — cancelled ones left out, as cancelled events are — and
 * everything else, drawn as a dot on its day.
 */
export const splitCourses = (
  posts: Post[],
): { courses: Post[]; events: Post[] } => ({
  courses: posts.filter(
    (post) => isCourse(post) && post.status !== "cancelled",
  ),
  events: posts.filter((post) => !isCourse(post)),
});

/**
 * The dashboard's two lists: the next `limit` appointments, and the cures and
 * traitements running today.
 *
 * A cure is an appointment category, so it is upcoming until the day it
 * starts and "en cours" from then on — never both. `upcoming` is what
 * `postsRepo.listUpcoming` returned, `courses` every cure and traitement.
 */
export const dashboardAgenda = (
  upcoming: Post[],
  courses: Post[],
  types: Category[],
  today: IsoDate,
  limit: number,
): { upcoming: Post[]; ongoing: Post[] } => ({
  upcoming: upcomingAppointments(
    upcoming.filter(
      (post) => !isCourse(post) || coursePhase(post, today) === "upcoming",
    ),
    types,
    limit,
  ),
  ongoing: courses.filter((post) => isCourseOngoing(post, today)),
});
