import { db } from "../db.ts";
import { todayISO, type IsoDate } from "../dates.ts";
import { sumByCategory } from "../budget.ts";
import { sumCents } from "../money.ts";
import { hiddenKeys } from "../categories.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import * as categoriesRepo from "./categories.repo.ts";
import type { Category, Post, NewRecord } from "../types.ts";

/**
 * Queries over the unified posts table.
 *
 * "Rendez-vous à venir" and "Dépenses" are two views of the same rows, not
 * two tables: an appointment is a future `date`, an budget is a non-null
 * `amountCents`. Both lean on the `[horseId+date]` compound index.
 */

// IndexedDB range bounds. '' sorts before every date string, '￿' after.
const MIN_DATE = "";
const MAX_DATE = "￿";

const byHorseAndDateRange = (horseId: string, from: IsoDate, to: IsoDate) =>
  db.posts
    .where("[horseId+date]")
    .between([horseId, from], [horseId, to], true, true)
    .toArray();

export const { get, update, remove } = crud<Post>(db.posts);

/**
 * Live posts, less those filed under a category that is switched off.
 *
 * Every list below goes through this, because a disabled category hides its
 * posts from the whole UI — lists, calendar, dashboard and budget totals alike.
 * The catalogue is read *here*, inside the query, rather than handed in by the
 * caller: a Dexie `liveQuery` re-runs only for tables its own query function
 * reads, so this is what makes flipping a switch refresh every open view.
 */
const visible = async (posts: Post[]): Promise<Post[]> => {
  const hidden = hiddenKeys(await categoriesRepo.listAll());
  return liveOnly(posts).filter((post) => !hidden.has(post.categoryKey));
};

/** One post, or `undefined` when it is deleted or its category is switched off. */
export const getVisible = async (id: string): Promise<Post | undefined> => {
  const post = await db.posts.get(id);
  return post ? (await visible([post]))[0] : undefined;
};

/** Every visible post for a horse, newest first. */
export const listByHorse = async (horseId: string): Promise<Post[]> => {
  const posts = await byHorseAndDateRange(horseId, MIN_DATE, MAX_DATE);
  return (await visible(posts)).reverse();
};

/** Visible posts falling inside a calendar range, oldest first. */
export const listInRange = async (
  horseId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<Post[]> => visible(await byHorseAndDateRange(horseId, from, to));

/**
 * Still-to-happen posts, soonest first.
 *
 * Not narrowed to appointments here — that used to filter on the type
 * catalogue inside this query, but a Dexie `liveQuery` only re-runs for
 * tables its own query function reads, and a catalogue received as a plain
 * argument is invisible to that tracking. Narrowing to appointments, and
 * capping to a limit, is `upcomingAppointments` (`categories.ts`)'s job
 * instead — the caller (`HomeView`) joins this against its own `categories`
 * `LiveQuery` in `render()`, the same way `BudgetView`/`PostsView` already
 * join posts against types, so either one updating re-renders correctly.
 */
export const listUpcoming = async (horseId: string): Promise<Post[]> => {
  const posts = await byHorseAndDateRange(horseId, todayISO(), MAX_DATE);
  return (await visible(posts)).filter((post) => post.status === "planned");
};

/**
 * Posts that cost something — i.e. the budget ledger.
 *
 * Reads `customFields.amountCents`, schema v6's replacement for the fixed
 * `amountCents` column — present, and a number, only for a type whose fields
 * carry an amount at all. A zero-cost row still counts: it was recorded
 * deliberately, and it is the *absence* of the field that means "this type
 * has no budget".
 */
export const listBudget = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<Post[]> => {
  const posts = await listInRange(horseId, from, to);
  return posts.filter(
    (post) =>
      typeof post.customFields.amountCents === "number" &&
      post.status !== "cancelled",
  );
};

/** Total spend in cents over a range. */
export const totalSpent = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<number> => {
  const budget = await listBudget(horseId, from, to);
  return sumCents(
    budget.map((post) => {
      const amount = post.customFields.amountCents;
      return typeof amount === "number" ? amount : null;
    }),
  );
};

/**
 * Spend broken down by category.
 *
 * The reduce itself lives in `budget.ts` so the budget view — which
 * aggregates in memory, because a `liveQuery` narrowed by a user-selected period
 * would go stale — and this query cannot disagree about what a breakdown is.
 * Returned as a record because that is the shape callers of this repository
 * expect; the ordered slice list is `sumByCategory`'s own return.
 */
export const totalSpentByCategory = async (
  horseId: string,
  types: Category[],
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<Partial<Record<string, number>>> => {
  const slices = sumByCategory(await listBudget(horseId, from, to), types);
  return Object.fromEntries(slices.map((slice) => [slice.type, slice.cents]));
};

export const create = async (fields: NewRecord<Post>): Promise<Post> => {
  const post = createRecord<Post>(fields);
  await db.posts.add(post);
  return post;
};
