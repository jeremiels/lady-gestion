import {
  fieldById,
  fieldWithRole,
  findCategory,
  subtreeKeys,
  upcomingAppointments,
} from "./categories.ts";
import { formatDateMedium, formatTime, type IsoDate } from "./dates.ts";
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
import type { Category, Post } from "./types.ts";

/**
 * What the post views decide — which rows a post's card shows, what a share
 * says, which posts a search keeps, what the dashboard lists — as pure
 * functions over rows the views already hold, so they are tested without a
 * browser and a view keeps only its markup.
 */

/** One row of a post's Informations card, display-ready. */
export type InfoRow = { label: string; value: string };

/**
 * The rows of a post's Informations card after its type, in the order the
 * design draws them; a row with nothing to say is left out, since a card of
 * blanks reads as broken.
 *
 * Every per-type row reads its label and its `customFields` key off the
 * post's own type — the definition the entry form writes from — so what is
 * shown and what was captured cannot drift. `type` is `undefined` for the tick
 * before the catalogue settles, or for a type since deleted: the card then
 * keeps Nom, Date, Lieu and Note rather than throwing.
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

  const counterpartyField = type && fieldById(type, "counterparty");
  const counterparty = value(counterpartyField?.id);
  if (counterpartyField && typeof counterparty === "string" && counterparty) {
    rows.push({ label: counterpartyField.label, value: counterparty });
  }

  const amount = value(type && fieldById(type, "amountCents")?.id);
  if (typeof amount === "number") {
    rows.push({ label: "Budget", value: formatCents(amount, post.currency) });
  }

  // Already display-ready: `valueOf` (`post-form.ts`) wrote it as "1,5 L".
  const quantityField = type && fieldById(type, "quantity");
  const quantity = value(quantityField?.id);
  if (quantityField && typeof quantity === "string" && quantity) {
    rows.push({ label: quantityField.label, value: quantity });
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
  const counterparty =
    type && post.customFields[fieldById(type, "counterparty")?.id ?? ""];
  const amount =
    type && post.customFields[fieldById(type, "amountCents")?.id ?? ""];
  return [
    type?.label ?? "",
    formatDateMedium(post.date),
    typeof counterparty === "string" ? counterparty : "",
    typeof amount === "number" ? formatCents(amount, post.currency) : "",
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
    const counterparty =
      type && post.customFields[fieldById(type, "counterparty")?.id ?? ""];
    const haystack = [
      post.title,
      post.notes ?? "",
      typeof counterparty === "string" ? counterparty : "",
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
