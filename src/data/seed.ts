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
 * Seeds the 13 built-in event types the first time the database has none.
 *
 * A brand-new install never runs `db.ts`'s v6 `.upgrade()` — Dexie only fires
 * an upgrade transaction when a database already exists at an older version,
 * and a fresh `IndexedDB` is created directly at the current schema with no
 * rows in any table. `seedIfEmpty` is the only code path a first run reaches,
 * so this is the other half of seeding the catalogue, independent of the
 * `db.horses` gate below: a device that has deleted every horse but still has
 * its types must not have them re-seeded a second time, so this checks the
 * `eventTypes` table's own emptiness rather than piggy-backing on that check.
 */
const seedEventTypesIfEmpty = async (): Promise<void> => {
  if ((await db.eventTypes.count()) > 0) return;
  await db.eventTypes.bulkAdd(seedEventTypeDefs(getOwnerId(), nowISO()));
};

/**
 * First-run bootstrap: the values that were hardcoded in the views, turned
 * into real rows so there is something to look at before anything has been
 * entered by hand.
 *
 * The demo horse/rations/events/document are gated on the database holding no
 * horse at all, so they can never overwrite real data or reappear after the
 * user deletes it. The event-type catalogue has its own gate — see
 * `seedEventTypesIfEmpty`.
 */
export const seedIfEmpty = async (): Promise<void> => {
  await seedEventTypesIfEmpty();

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
