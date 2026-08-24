/**
 * A gate that opens once `initData()` has settled.
 *
 * Its own module rather than a field of `index.ts` so that `live.ts` can wait
 * on it without importing the barrel that imports `live.ts`.
 *
 * Why it exists: `app-root` kicks `initData()` off and renders immediately, so
 * without this a view's `LiveQuery` subscribes and runs its first query against
 * a database that is still being created and seeded. Every one of those queries
 * starts with "which horse is active?", so on a first run they take the
 * no-horse branch and return early — never reading `events`, `rationItems` or
 * `documents` at all. Whether the view ever recovers then rests on Dexie
 * noticing writes to tables that query never touched, and in practice it does
 * not: the seeded rows land and the view stays empty until a manual reload.
 *
 * Waiting costs one settled-promise tick after the first run, because
 * `initData()` is idempotent and already resolved by then.
 */

let open = false;

// `Promise.withResolvers()` rather than the executor-and-a-`let` dance this
// used to be: hoisting `resolve` out of a `new Promise` callback needs a
// mutable binding the compiler cannot prove is assigned, for a promise that is
// only ever resolved from one place. One line, no binding to get wrong.
const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();

export const dataReady = (): Promise<void> => gate;

export const isDataReady = (): boolean => open;

/**
 * Opens the gate. Called when `initData()` settles — **including when it
 * fails**, and deliberately so: a rejected init must not leave every view
 * waiting forever on a promise that will never resolve. Queries that then run
 * against an unopened database surface their own error through
 * `LiveQuery.error`, and `app-root` has already replaced the whole view with
 * its data-error screen by that point.
 */
export const markDataReady = (): void => {
  if (open) return;
  open = true;
  openGate();
};
