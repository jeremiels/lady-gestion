import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db.ts";
import { HORSE_ID, makeDocument, resetDb } from "../__tests__/factories.ts";
import * as documentsRepo from "./documents.repo.ts";

/**
 * Documents are the only entity split across two tables — metadata in
 * `documents`, bytes in `documentBlobs`. Everything worth guarding here is
 * about keeping those two in step, and about the deliberate asymmetry on
 * delete: the tombstone must survive, the megabytes must not.
 */

beforeEach(resetDb);

const seedDocuments = (documents: Parameters<typeof makeDocument>[0][]) =>
  db.documents.bulkAdd(documents.map((over) => makeDocument(over)));

describe("create", () => {
  it("writes metadata and bytes together", async () => {
    const file = new Blob(["facture"], { type: "application/pdf" });

    const created = await documentsRepo.create(
      {
        horseId: HORSE_ID,
        eventId: null,
        category: "facture",
        name: "facture.pdf",
        issuedAt: "2026-05-01",
      },
      file,
    );

    expect(created.mimeType).toBe("application/pdf");
    expect(created.size).toBe(file.size);
    expect(await documentsRepo.getBlob(created.id)).toBeInstanceOf(Blob);
  });

  it("falls back to a generic mime type when the blob has none", async () => {
    const created = await documentsRepo.create(
      {
        horseId: HORSE_ID,
        eventId: null,
        category: "autre",
        name: "scan",
        issuedAt: null,
      },
      new Blob(["x"]),
    );

    expect(created.mimeType).toBe("application/octet-stream");
  });

  it("starts unsynced, so the first upload pass picks it up", async () => {
    const created = await documentsRepo.create(
      {
        horseId: HORSE_ID,
        eventId: null,
        category: "autre",
        name: "scan",
        issuedAt: null,
      },
      new Blob(["x"]),
    );

    expect(created.driveFileId).toBe(null);
    expect(created.driveSyncedAt).toBe(null);
  });
});

describe("listByHorse", () => {
  it("sorts by issue date, newest first", async () => {
    await seedDocuments([
      { id: "old", issuedAt: "2026-01-01" },
      { id: "new", issuedAt: "2026-09-01" },
      { id: "mid", issuedAt: "2026-05-01" },
    ]);

    const documents = await documentsRepo.listByHorse(HORSE_ID);

    expect(documents.map((document) => document.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("falls back to createdAt for a document with no printed date", async () => {
    await seedDocuments([
      { id: "dated", issuedAt: "2020-01-01" },
      { id: "undated", issuedAt: null, createdAt: "2030-01-01T00:00:00.000Z" },
    ]);

    const documents = await documentsRepo.listByHorse(HORSE_ID);

    expect(documents.map((document) => document.id)).toEqual([
      "undated",
      "dated",
    ]);
  });

  it("excludes soft-deleted documents", async () => {
    await seedDocuments([
      { id: "live" },
      { id: "gone", deletedAt: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(await documentsRepo.listByHorse(HORSE_ID)).toHaveLength(1);
  });
});

describe("countByCategory", () => {
  it("counts live documents per category and omits empty ones", async () => {
    await seedDocuments([
      { id: "a", category: "facture" },
      { id: "b", category: "facture" },
      { id: "c", category: "ordonnance" },
      { id: "d", category: "facture", deletedAt: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(await documentsRepo.countByCategory(HORSE_ID)).toEqual({
      facture: 2,
      ordonnance: 1,
    });
  });

  it("returns an empty object rather than zeroes when there is nothing", async () => {
    expect(await documentsRepo.countByCategory(HORSE_ID)).toEqual({});
  });
});

describe("listByEvent", () => {
  it("finds the documents attached to one event", async () => {
    await seedDocuments([
      { id: "attached", eventId: "event-1" },
      { id: "loose", eventId: null },
    ]);

    const documents = await documentsRepo.listByEvent("event-1");

    expect(documents.map((document) => document.id)).toEqual(["attached"]);
  });
});

describe("remove", () => {
  it("soft-deletes the metadata but hard-deletes the bytes", async () => {
    const created = await documentsRepo.create(
      {
        horseId: HORSE_ID,
        eventId: null,
        category: "facture",
        name: "f.pdf",
        issuedAt: null,
      },
      new Blob(["bytes"]),
    );

    await documentsRepo.remove(created.id);

    // The tombstone has to survive so the deletion can propagate to a backup.
    expect(await db.documents.get(created.id)).toMatchObject({
      deletedAt: expect.any(String),
    });
    // The bytes must not — keeping megabytes of deleted scans fills the quota
    // for no benefit, and they were never needed to communicate the delete.
    expect(await documentsRepo.getBlob(created.id)).toBeUndefined();
  });
});
