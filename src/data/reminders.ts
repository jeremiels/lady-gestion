import { fieldWithRole, findCategory } from "./categories.ts";
import { formatDateMedium, formatTime, todayISO } from "./dates.ts";
import { liveQuery } from "./db.ts";
import { reminderFireAt } from "./posts.ts";
import { dataReady } from "./ready.ts";
import * as categoriesRepo from "./repositories/categories.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import * as postsRepo from "./repositories/posts.repo.ts";
import type { Category, Post } from "./types.ts";

/**
 * The push reminders the device wants sent — derived from the posts, never
 * stored. IndexedDB stays the only source of truth: `src/pwa/push.ts` hands
 * this whole list to the push server each time it changes, and the server
 * keeps nothing the next list does not repeat.
 *
 * Only what the notification itself shows leaves the device: a title and one
 * line of text, the instant to send it, and the post's id to open on tap.
 */
export type Reminder = {
  postId: string;
  /** Epoch milliseconds. */
  fireAt: number;
  title: string;
  body: string;
};

/**
 * Every reminder still to go out at `now`, soonest first.
 *
 * A post counts when its category carries a `reminder` field, its box was
 * ticked, it has a time, and it is not cancelled. One whose moment has passed
 * is dropped rather than reported: editing last month's cure must not send it.
 */
export const remindersOf = (
  posts: Post[],
  categories: Category[],
  now: number,
): Reminder[] =>
  posts
    .flatMap((post): Reminder[] => {
      if (post.status === "cancelled") return [];
      const category = findCategory(categories, post.categoryKey);
      const field = category && fieldWithRole(category, "reminder");
      if (!field) return [];

      const fireAt = reminderFireAt(
        post.date,
        post.time,
        post.customFields[field.id],
      );
      if (fireAt === null || fireAt <= now) return [];

      return [
        {
          postId: post.id,
          fireAt,
          title: post.title,
          body: `${category.label} · ${formatDateMedium(post.date)} à ${formatTime(post.time)}`,
        },
      ];
    })
    .sort((a, b) => a.fireAt - b.fireAt);

/**
 * The reminders to send, or none while the Profil switch is off.
 *
 * Reads from today on: a reminder only ever goes out *before* its post, so
 * nothing dated earlier can still have one pending.
 */
export const listReminders = async (): Promise<Reminder[]> => {
  if (!(await metaRepo.getNotificationsEnabled())) return [];
  const [posts, categories] = await Promise.all([
    postsRepo.listFrom(todayISO()),
    categoriesRepo.listAll(),
  ]);
  return remindersOf(posts, categories, Date.now());
};

/**
 * Calls `next` with the reminder list now, and again after every write that
 * could change it — the sheet, a delete, a restored backup, a follow-up copy,
 * the Profil switch. Waits for the database to be ready first, the same gate
 * `LiveQuery` waits on. App-long: nothing unsubscribes.
 */
export const watchReminders = (next: (reminders: Reminder[]) => void): void => {
  void dataReady().then(() => {
    liveQuery(listReminders).subscribe({
      next,
      error: (error: unknown) => {
        console.warn("[push] Lecture des rappels impossible :", error);
      },
    });
  });
};
