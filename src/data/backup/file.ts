import type { IsoTimestamp } from "../dates.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import { isUntouchedSeed } from "../seed.ts";
import { exportBackup } from "./export.ts";
import type { BackupSnapshot } from "./snapshot.ts";

/**
 * How long the object URL is kept alive after the click. Revoking in the same
 * tick races the browser starting the download — the failure is a silently
 * empty or missing file, on the one action the user is relying on to not lose
 * their data.
 */
const REVOKE_DELAY_MS = 1_000;

/**
 * How an export ended:
 * - `shared`: the share sheet took the file (saved to Fichiers, sent…);
 * - `downloaded`: handed to the browser's download, which does not say
 *   whether the user kept it;
 * - `cancelled`: the share sheet was dismissed.
 */
export type ExportOutcome = "shared" | "downloaded" | "cancelled";

/**
 * Hands the current snapshot to the user (`deliverBackup`) and stamps
 * `lastBackupAt` **only when the share sheet confirms** the file went
 * somewhere.
 *
 * A download proves nothing: on the installed iPhone app it opens a preview
 * the user can close without keeping anything. `navigator.share` resolves
 * only once the file was shared and rejects with `AbortError` when the sheet
 * is dismissed, so it is the one signal worth a timestamp.
 */
export const downloadBackup = async (): Promise<ExportOutcome> => {
  const outcome = await deliverBackup(await exportBackup());
  // The file is safe whether or not the stamp lands: from the data-error
  // screen the database may not take a write at all.
  if (outcome === "shared") {
    await metaRepo.markBackedUp().catch(() => undefined);
  }
  return outcome;
};

/**
 * Hands `snapshot` to the user as a file: the share sheet where it takes
 * files, a download otherwise. Stamps nothing — a snapshot read earlier, such
 * as the copy `runRestore` (`restore.ts`) hands over, need not be what the
 * database holds now.
 *
 * Nothing is awaited before the share sheet opens, so a call made straight
 * from a tap still has the tap's activation.
 */
export const deliverBackup = async (
  snapshot: BackupSnapshot,
): Promise<ExportOutcome> => {
  const file = backupFile(snapshot);
  const shared = await shareFile(file);
  if (shared !== "unavailable") return shared;

  downloadFile(file);
  return "downloaded";
};

/** A snapshot as the text of a backup file, however the file is delivered. */
const backupText = (snapshot: BackupSnapshot): string =>
  JSON.stringify(snapshot, null, 2);

/** A snapshot as a named `.json` file. */
const backupFile = (snapshot: BackupSnapshot): File =>
  new File(
    [backupText(snapshot)],
    `lady-gestion-${fileTimestamp(snapshot.exportedAt)}.json`,
    { type: "application/json" },
  );

/**
 * The current snapshot, or `null` when the database holds only the untouched
 * demo rows of a first run (`isUntouchedSeed`): there is nothing of hers in
 * it to keep. What an automatic backup sends, and what a restore copies first
 * (`planRestore`, `restore.ts`).
 */
export const exportHers = async (): Promise<BackupSnapshot | null> => {
  const [snapshot, seedIds] = await Promise.all([
    exportBackup(),
    metaRepo.get<string[]>("seedRecordIds"),
  ]);
  return isUntouchedSeed(snapshot.tables, seedIds) ? null : snapshot;
};

/** What a backup made without a gesture sends (`src/drive/backup.ts`). */
export type AutomaticBackup = {
  /** The text `downloadBackup` writes, so "Restaurer un fichier" reads it. */
  json: string;
  ownerId: string;
  /**
   * SHA-256 of the data alone, in hex: equal as long as nothing was written.
   * `exportedAt` is left out — it moves on every read.
   */
  digest: string;
};

/**
 * The current snapshot for an automatic backup, or `null` when there is
 * nothing of hers to keep (`exportHers`).
 */
export const automaticBackup = async (): Promise<AutomaticBackup | null> => {
  const snapshot = await exportHers();
  if (!snapshot) return null;

  const { schemaVersion, ownerId, tables } = snapshot;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion, ownerId, tables }),
    ),
  );
  return {
    json: backupText(snapshot),
    ownerId,
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
};

/**
 * Offers `file` to the share sheet. `unavailable` when there is none that
 * takes files, and when it refused for any reason but a dismissal — typically
 * `NotAllowedError` once reading the database outlasted the tap's activation —
 * so the caller still hands the file over another way.
 *
 * Web Share with files is not in every floor browser — Firefox has no
 * `navigator.share` on desktop and Chrome only on some platforms — hence the
 * detection.
 */
const shareFile = async (
  file: File,
): Promise<"shared" | "cancelled" | "unavailable"> => {
  if (!navigator.canShare?.({ files: [file] })) return "unavailable";
  try {
    await navigator.share({ files: [file] });
    return "shared";
  } catch (error: unknown) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "cancelled"
      : "unavailable";
  }
};

/** Starts a browser download of `file`. */
const downloadFile = (file: File): void => {
  const url = URL.createObjectURL(file);
  // The anchor has to be in the document: Firefox ignores `click()` on a
  // detached one, so the export appears to do nothing at all.
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

/** `YYYY-MM-DD-HH-MM-SS` in local time, for the file name. */
const fileTimestamp = (iso: IsoTimestamp): string => {
  const exportedAt = new Date(iso);
  return [
    exportedAt.getFullYear(),
    exportedAt.getMonth() + 1,
    exportedAt.getDate(),
    exportedAt.getHours(),
    exportedAt.getMinutes(),
    exportedAt.getSeconds(),
  ]
    .map((part) => `${part}`.padStart(2, "0"))
    .join("-");
};
