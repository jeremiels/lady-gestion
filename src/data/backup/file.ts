import type { IsoTimestamp } from "../dates.ts";
import { UserFacingError } from "../errors.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import { exportBackup } from "./export.ts";
import { importBackup, type ImportResult } from "./snapshot.ts";

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
 * Hands the current snapshot to the user — the share sheet where it takes
 * files, a download otherwise — and stamps `lastBackupAt` **only when the
 * share sheet confirms** the file went somewhere.
 *
 * A download proves nothing: on the installed iPhone app it opens a preview
 * the user can close without keeping anything. `navigator.share` resolves
 * only once the file was shared and rejects with `AbortError` when the sheet
 * is dismissed, so it is the one signal worth a timestamp.
 */
export const downloadBackup = async (): Promise<ExportOutcome> => {
  const file = await backupFile();
  const shared = await shareFile(file);
  // The file is safe whether or not the stamp lands: from the data-error
  // screen the database may not take a write at all.
  if (shared === "shared") await metaRepo.markBackedUp().catch(() => undefined);
  if (shared !== "unavailable") return shared;

  downloadFile(file);
  return "downloaded";
};

/** Parses a user-picked `.json` file and merges it. */
export const readBackupFile = async (file: File): Promise<ImportResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new UserFacingError("Ce fichier n'est pas une sauvegarde lisible.");
  }
  return importBackup(parsed);
};

/** The current snapshot as a named `.json` file. */
const backupFile = async (): Promise<File> => {
  const snapshot = await exportBackup();
  return new File(
    [JSON.stringify(snapshot, null, 2)],
    `lady-gestion-${fileTimestamp(snapshot.exportedAt)}.json`,
    { type: "application/json" },
  );
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
