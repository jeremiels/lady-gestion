import { db } from "./db.ts";
import { initOwnerId } from "./owner.ts";
import { markDataReady } from "./ready.ts";
import { seedIfEmpty } from "./seed.ts";

/**
 * Public surface of the data layer.
 *
 * Views and components import from here (or from a repository module) and
 * never from `db.ts` — `dexie` stays behind this boundary so that replacing
 * IndexedDB with a hosted database later is a change to the repositories
 * alone.
 *
 * **Every line below re-exports a whole module, never a hand-picked list.** The
 * hand-picked version drifted exactly the way a hand-maintained list does: it
 * ended up with two separate `export { … } from './dates.ts'` blocks and three
 * different re-export conventions in one file, and adding a helper meant
 * remembering to come back here. A module is either part of the public surface
 * or it is not, and that is the only decision this file should encode.
 *
 * What is deliberately absent is that decision in action: `db.ts` (the `dexie`
 * boundary itself), `ready.ts` (an internal gate `live.ts` owns), and
 * `record.ts` / `ids.ts` / `owner.ts` / `seed.ts` — record plumbing that
 * repositories call and nothing above them should.
 *
 * `services/*` sits alongside the repositories rather than under them: a
 * repository reads and writes one table, a service owns a *write* that spans
 * more than one decision or more than one table. Reads never go through one —
 * a `LiveQuery` over a repository is already the right shape.
 *
 * **A presentational component wanting only a formatter imports the module
 * directly, not this file.** `event-card` takes `formatDate` from `dates.ts`
 * and `formatCents` from `money.ts`; `app-calendar` takes `monthGrid` from
 * `icalendar.ts`. That is not drift, it is the chunking working: `initData`
 * below needs `db.ts`, which constructs `new LadyGestionDb()` at module scope,
 * so importing a pure function through here would pull Dexie and the whole seed
 * into whatever chunk that component lands in — against the whole point of the
 * `codeSplitting` vendor split in `vite.config.ts`. Reach for this file when you
 * need a repository, a `LiveQuery` or the backup; reach past it for arithmetic.
 */

export * as horsesRepo from "./repositories/horses.repo.ts";
export * as eventsRepo from "./repositories/events.repo.ts";
export * as documentsRepo from "./repositories/documents.repo.ts";
export * as rationsRepo from "./repositories/rations.repo.ts";
export * as activitiesRepo from "./repositories/activities.repo.ts";
export * as eventTypesRepo from "./repositories/event-types.repo.ts";
export * as metaRepo from "./repositories/meta.repo.ts";

export * as eventsService from "./services/events.service.ts";
export * as rationsService from "./services/rations.service.ts";

export * from "./live.ts";
export * from "./active-horse.ts";
export * from "./backup/snapshot.ts";

export * from "./types.ts";
export * from "./money.ts";
export * from "./dates.ts";
export * from "./icalendar.ts";
export * from "./seasons.ts";
export * from "./events.ts";
export * from "./event-types.ts";
export * from "./files.ts";
export * from "./budget.ts";
export * from "./forms.ts";

let ready: Promise<void> | undefined;

/**
 * Opens the database, resolves the owner id and bootstraps first-run data.
 * Idempotent — repeated calls return the same promise. Must resolve before
 * anything writes a record.
 */
export const initData = (): Promise<void> => {
  ready ??= (async () => {
    try {
      await db.open();
      await initOwnerId();
      await seedIfEmpty();
    } finally {
      // In a `finally`, so a failed init releases the views waiting on the gate
      // instead of leaving them on a loading state forever — see `ready.ts`.
      markDataReady();
    }
  })();
  return ready;
};
