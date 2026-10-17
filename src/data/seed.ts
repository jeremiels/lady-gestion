import {
  RECORD_TABLES,
  RECORD_TABLE_NAMES,
  db,
  type BackupTables,
} from "./db.ts";
import { todayISO, toIsoDate, nowISO } from "./dates.ts";
import { seedCategories } from "./categories.ts";
import { followUpValue } from "./posts.ts";
import { getOwnerId } from "./owner.ts";
import * as horsesRepo from "./repositories/horses.repo.ts";
import * as rationsRepo from "./repositories/rations.repo.ts";
import * as postsRepo from "./repositories/posts.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import { DEFAULT_SEASON, type RationSeason } from "./seasons.ts";
import type { BaseRecord, RationUnit } from "./types.ts";

/**
 * Seeds the built-in categories on a device that has none — the first launch.
 *
 * Only then. From that moment the categories are hers: she edits them in the
 * form builder, and nothing this build ships is written over them at a later
 * launch — not a changed label or field list, not a built-in added since.
 * `BUILT_IN_CATEGORIES` is the model a new install starts from, never an
 * update to an installed one.
 *
 * A restore needs nothing from here: a new phone seeds its own built-ins
 * moments before the import, and the import replaces them with the file's
 * (`importBackup` in `backup/restore.ts`).
 */
export const seedCategoriesOnFirstInstall = async (): Promise<void> => {
  if ((await db.categories.count()) > 0) return;
  await db.categories.bulkAdd(seedCategories(getOwnerId(), nowISO()));
};

/**
 * First-run bootstrap: the values that were hardcoded in the views, turned
 * into real rows so there is something to look at before anything has been
 * entered by hand.
 *
 * The demo horse/rations/events are gated on the database holding no
 * horse at all, so they can never overwrite real data or reappear after the
 * user deletes it. The category catalogue has its own gate — see
 * `seedCategoriesOnFirstInstall`.
 *
 * The demo is written in one transaction: a first launch cut short would
 * otherwise leave a horse with half its rows and no `seedRecordIds`, so no
 * restore could ever tell them apart from real data.
 */
export const seedIfEmpty = async (): Promise<void> => {
  await seedCategoriesOnFirstInstall();

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
  // Remembered so demo rows can be told apart from real ones — see
  // `isUntouchedSeed`.
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
 * Whether `tables` hold nothing of the user's: every row is a first-run demo
 * row (`seedIds`, `meta.seedRecordIds`) nobody has touched. What an install
 * looks like before a restore — and so what an automatic backup must not send,
 * or a new phone's demo horse would land among her real backups.
 */
export const isUntouchedSeed = (
  tables: BackupTables,
  seedIds: readonly string[] | undefined,
): boolean => {
  const seeded = new Set(seedIds);
  return USER_TABLES.every((name) => {
    const rows: readonly BaseRecord[] = tables[name];
    return rows.every(
      (row) => seeded.has(row.id) && row.createdAt === row.updatedAt,
    );
  });
};

/**
 * Whether `tables` hold only what a first run writes, untouched: the demo
 * (`isUntouchedSeed`), the built-in categories as seeded, and no profile.
 * What a restore may replace without handing over a copy first — a category
 * switched off or a name typed in is hers, and a replace throws it away.
 */
export const isFirstRun = (
  tables: BackupTables,
  seedIds: readonly string[] | undefined,
): boolean =>
  isUntouchedSeed(tables, seedIds) &&
  tables.profiles.length === 0 &&
  tables.categories.every(
    (row) => row.isBuiltIn && row.createdAt === row.updatedAt,
  );

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
