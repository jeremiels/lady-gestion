import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db.ts";
import { metaRepo } from "../data/index.ts";
import { importBackup } from "../data/backup/restore.ts";
import { checkBackup } from "../data/backup/validate.ts";
import type { DriveMeta } from "../data/types.ts";
import {
  HORSE_ID,
  OWNER,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { FOLDER } from "./api.ts";
import { backupToDrive } from "./backup.ts";

const TODAY = "2026-10-04";
const TOMORROW = "2026-10-05";

type Item = {
  id: string;
  parent: string;
  name: string;
  mimeType: string;
  appProperties: Record<string, string>;
  /** What the file holds; a folder holds nothing. */
  body: string;
  trashed: boolean;
};

/** A pretend Drive: everything in it, the trash included. */
let ITEMS: Item[];
/** Every call made to the Drive itself — not the Worker's token. */
let calls: { method: string; url: URL }[];
/** Answers in the pretend Drive's place when it returns a response: a refusal. */
let respond: ((url: URL, init?: RequestInit) => Response | undefined) | null;

const onDay = (day: string) => vi.setSystemTime(new Date(`${day}T10:00:00`));

const isTrashed = (item: Item): boolean => {
  if (item.trashed) return true;
  const parent = ITEMS.find(({ id }) => id === item.parent);
  return parent !== undefined && isTrashed(parent);
};

const listed = ({ id, name, mimeType, appProperties, body }: Item) => ({
  id,
  name,
  mimeType,
  size: String(body.length),
  modifiedTime: "2026-10-04T08:00:00.000Z",
  appProperties,
});

/** The two parts of a multipart upload: the metadata, and the file itself. */
const multipart = async (init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
  const boundary = /boundary=(.+)$/.exec(headers["Content-Type"]!)![1]!;
  const [, metadata, file] = (await new Response(init.body).text()).split(
    `--${boundary}`,
  );
  return {
    metadata: JSON.parse(metadata!.split("\r\n\r\n")[1]!) as {
      name: string;
      parents: string[];
      appProperties: Record<string, string>;
    },
    mimeType: /Content-Type: (.+)\r\n/.exec(file!)![1]!,
    body: file!.slice(file!.indexOf("\r\n\r\n") + 4, -2),
  };
};

const put = (item: Omit<Item, "trashed">): Item => {
  const created = { ...item, trashed: false };
  ITEMS.push(created);
  return created;
};

/** A backup file already in the folder, as an earlier pass left it. */
const putBackup = (day: string, owner = OWNER, parent = "folder") =>
  put({
    id: `backup-${day}-${owner}`,
    parent,
    name: `lady-gestion-${day}.json`,
    mimeType: "application/json",
    appProperties: { ladyBackup: day, ladyOwner: owner },
    body: `{"day":"${day}"}`,
  });

const putFolder = () =>
  put({
    id: "folder",
    parent: "root",
    name: "ladympala-backup",
    mimeType: FOLDER,
    appProperties: { ladyBackupFolder: "1" },
    body: "",
  });

const backups = () =>
  ITEMS.filter((item) => item.appProperties.ladyBackup !== undefined);
const folders = () => ITEMS.filter((item) => item.mimeType === FOLDER);
const state = () => metaRepo.get<DriveMeta["driveBackup"]>("driveBackup");

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
  await metaRepo.set("googleAccount", {
    email: "lea@example.com",
    sessionToken: `session-${Math.random()}`,
    scope: "openid https://www.googleapis.com/auth/drive",
  });
  ITEMS = [];
  calls = [];
  respond = null;
  // The date alone: fake-indexeddb runs on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  onDay(TODAY);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/drive/token")) {
        return Response.json({
          accessToken: "ya29.a",
          expiresAt: Date.now() + 3_600_000,
        });
      }
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const refused = respond?.(url, init);
      if (refused) return refused;

      const upload = url.pathname.startsWith("/upload/");
      const id = /\/files\/([^/]+)$/.exec(url.pathname)?.[1];
      const item = ITEMS.find((candidate) => candidate.id === id);
      if (id && !item) return new Response(null, { status: 404 });

      if (upload && item) {
        item.body = await new Response(init!.body).text();
        return Response.json({ id: item.id, modifiedTime: "now" });
      }
      if (upload) {
        const { metadata, mimeType, body } = await multipart(init!);
        const created = put({
          id: `file-${ITEMS.length + 1}`,
          parent: metadata.parents[0]!,
          name: metadata.name,
          mimeType,
          appProperties: metadata.appProperties,
          body,
        });
        return Response.json({ id: created.id, modifiedTime: "now" });
      }
      if (item && method === "PATCH") {
        const body = JSON.parse(String(init!.body)) as { trashed?: boolean };
        if (body.trashed) item.trashed = true;
        return Response.json({ modifiedTime: "now" });
      }
      if (item && url.searchParams.get("fields") === "id,trashed") {
        return Response.json({ id: item.id, trashed: isTrashed(item) });
      }
      if (item) return new Response(item.body);

      if (method === "POST") {
        const { name, parents, appProperties } = JSON.parse(
          String(init!.body),
        ) as {
          name: string;
          parents: string[];
          appProperties: Record<string, string>;
        };
        const created = put({
          id: `folder-${ITEMS.length + 1}`,
          parent: parents[0]!,
          name,
          mimeType: FOLDER,
          appProperties,
          body: "",
        });
        return Response.json({ ...listed(created), modifiedTime: "now" });
      }
      const q = url.searchParams.get("q")!;
      const tagged =
        /appProperties has \{ key='(\w+)' and value='([^']+)' \}/.exec(q);
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      return Response.json({
        files: ITEMS.filter(
          (candidate) =>
            !isTrashed(candidate) &&
            (tagged
              ? candidate.appProperties[tagged[1]!] === tagged[2]
              : candidate.parent === parent),
        ).map(listed),
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backupToDrive", () => {
  it("makes its folder at the top of her Drive and the day's file in it, and stamps the backup", async () => {
    await backupToDrive();

    expect(folders()).toMatchObject([
      {
        name: "ladympala-backup",
        parent: "root",
        appProperties: { ladyBackupFolder: "1" },
      },
    ]);
    const [file] = backups();
    expect(file).toMatchObject({
      name: `lady-gestion-${TODAY}.json`,
      parent: folders()[0]!.id,
      mimeType: "application/json",
      appProperties: { ladyBackup: TODAY, ladyOwner: OWNER },
    });
    expect(await metaRepo.getLastBackupAt()).toBeDefined();
    expect(await state()).toMatchObject({
      email: "lea@example.com",
      folderId: folders()[0]!.id,
      fileId: file!.id,
      day: TODAY,
    });
  });

  it("writes a file the restore reads back", async () => {
    await backupToDrive();
    const text = backups()[0]!.body;
    await db.horses.clear();

    await importBackup(checkBackup(JSON.parse(text)));

    expect((await db.horses.get(HORSE_ID))?.firstName).toBe("Ladympala");
  });

  it("sends nothing from a database holding only the untouched demo rows", async () => {
    await metaRepo.set("seedRecordIds", [HORSE_ID]);

    await backupToDrive();

    expect(calls).toEqual([]);
    expect(await metaRepo.getLastBackupAt()).toBeUndefined();
  });

  it("does send a demo row once it was edited: it is hers now", async () => {
    await metaRepo.set("seedRecordIds", [HORSE_ID]);
    await db.horses.put(makeHorse({ updatedAt: "2026-02-01T00:00:00.000Z" }));

    await backupToDrive();

    expect(backups()).toHaveLength(1);
  });

  it("sends nothing while signed out", async () => {
    await metaRepo.remove("googleAccount");

    await backupToDrive();

    expect(calls).toEqual([]);
  });

  it("makes no request while nothing has changed that day", async () => {
    await backupToDrive();
    calls = [];

    await backupToDrive();

    expect(calls).toEqual([]);
  });

  it("rewrites the day's file in place, in one request, once something changed", async () => {
    await backupToDrive();
    calls = [];
    await db.horses.update(HORSE_ID, { coat: "Alezan" });

    await backupToDrive();

    expect(calls.map(({ method }) => method)).toEqual(["PATCH"]);
    expect(backups()).toHaveLength(1);
    expect(backups()[0]!.body).toContain("Alezan");
  });

  it("starts a new file the next day, in the same folder, with nothing changed", async () => {
    await backupToDrive();
    onDay(TOMORROW);

    await backupToDrive();

    expect(folders()).toHaveLength(1);
    expect(backups().map((file) => file.appProperties.ladyBackup)).toEqual([
      TODAY,
      TOMORROW,
    ]);
  });

  it("takes up the folder and the day's file an earlier pass left without hearing back", async () => {
    putFolder();
    putBackup(TODAY);

    await backupToDrive();

    expect(folders()).toHaveLength(1);
    expect(backups()).toHaveLength(1);
    expect(backups()[0]!.body).toContain("Ladympala");
  });

  it("leaves another install's file for the same day alone", async () => {
    putFolder();
    const theirs = putBackup(TODAY, "another-owner");

    await backupToDrive();

    expect(theirs.body).toBe(`{"day":"${TODAY}"}`);
    expect(backups().map((file) => file.appProperties.ladyOwner)).toEqual([
      "another-owner",
      OWNER,
    ]);
  });

  it("keeps thirty days of backups and sends the older ones to the trash", async () => {
    putFolder();
    for (let dayOfMonth = 1; dayOfMonth <= 30; dayOfMonth++) {
      putBackup(`2026-09-${String(dayOfMonth).padStart(2, "0")}`);
    }
    putBackup("2026-08-31");

    await backupToDrive();

    expect(
      backups()
        .filter((file) => file.trashed)
        .map((file) => file.appProperties.ladyBackup)
        .sort(),
    ).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("makes a new folder when the one it used is in the trash", async () => {
    await backupToDrive();
    folders()[0]!.trashed = true;
    onDay(TOMORROW);

    await backupToDrive();

    const [, fresh] = folders();
    expect(fresh).toMatchObject({ trashed: false, parent: "root" });
    expect((await state())?.folderId).toBe(fresh!.id);
    expect(
      backups().find((file) => file.appProperties.ladyBackup === TOMORROW)
        ?.parent,
    ).toBe(fresh!.id);
  });

  it("starts over from the folder when the day's file is gone for good", async () => {
    await backupToDrive();
    ITEMS = ITEMS.filter((item) => item.mimeType === FOLDER);
    await db.horses.update(HORSE_ID, { coat: "Alezan" });

    await backupToDrive();

    expect(backups()).toHaveLength(1);
    expect(backups()[0]!.body).toContain("Alezan");
    expect((await state())?.fileId).toBe(backups()[0]!.id);
  });

  it("does not take what was sent to another account's Drive as sent to this one", async () => {
    await backupToDrive();
    ITEMS = [];
    await metaRepo.set("googleAccount", {
      email: "autre@example.com",
      sessionToken: `session-${Math.random()}`,
      scope: "openid https://www.googleapis.com/auth/drive",
    });

    await backupToDrive();

    expect(backups()).toHaveLength(1);
    expect((await state())?.email).toBe("autre@example.com");
  });

  it("does not stamp a backup the Drive refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond = (url) =>
      url.pathname.startsWith("/upload/")
        ? Response.json(
            { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
            { status: 403 },
          )
        : undefined;

    await backupToDrive();

    expect(await metaRepo.getLastBackupAt()).toBeUndefined();
    expect(await state()).toBeUndefined();
  });
});

describe("backupToDrive — the cover photo", () => {
  const photo = (text: string) => new Blob([text], { type: "image/jpeg" });
  const covers = () =>
    ITEMS.filter((item) => item.appProperties.ladyCover !== undefined);

  it("sends the photo she picked beside the backups, once", async () => {
    const { pickedAt } = await metaRepo.setHorseCover(HORSE_ID, photo("one"));

    await backupToDrive();

    expect(covers()).toMatchObject([
      {
        name: "couverture.jpg",
        parent: folders()[0]!.id,
        mimeType: "image/jpeg",
        appProperties: { ladyCover: HORSE_ID },
        body: "one",
      },
    ]);
    expect((await state())?.coverPickedAt).toBe(pickedAt);

    calls = [];
    await backupToDrive();
    expect(calls).toEqual([]);
  });

  it("replaces it in place when she picks another, the same day", async () => {
    await metaRepo.setHorseCover(HORSE_ID, photo("one"));
    await backupToDrive();
    // The clock is held still: a later pick needs a later time to be told apart.
    vi.setSystemTime(new Date(`${TODAY}T11:00:00`));
    const { pickedAt } = await metaRepo.setHorseCover(HORSE_ID, photo("two"));

    await backupToDrive();

    expect(covers()).toHaveLength(1);
    expect(covers()[0]!.body).toBe("two");
    expect((await state())?.coverPickedAt).toBe(pickedAt);
  });

  it("does not send it again on a later day", async () => {
    await metaRepo.setHorseCover(HORSE_ID, photo("one"));
    await backupToDrive();
    onDay(TOMORROW);
    calls = [];

    await backupToDrive();

    expect(covers()).toHaveLength(1);
    expect(
      calls.filter(({ url }) => url.pathname.startsWith("/upload/")),
    ).toHaveLength(1);
  });

  it("fetches it on a phone that has none, for the horse it was picked for", async () => {
    putFolder();
    put({
      id: "cover",
      parent: "folder",
      name: "couverture.jpg",
      mimeType: "image/jpeg",
      appProperties: { ladyCover: HORSE_ID },
      body: "hers",
    });

    await backupToDrive();

    const cover = await metaRepo.getHorseCover();
    expect(cover?.horseId).toBe(HORSE_ID);
    expect(cover?.blob.type).toBe("image/jpeg");
    expect(await cover?.blob.text()).toBe("hers");
    expect((await state())?.coverPickedAt).toBe(cover?.pickedAt);
    expect(covers()[0]!.body).toBe("hers");
  });

  it("leaves another horse's photo in the Drive where it is", async () => {
    putFolder();
    put({
      id: "cover",
      parent: "folder",
      name: "couverture.jpg",
      mimeType: "image/jpeg",
      appProperties: { ladyCover: "another-horse" },
      body: "not hers",
    });

    await backupToDrive();

    expect(await metaRepo.getHorseCover()).toBeUndefined();
  });
});
