import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../db.ts";
import type { Post } from "../types.ts";
import { checkBackup } from "./validate.ts";
import { horse, post, ration, snapshot } from "./snapshot.fixtures.ts";

/**
 * `checkBackup`: which files the restore refuses, before it asks anything.
 * What it then does with a file it reads is `snapshot.test.ts`'s.
 */

describe("checkBackup — the envelope", () => {
  it("rejects a file that is not a Ladympala.cc backup", () => {
    expect(() => checkBackup({ app: "autre-chose" })).toThrow(
      "Ce fichier n'est pas une sauvegarde Ladympala.cc.",
    );
    expect(() => checkBackup(null)).toThrow(/sauvegarde Ladympala.cc/);
  });

  it("rejects a file with no header", () => {
    expect(() => checkBackup({ app: "lady-gestion" })).toThrow(
      "Sauvegarde illisible : en-tête manquant.",
    );
  });

  it("rejects a file whose export date does not read as a date", () => {
    // The confirmation names the file by it, and `Intl` throws on an
    // invalid date — from inside a render.
    expect(() => checkBackup({ ...snapshot(), exportedAt: "hier" })).toThrow(
      "Sauvegarde illisible : en-tête manquant.",
    );
  });

  it("rejects a file without an owner the restore can adopt", () => {
    // Every row written after the restore carries it: a number would make
    // the next backup a file this check refuses, and an empty one makes the
    // next write throw.
    expect(() => checkBackup({ ...snapshot(), ownerId: 42 })).toThrow(
      "Sauvegarde illisible : en-tête manquant.",
    );
    expect(() => checkBackup(snapshot({ ownerId: "" }))).toThrow(
      "Sauvegarde illisible : en-tête manquant.",
    );
  });

  it("rejects a backup written by a newer build", () => {
    expect(() =>
      checkBackup(snapshot({ schemaVersion: SCHEMA_VERSION + 1 })),
    ).toThrow(/version plus récente/);
  });

  it("rejects a backup written by an older build", () => {
    expect(() =>
      checkBackup(snapshot({ schemaVersion: SCHEMA_VERSION - 1 })),
    ).toThrow(/version trop ancienne/);
  });
});

describe("checkBackup — the tables", () => {
  it("rejects an empty tables object with a readable message, not a TypeError", () => {
    expect(() => checkBackup({ ...snapshot(), tables: {} })).toThrow(
      /la table « horses » est absente/,
    );
  });

  it("rejects a table that is not an array", () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, posts: "nope" },
    };

    expect(() => checkBackup(broken)).toThrow(/la table « posts » est absente/);
  });

  it("rejects a file missing a table", () => {
    const { activities: _activities, ...incomplete } = snapshot().tables;

    expect(() => checkBackup({ ...snapshot(), tables: incomplete })).toThrow(
      /la table « activities » est absente/,
    );
  });

  it("rejects a row that is not an object", () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, posts: [null] },
    };

    expect(() => checkBackup(broken)).toThrow(
      /« posts » contient des enregistrements invalides/,
    );
  });

  it("rejects a row missing a field every row carries, naming it", () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, horses: [{ name: "Sans id" }] },
    };

    expect(() => checkBackup(broken)).toThrow(
      "Sauvegarde illisible : la table « horses » contient un enregistrement invalide (undefined, champ « id »).",
    );
  });

  it("rejects the whole file over one bad table", () => {
    // The valid horse is no reason to take the rest: a bad file is refused
    // whole, before the restore can ask to write any of it.
    const broken = {
      ...snapshot(),
      tables: {
        ...snapshot().tables,
        rationItems: [{ label: "sans id" }],
        horses: [horse()],
      },
    };

    expect(() => checkBackup(broken)).toThrow(/rationItems/);
  });
});

describe("checkBackup — rows a read path would break on", () => {
  it.each<[string, Partial<Post>]>([
    ["a date that is not YYYY-MM-DD", { date: "15/10/2026" }],
    ["a currency Intl cannot format", { currency: "EURO" }],
  ])("refuses %s", (_, over) => {
    const file = snapshot({ tables: { posts: [post(over)] } });

    expect(() => checkBackup(file)).toThrow(/Sauvegarde illisible/);
  });

  it("refuses a row without deletedAt, which no view would ever show", () => {
    const { deletedAt: _, ...row } = post();
    // Deliberately outside the type: this is the hand-edited file.
    const file = snapshot({ tables: { posts: [row as Post] } });

    expect(() => checkBackup(file)).toThrow(/champ « deletedAt »/);
  });

  it("refuses a ration season outside the twelve months", () => {
    const file = snapshot({
      tables: {
        rationItems: [ration({ season: { from: 13, to: 2 } as never })],
      },
    });

    expect(() => checkBackup(file)).toThrow(/champ « season »/);
  });
});
