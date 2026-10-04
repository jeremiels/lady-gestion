/**
 * A copy of the whole database in her Drive, made without a gesture
 * (`docs/drive-spec.md` §12).
 *
 * One JSON file per day — the text of a manual export, so "Restaurer un
 * fichier" reads it — in a folder of its own at the top of her Drive, the
 * newest thirty days kept, and her cover photo beside them. Outside the
 * general folder on purpose: it needs none to be picked, a change of general
 * folder leaves it alone, and the mirror never walks it.
 *
 * It runs when the app opens, when she signs in, when the app goes to the
 * background or comes back, and when the network returns — iOS runs nothing
 * for a closed app, so that is as automatic as it gets. A database unchanged
 * since the day's file costs no request. Offline, or with the Worker down, it
 * fails quietly and the next of those moments tries again.
 */

import {
  automaticBackup,
  horsesRepo,
  metaRepo,
  todayISO,
  watchDriveSetup,
} from "../data/index.ts";
import type { DriveMeta, HorseCover } from "../data/types.ts";
import { getAccount } from "./auth.ts";
import {
  createFolder,
  downloadFile,
  DriveRequestError,
  findByAppProperty,
  listChildren,
  MY_DRIVE,
  updateFile,
  updateFileContent,
  uploadFile,
  visibility,
  type DriveItem,
} from "./api.ts";

type BackupState = DriveMeta["driveBackup"];

const FOLDER_NAME = "ladympala-backup";
const COVER_NAME = "couverture.jpg";

/** Days of backups kept; the files of an older day go to the Drive's trash. */
const KEPT_DAYS = 30;

let running: Promise<void> | null = null;
let again = false;

const jsonBlob = (text: string): Blob =>
  new Blob([text], { type: "application/json" });

/**
 * The backup folder: the one last used while the account still sees it out of
 * the trash, else the one an earlier install made — found by its tag, wherever
 * she has moved or renamed it — else a new one at the top of her Drive. A
 * folder in the trash is replaced rather than written to: what goes into it
 * goes to the trash with it.
 */
const backupFolder = async (known: string | undefined): Promise<string> => {
  if (known !== undefined && (await visibility(known)) === "visible") {
    return known;
  }
  const found = await findByAppProperty("ladyBackupFolder", "1");
  return (
    found ??
    (await createFolder(FOLDER_NAME, MY_DRIVE, { ladyBackupFolder: "1" }))
  ).id;
};

/** Records a backup the Drive confirmed, which is what "Dernière sauvegarde" reads. */
const confirm = async (state: BackupState): Promise<void> => {
  await metaRepo.markBackedUp();
  await metaRepo.set("driveBackup", state);
};

/**
 * Keeps the cover photo's copy in the backup folder, and resolves the
 * `pickedAt` of the photo that folder holds afterwards. Sent when she picked
 * one the folder does not have; fetched when the phone has none and the
 * folder does — a new phone, after a restore.
 */
const syncCover = async (
  folderId: string,
  items: DriveItem[],
  cover: HorseCover | undefined,
  sent: string | undefined,
): Promise<string | undefined> => {
  if (cover) {
    const remote = items.find(
      (item) => item.appProperties?.ladyCover === cover.horseId,
    );
    if (remote && cover.pickedAt === sent) return sent;
    if (remote) await updateFileContent(remote.id, cover.blob);
    else {
      await uploadFile(COVER_NAME, cover.blob, folderId, {
        ladyCover: cover.horseId,
      });
    }
    return cover.pickedAt;
  }

  const horse = await horsesRepo.getActive();
  const remote =
    horse && items.find((item) => item.appProperties?.ladyCover === horse.id);
  if (!remote) return undefined;
  const blob = await downloadFile(
    remote.id,
    remote.mimeType,
    Number(remote.size ?? 0),
  );
  // Picked while the bytes were on their way: hers stands, and is sent by the
  // next pass.
  if (await metaRepo.getHorseCover()) return undefined;
  return (await metaRepo.setHorseCover(horse.id, blob)).pickedAt;
};

/**
 * Sends the backups of every day beyond the newest `KEPT_DAYS` to the trash,
 * never deleted outright (`docs/drive-spec.md` §6.6). By day rather than by
 * file: two installs' files for one day count once.
 */
const prune = async (items: DriveItem[], day: string): Promise<void> => {
  const dayOf = (item: DriveItem) => item.appProperties?.ladyBackup;
  const days = new Set([day]);
  for (const item of items) {
    const of = dayOf(item);
    if (of !== undefined) days.add(of);
  }
  const kept = new Set([...days].sort().reverse().slice(0, KEPT_DAYS));
  for (const item of items) {
    const of = dayOf(item);
    if (of !== undefined && !kept.has(of)) {
      await updateFile(item.id, { trashed: true });
    }
  }
};

/**
 * One pass. Nothing is sent from a database holding only the untouched demo
 * rows (`automaticBackup`), and a day's file is only ever replaced by the
 * install that wrote it (`ladyOwner`): a new phone, before its restore, must
 * not write over her last real backup. After a restore it has taken the file's
 * owner, and carries the same series on.
 */
const pass = async (): Promise<void> => {
  const account = await getAccount();
  if (!account) return;
  const backup = await automaticBackup();
  if (!backup) return;

  const day = todayISO();
  const known = await metaRepo.get<BackupState>("driveBackup");
  // What was sent to another account's Drive says nothing of this one.
  const state = known?.email === account.email ? known : undefined;
  const cover = await metaRepo.getHorseCover();

  if (
    state?.day === day &&
    (cover === undefined || cover.pickedAt === state.coverPickedAt)
  ) {
    if (state.digest === backup.digest) return;
    try {
      await updateFileContent(state.fileId, jsonBlob(backup.json));
      await confirm({ ...state, digest: backup.digest });
      return;
    } catch (error: unknown) {
      // The day's file is gone for good: start over from the folder.
      if (!(error instanceof DriveRequestError && error.status === 404)) {
        throw error;
      }
    }
  }

  const folderId = await backupFolder(state?.folderId);
  // One listing for the three steps below. It is also what turns a creation
  // whose answer never arrived — iOS suspended the app — into an update next
  // time rather than a second file.
  const items = await listChildren(folderId);
  const todays = items.find(
    (item) =>
      item.appProperties?.ladyBackup === day &&
      item.appProperties.ladyOwner === backup.ownerId,
  );
  const file = todays
    ? await updateFileContent(todays.id, jsonBlob(backup.json))
    : await uploadFile(
        `lady-gestion-${day}.json`,
        jsonBlob(backup.json),
        folderId,
        { ladyBackup: day, ladyOwner: backup.ownerId },
      );
  const next: BackupState = {
    email: account.email,
    folderId,
    fileId: file.id,
    day,
    digest: backup.digest,
  };
  await confirm(next);

  const coverPickedAt = await syncCover(
    folderId,
    items,
    cover,
    state?.folderId === folderId ? state.coverPickedAt : undefined,
  );
  if (coverPickedAt !== undefined) {
    await metaRepo.set("driveBackup", { ...next, coverPickedAt });
  }

  await prune(items, day);
};

/**
 * One backup, unless one is running — then that one's result, with one more
 * to follow it: what was written meanwhile may have missed the snapshot it
 * read.
 */
export const backupToDrive = (): Promise<void> => {
  if (running) {
    again = true;
    return running;
  }
  running = pass()
    .catch((error: unknown) => {
      // Offline, Worker down, signed out meanwhile, Drive full: the last
      // backup stands, and "Dernière sauvegarde" goes on saying how old it is.
      console.warn("[drive] Sauvegarde impossible :", error);
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void backupToDrive();
      }
    });
  return running;
};

/** Starts keeping the backup up to date. Called once, after the database opens. */
export function initDriveBackup() {
  // `null` until the first answer, so the app opening counts as a change.
  let session: string | null | undefined = null;
  watchDriveSetup(({ account }) => {
    if (account?.sessionToken === session) return;
    session = account?.sessionToken;
    void backupToDrive();
  });
  // Both ways: going to the background sends what this visit wrote while iOS
  // still lets the app run, and coming back catches up on a send it cut short.
  document.addEventListener("visibilitychange", () => void backupToDrive());
  window.addEventListener("online", () => void backupToDrive());
}
