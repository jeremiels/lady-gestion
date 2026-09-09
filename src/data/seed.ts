import { RECORD_TABLES, db, type RecordTableName } from "./db.ts";
import { todayISO, toIsoDate, nowISO } from "./dates.ts";
import { seedEventTypeDefs } from "./event-types.ts";
import { followUpValue } from "./events.ts";
import { getOwnerId } from "./owner.ts";
import * as horsesRepo from "./repositories/horses.repo.ts";
import * as rationsRepo from "./repositories/rations.repo.ts";
import * as eventsRepo from "./repositories/events.repo.ts";
import * as documentsRepo from "./repositories/documents.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import { DEFAULT_SEASON, type RationSeason } from "./seasons.ts";
import type { HorseEvent, RationUnit } from "./types.ts";

/** The seeded event the demo document hangs off. Matched by title below. */
const REPORT_EVENT_TITLE = "Contrôle œil";

/**
 * Brings the built-in event types on this device up to what the app ships.
 *
 * Inserting only when the table is empty — which is all this did — meant a
 * device seeded once never saw another edit to `BUILT_IN_EVENT_TYPES` again:
 * adding a type, relabelling one, recolouring one or changing the fields its
 * form draws all reached a fresh install and nothing else. That is what forced
 * schema versions v7, v9 and v10, none of which changed a table's shape; it is
 * also why a stale row whose `fields` predate a change to their shape renders
 * an empty form rather than a wrong one.
 *
 * So this reconciles instead: every shipped built-in is written back over the
 * row carrying its `key`, and one with no row yet is inserted. Adding or
 * editing a built-in is now an edit to that array and nothing else.
 *
 * Three things are deliberately left alone:
 *
 * - **A row the user made themselves** (`isBuiltIn: false`) — it is not ours.
 * - **A deleted one.** `remove` is a soft delete, so the row is still here
 *   with `deletedAt` set; matching on it is what stops a built-in the user
 *   threw away coming back on the next launch.
 * - **`id`, `ownerId`, `createdAt` and `updatedAt`.** The first three are the
 *   row's identity; `updatedAt` is what a backup restore arbitrates
 *   last-write-wins by, and shipping a new build is not an edit that should
 *   win that argument — the same rule `db.ts`'s migrations follow.
 *
 * Once the type editor exists, this is the one place that has to learn the
 * difference between a built-in the user has customised and one they have not.
 */
const reconcileEventTypes = async (): Promise<void> => {
  const shipped = seedEventTypeDefs(getOwnerId(), nowISO());
  const existing = await db.eventTypes.toArray();

  if (existing.length === 0) {
    await db.eventTypes.bulkAdd(shipped);
    return;
  }

  const byKey = new Map(existing.map((type) => [type.key, type]));
  const idFor = (key: string | null) =>
    key === null ? null : (byKey.get(key)?.id ?? null);

  const writes = shipped.flatMap((type) => {
    const current = byKey.get(type.key);

    // `seedEventTypeDefs` stamps `parentId` with the literal key the array is
    // written with, which only resolves because a freshly seeded row's `id`
    // *is* its key. Against rows already on the device that does not hold, so
    // the parent is looked up — the same resolution `db.ts`'s v9 and v10
    // upgrades do, and for the same reason.
    const parentId = idFor(type.parentId);

    if (!current) return [{ ...type, parentId }];
    if (!current.isBuiltIn || current.deletedAt !== null) return [];

    return [
      {
        ...type,
        parentId,
        id: current.id,
        ownerId: current.ownerId,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      },
    ];
  });

  if (writes.length > 0) await db.eventTypes.bulkPut(writes);
};

/**
 * First-run bootstrap: the values that were hardcoded in the views, turned
 * into real rows so there is something to look at before anything has been
 * entered by hand.
 *
 * The demo horse/rations/events/document are gated on the database holding no
 * horse at all, so they can never overwrite real data or reappear after the
 * user deletes it. The event-type catalogue has its own gate — see
 * `reconcileEventTypes`.
 */
export const seedIfEmpty = async (): Promise<void> => {
  await reconcileEventTypes();

  const count = await db.horses.count();
  if (count > 0) return;

  const horse = await horsesRepo.create({
    name: "Ladympala Coupe Chêne",
    sex: "jument",
    // Placeholder giving the "5 ans" the view used to hardcode — correct it
    // from the identity form once the real date is to hand.
    birthDate: "2021-05-01",
    breed: "Selle Français",
    coat: "Bai cerise",
    sireNumber: "2139236F",
    sireName: "Nouma d'Auzay",
    damName: "Vaza de Roc O Cerf",
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

  const events: HorseEvent[] = [];
  for (const event of sampleEvents(horse.id)) {
    const created = await eventsRepo.create(event);
    seedRecordIds.push(created.id);
    events.push(created);
  }

  // One document, so the event detail page's attachment block, its viewer and
  // the share action have something real to act on. There is no upload path
  // yet, so without this the block would be permanently empty — and a feature
  // that can never be reached is a feature that is never known to be broken.
  const report = events.find((event) => event.title === REPORT_EVENT_TITLE);
  if (report) {
    const document = await documentsRepo.create(
      {
        horseId: horse.id,
        eventId: report.id,
        category: "compte-rendu",
        name: "Controle_oeil.pdf",
        issuedAt: report.date,
      },
      samplePdf(),
    );
    seedRecordIds.push(document.id);
  }

  await metaRepo.set("seededAt", todayISO());
  // Remembered so a restore can tell demo rows apart from real ones —
  // see `clearUntouchedSeedData`.
  await metaRepo.set("seedRecordIds", seedRecordIds);
};

/**
 * Drops first-run demo rows the user never touched.
 *
 * Restoring a backup usually happens on a fresh install — which is exactly
 * when the seed has just run. Without this, the restore lands next to the
 * demo data and the user ends up with two Ladympalas. Rows that were edited
 * since being seeded are left alone: at that point they are real data.
 *
 * Hard deletes on purpose. A tombstone here would propagate "this horse was
 * deleted" to every other device, and these rows never existed anywhere else.
 */
export const clearUntouchedSeedData = async (): Promise<void> => {
  const ids = await metaRepo.get<string[]>("seedRecordIds");
  if (!ids?.length) return;

  await db.transaction(
    "rw",
    [...Object.values(RECORD_TABLES), db.documentBlobs],
    async () => {
      // Driven by `RECORD_TABLES` rather than a fourth hand-written list of the
      // same four tables: an unlisted table's demo rows would survive the very
      // restore this exists to make room for, and nothing would say so.
      for (const name of Object.keys(RECORD_TABLES) as RecordTableName[]) {
        const table = RECORD_TABLES[name];
        for (const id of ids) {
          const row = await table.get(id);
          if (!row || row.createdAt !== row.updatedAt) continue;

          await table.delete(id);
          // Metadata and bytes go together — the same pairing
          // `documentsRepo.remove` keeps. Dropping only the row would strand the
          // blob in `documentBlobs` with nothing left pointing at it and no way
          // to ever reclaim the space.
          if (name === "documents") await db.documentBlobs.delete(id);
        }
      }
    },
  );

  await metaRepo.remove("seedRecordIds");
};

/** A handful of events either side of today, so every view has something to show. */
const sampleEvents = (horseId: string) => {
  const inDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
  };

  return [
    {
      horseId,
      type: "marechal",
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
      type: "veto",
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
      type: "marechal",
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
      type: "pension",
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
      type: "osteo",
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
    // having to be entered by hand first. Also the document's anchor.
    {
      horseId,
      type: "veto",
      title: REPORT_EVENT_TITLE,
      date: inDays(-26),
      time: null,
      status: "done" as const,
      currency: "EUR",
      location: null,
      notes: "Bilan annuel ophtalmologique. Pas d’anomalie détectée.",
      recurrenceId: null,
      customFields: {
        amountCents: 10_000,
        counterparty: "Dr. Orange",
        followUp: followUpValue({ amount: 6, unit: "week" }),
      },
    },
  ];
};

/**
 * A minimal but structurally valid one-page PDF.
 *
 * Generated rather than shipped as a binary under `src/assets/`: a real file
 * would be bundled into every production build to serve demo data that the
 * first backup restore deletes again.
 *
 * The xref offsets are computed, not hardcoded — a PDF with a wrong xref is
 * precisely the file that renders in one viewer and fails in the next, which
 * would make this useless as a test of the viewer. Offsets are character
 * counts, which is only safe because the content below is pure ASCII; keep the
 * accents out of it.
 */
const samplePdf = (): Blob => {
  const content = [
    "BT /F1 20 Tf 60 780 Td (Compte rendu veterinaire) Tj ET",
    "BT /F1 12 Tf 60 750 Td (Controle oeil - bilan annuel ophtalmologique.) Tj ET",
    "BT /F1 12 Tf 60 730 Td (Pas d'anomalie detectee.) Tj ET",
  ].join("\n");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const startxref = pdf.length;
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;

  return new Blob([pdf], { type: "application/pdf" });
};
