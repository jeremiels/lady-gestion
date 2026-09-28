import { db } from "../db.ts";
import { crud, liveOnly } from "../record.ts";
import type { DocumentFolder } from "../types.ts";

/**
 * The folders of the user's Drive, as mirrored on this device.
 *
 * Read whole and filtered in memory: a Drive folder tree for one horse's
 * paperwork is a few dozen rows at most.
 */

/** Every live folder, alphabetical — the order a Drive lists them in. */
export const list = async (): Promise<DocumentFolder[]> => {
  const folders = await db.documentFolders.toArray();
  return liveOnly(folders).sort((a, b) => a.name.localeCompare(b.name, "fr"));
};

export const { get } = crud<DocumentFolder>(db.documentFolders);
