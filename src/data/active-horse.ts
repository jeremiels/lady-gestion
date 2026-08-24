import type { ReactiveControllerHost } from 'lit';
import { LiveQuery } from './live.ts';
import * as horsesRepo from './repositories/horses.repo.ts';

/**
 * A `LiveQuery` over something the active horse owns.
 *
 *     activeHorseQuery(this, (horseId) => eventsRepo.listByHorse(horseId), []);
 *
 * @param host  The view subscribing to the query.
 * @param query Runs only when there is an active horse.
 * @param empty Returned when there is none — a view can mount before the
 *              database is seeded, and this must match `query`'s shape so the
 *              render needs no second branch.
 * @returns A `LiveQuery` that re-runs whenever the active horse or the queried
 *          tables change.
 */
export const activeHorseQuery = <T>(
  host: ReactiveControllerHost,
  query: (horseId: string) => T | Promise<T>,
  empty: T,
): LiveQuery<T> =>
  new LiveQuery<T>(host, async () => {
    // Resolved per query, not hoisted: Dexie re-runs a `liveQuery` only for
    // tables it actually read, so one that never touched `horses` would not
    // notice the active horse changing.
    const horse = await horsesRepo.getActive();
    return horse ? query(horse.id) : empty;
  });
