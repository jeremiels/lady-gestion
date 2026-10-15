import { db } from "../db.ts";
import { nowTime, todayISO, type IsoDate } from "../dates.ts";
import { sumByCategory } from "../budget.ts";
import { sumCents } from "../money.ts";
import { amountOf, findCategory, hiddenKeys } from "../categories.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import * as categoriesRepo from "./categories.repo.ts";
import type { Category, Post, NewRecord } from "../types.ts";

/**
 * Queries over the unified posts table.
 *
 * "Rendez-vous à venir" and "Dépenses" are two views of the same rows, not
 * two tables: an appointment is a future `date`, a spend is an amount in the
 * category's budget field. Both lean on the `[horseId+date]` compound index.
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

/**
 * Every visible post filed under one of `keys`, newest first — the horse
 * page's Cures and Traitements tabs, and the dashboard's courses in progress.
 * Matched on the exact key: a child category's posts are not its parent's.
 */
export const listByCategory = async (
  horseId: string,
  keys: readonly string[],
): Promise<Post[]> =>
  (await listByHorse(horseId)).filter((post) =>
    keys.includes(post.categoryKey),
  );

/** Visible posts falling inside a calendar range, oldest first. */
export const listInRange = async (
  horseId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<Post[]> => visible(await byHorseAndDateRange(horseId, from, to));

/**
 * Visible posts of every horse dated `from` or later — the horizon push
 * reminders are computed over (`reminders.ts`). Unordered.
 */
export const listFrom = async (from: IsoDate): Promise<Post[]> =>
  visible(await db.posts.where("date").aboveOrEqual(from).toArray());

/**
 * Still-to-happen posts, soonest first: not cancelled, and dated after today,
 * or today at a time not yet passed.
 *
 * Judged by the date and time at read time rather than by `status`, which is
 * fixed at write time — an appointment entered this morning for this
 * afternoon is stored `done` (`statusForDate`) and would otherwise never be
 * listed.
 *
 * **A post of today with no time stays listed until midnight**, whether it
 * has happened or not: nothing says which. The time is read when the query
 * runs — at opening, on any write, and at midnight — so a passed time drops
 * out at the next of those, not on the minute.
 *
 * Not narrowed to appointments here: a Dexie `liveQuery` only re-runs for
 * tables its own query function reads, and a catalogue received as a plain
 * argument is invisible to that tracking. Narrowing to appointments, and
 * capping to a limit, is `upcomingAppointments` (`categories.ts`)'s job —
 * the caller (`HomeView`) joins this against its own `categories`
 * `LiveQuery` in `render()`, so either one updating re-renders correctly.
 */
export const listUpcoming = async (horseId: string): Promise<Post[]> => {
  const today = todayISO();
  const now = nowTime();
  const posts = await byHorseAndDateRange(horseId, today, MAX_DATE);
  return (await visible(posts)).filter(
    (post) =>
      post.status !== "cancelled" &&
      (post.date > today || post.time === null || post.time >= now),
  );
};

/**
 * Posts that cost something — i.e. the budget ledger: an amount in the field
 * their category links to the budget (`amountOf`). A zero-cost row still
 * counts: it was recorded deliberately, and it is the *absence* of an amount
 * that means "nothing to budget".
 *
 * Reads the catalogue itself, as `visible` does, so the ledger follows a
 * category whose budget link is switched on or off.
 */
export const listBudget = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<Post[]> => {
  const [posts, types] = await Promise.all([
    listInRange(horseId, from, to),
    categoriesRepo.listAll(),
  ]);
  return posts.filter(
    (post) =>
      post.status !== "cancelled" &&
      amountOf(post, findCategory(types, post.categoryKey)) !== null,
  );
};

/** Total spend in cents over a range. */
export const totalSpent = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<number> => {
  const [budget, types] = await Promise.all([
    listBudget(horseId, from, to),
    categoriesRepo.listAll(),
  ]);
  return sumCents(
    budget.map((post) => amountOf(post, findCategory(types, post.categoryKey))),
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

/** Live posts filed under the category `key`, whichever horse they belong to. */
const ofCategory = async (key: string): Promise<Post[]> =>
  liveOnly(await db.posts.where("categoryKey").equals(key).toArray());

/**
 * How many posts a category holds — what decides whether the form builder may
 * delete it, since a post keeps its category's slug after the row is gone.
 */
export const countByCategory = async (key: string): Promise<number> =>
  (await ofCategory(key)).length;

/**
 * How many of a category's posts hold an answer in field `fieldId` — what the
 * form builder warns about before taking that field out of the form.
 */
export const countWithValue = async (
  key: string,
  fieldId: string,
): Promise<number> =>
  (await ofCategory(key)).filter((post) => {
    const value = post.customFields[fieldId];
    return value !== null && value !== undefined && value !== "";
  }).length;

export const create = async (fields: NewRecord<Post>): Promise<Post> => {
  const post = createRecord<Post>(fields);
  await db.posts.add(post);
  return post;
};
