import { RECORD_TABLES, RECORD_TABLE_NAMES, db } from "./db.ts";
import { todayISO, toIsoDate, nowISO } from "./dates.ts";
import { seedCategories } from "./categories.ts";
import { followUpValue } from "./posts.ts";
import { getOwnerId } from "./owner.ts";
import * as horsesRepo from "./repositories/horses.repo.ts";
import * as rationsRepo from "./repositories/rations.repo.ts";
import * as postsRepo from "./repositories/posts.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import { DEFAULT_SEASON, type RationSeason } from "./seasons.ts";
import type { RationUnit } from "./types.ts";

/**
 * Brings the built-in event types on this device up to what the app ships.
 *
 * A device seeded once must still receive every later edit to
 * `BUILT_IN_CATEGORIES` — a type added, relabelled, recoloured or given other
 * form fields — so this reconciles rather than inserting only into an empty
 * table: a shipped built-in whose row differs is written back over the row
 * carrying its `key`, and one with no row yet is inserted. Adding or editing a
 * built-in is an edit to that array and nothing else.
 *
 * A row that already matches is not written at all. This runs at every launch,
 * ahead of every view's first query, and rewriting fourteen identical rows
 * there cost a readwrite transaction on every cold start for nothing.
 *
 * Four things are deliberately left alone:
 *
 * - **A row the user made themselves** (`isBuiltIn: false`) — it is not ours.
 * - **A deleted one.** `remove` is a soft delete, so the row is still here
 *   with `deletedAt` set; matching on it is what stops a built-in the user
 *   threw away coming back on the next launch.
 * - **`id`, `ownerId`, `createdAt` and `updatedAt`.** The first three are the
 *   row's identity; `updatedAt` is what a backup restore arbitrates
 *   last-write-wins by, and shipping a new build is not an edit that should
 *   win that argument. Left alone, a built-in never edited keeps
 *   `createdAt === updatedAt` — which is how a restore knows the file's copy
 *   replaces it (`yieldsToFile` in `backup/snapshot.ts`).
 * - **`enabled`.** It is the user's switch in Personnaliser › Catégories, not
 *   something the app ships; writing the seed's `true` back would turn a
 *   hidden category on again at every launch.
 *
 * Runs at every launch from `seedIfEmpty`, and again at the end of
 * `importBackup`, so the rows a restore brings in carry this build's
 * definitions straight away.
 *
 * Once the type editor exists, this is the one place that has to learn the
 * difference between a built-in the user has customised and one they have not.
 *
 * `ownerId` defaults to the cached one and is only ever passed explicitly by
 * `importBackup`, which runs this *inside* its transaction and so cannot have
 * adopted the file's owner into the module cache yet — that happens only once
 * the transaction commits. It is read for one purpose: stamping a built-in the
 * device does not have at all. An existing row keeps its own `ownerId`.
 */
export const reconcileCategories = async (
  ownerId: string = getOwnerId(),
): Promise<void> => {
  const shipped = seedCategories(ownerId, nowISO());
  const existing = await db.categories.toArray();

  if (existing.length === 0) {
    await db.categories.bulkAdd(shipped);
    return;
  }

  const byKey = new Map(existing.map((type) => [type.key, type]));
  const idFor = (key: string | null) =>
    key === null ? null : (byKey.get(key)?.id ?? null);

  const writes = shipped.flatMap((type) => {
    const current = byKey.get(type.key);

    // `seedCategories` stamps `parentId` with the literal key the array is
    // written with, which only resolves because a freshly seeded row's `id`
    // *is* its key. Against rows already on the device that does not hold, so
    // the parent is looked up.
    const parentId = idFor(type.parentId);

    if (!current) return [{ ...type, parentId }];
    if (!current.isBuiltIn || current.deletedAt !== null) return [];

    const reconciled = {
      ...type,
      parentId,
      id: current.id,
      ownerId: current.ownerId,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      enabled: current.enabled,
    };
    return sameRow(reconciled, current) ? [] : [reconciled];
  });

  if (writes.length > 0) await db.categories.bulkPut(writes);
};

/** `value` with every object's keys sorted, all the way down. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
};

/**
 * Whether two rows hold the same data, whatever order their keys are in.
 *
 * Order-blind because IndexedDB hands a row back with its keys in the order it
 * was stored, which is not necessarily the order this build assembles them in.
 * Anything else counts as a difference — a key the stored row carries and this
 * build no longer ships included — so such a row is rewritten. The one blind
 * spot is a key holding `undefined`, which reads back the same either way.
 */
const sameRow = (a: object, b: object): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * First-run bootstrap: the values that were hardcoded in the views, turned
 * into real rows so there is something to look at before anything has been
 * entered by hand.
 *
 * The demo horse/rations/events are gated on the database holding no
 * horse at all, so they can never overwrite real data or reappear after the
 * user deletes it. The event-type catalogue has its own gate — see
 * `reconcileCategories`.
 *
 * The demo is written in one transaction: a first launch cut short would
 * otherwise leave a horse with half its rows and no `seedRecordIds`, so no
 * restore could ever tell them apart from real data.
 */
export const seedIfEmpty = async (): Promise<void> => {
  await reconcileCategories();

  await db.transaction(
    "rw",
    [...Object.values(RECORD_TABLES), db.meta],
    seedDemo,
  );
};

/** The demo horse and everything hung off it, on a database with no horse. */
const seedDemo = async (): Promise<void> => {
  const count = await db.horses.count();
  if (count > 0) return;

  const horse = await horsesRepo.create({
    firstName: "Étoile",
    lastName: null,
    sex: "jument",
    // Placeholder giving the "5 ans" the view used to hardcode — correct it
    // from the identity form once the real date is to hand.
    birthDate: "2021-05-01",
    breed: "Selle Français",
    coat: "Bai cerise",
    // Visibly fictitious: a demo that looks like a real studbook entry is one
    // a real horse could be mistaken for.
    sireNumber: "00000000A",
    sireName: "Père de démo",
    damName: "Mère de démo",
    photoDocumentId: null,
    archivedAt: null,
  });

  await horsesRepo.setActive(horse.id);

  // The two oils are fed October through April only — the window the plan is
  // built around, and what makes the "suspendus" footnote say something real
  // for most of the summer.
  const rations: [string, number, RationUnit, RationSeason | null][] = [
    ["Fib & Fib", 1.5, "L", null],
    ["CMV Minéral Oligovit", 50, "g", null],
    ["Sel", 15, "g", null],
    ["Huile de lin", 40, "mL", DEFAULT_SEASON],
    ["Vitamine E", 10, "mL", DEFAULT_SEASON],
  ];

  const seedRecordIds = [horse.id];

  for (const [label, quantity, unit, season] of rations) {
    const item = await rationsRepo.add({
      horseId: horse.id,
      label,
      quantity,
      unit,
      season,
    });
    seedRecordIds.push(item.id);
  }

  for (const event of samplePosts(horse.id)) {
    const created = await postsRepo.create(event);
    seedRecordIds.push(created.id);
  }

  await metaRepo.set("seededAt", todayISO());
  // Remembered so a restore can tell demo rows apart from real ones —
  // see `clearUntouchedSeedData`.
  await metaRepo.set("seedRecordIds", seedRecordIds);
};

/**
 * The tables whose rows only the user writes, or the demo seed: every one but
 * `categories`, whose built-ins every install seeds for itself, and
 * `profiles`, which says who the user is rather than what they recorded.
 */
const USER_TABLES = RECORD_TABLE_NAMES.filter(
  (name) => name !== "categories" && name !== "profiles",
);

/**
 * Drops first-run demo rows the user never touched — **only on a database that
 * holds nothing else**.
 *
 * Restoring a backup usually happens on a fresh install — which is exactly
 * when the seed has just run. Without this, the restore lands next to the
 * demo data and the user ends up with two horses.
 *
 * On a database already in use it deletes nothing and forgets
 * `seedRecordIds`. A demo horse the user kept and filled with their own posts
 * is still `createdAt === updatedAt` if its card was never edited; purging it
 * on the restore of someone else's file would orphan every one of those posts
 * and switch the app to the file's horse. Once a single row is the user's, the
 * seed markers can only ever point at real data.
 *
 * Hard deletes on purpose. A tombstone here would propagate "this horse was
 * deleted" to every other device, and these rows never existed anywhere else.
 */
export const clearUntouchedSeedData = async (): Promise<void> => {
  const ids = await metaRepo.get<string[]>("seedRecordIds");
  if (!ids?.length) return;

  const seeded = new Set(ids);
  const keys = await Promise.all(
    USER_TABLES.map((name) => RECORD_TABLES[name].toCollection().primaryKeys()),
  );
  if (keys.flat().some((id) => !seeded.has(id))) {
    await metaRepo.remove("seedRecordIds");
    return;
  }

  await db.transaction(
    "rw",
    USER_TABLES.map((name) => RECORD_TABLES[name]),
    async () => {
      // `USER_TABLES`, derived rather than hand-written: an unlisted table's
      // demo rows would survive the very restore this exists to make room for,
      // and nothing would say so.
      for (const name of USER_TABLES) {
        const table = RECORD_TABLES[name];
        for (const id of ids) {
          const row = await table.get(id);
          if (!row || row.createdAt !== row.updatedAt) continue;

          await table.delete(id);
        }
      }
    },
  );

  await metaRepo.remove("seedRecordIds");
};

/** A handful of events either side of today, so every view has something to show. */
const samplePosts = (horseId: string) => {
  const inDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
  };

  return [
    {
      horseId,
      categoryKey: "marechal",
      title: "Ferrure",
      date: inDays(6),
      time: "14:00",
      status: "planned" as const,
      currency: "EUR",
      location: null,
      notes: null,
      recurrenceId: null,
      customFields: {},
    },
    {
      horseId,
      categoryKey: "veto",
      title: "Rappel vaccins",
      date: inDays(19),
      time: "09:30",
      status: "planned" as const,
      currency: "EUR",
      location: null,
      notes: null,
      recurrenceId: null,
      customFields: {},
    },
    {
      horseId,
      categoryKey: "marechal",
      title: "Ferrure",
      date: inDays(-34),
      time: "14:00",
      status: "done" as const,
      currency: "EUR",
      location: null,
      notes: null,
      recurrenceId: null,
      customFields: { amountCents: 9000 },
    },
    {
      horseId,
      categoryKey: "pension",
      title: "Pension mensuelle",
      date: inDays(-11),
      time: null,
      status: "done" as const,
      currency: "EUR",
      location: null,
      notes: null,
      recurrenceId: null,
      customFields: { amountCents: 35000 },
    },
    {
      horseId,
      categoryKey: "osteo",
      title: "Séance ostéopathie",
      date: inDays(-52),
      time: "11:00",
      status: "done" as const,
      currency: "EUR",
      location: null,
      notes: null,
      recurrenceId: null,
      customFields: { amountCents: 7500 },
    },
    // The one fully populated row: every optional field is set, so the detail
    // page renders each of its Informations rows at least once without anything
    // having to be entered by hand first.
    {
      horseId,
      categoryKey: "veto",
      title: "Contrôle œil",
      date: inDays(-26),
      time: null,
      status: "done" as const,
      currency: "EUR",
      location: null,
      notes: "Bilan annuel ophtalmologique. Pas d’anomalie détectée.",
      recurrenceId: null,
      customFields: {
        amountCents: 10_000,
        counterparty: "Clinique vétérinaire",
        followUp: followUpValue({ amount: 6, unit: "week" }),
      },
    },
  ];
};
