import { db } from "../db.ts";
import {
  planMirror,
  type RemoteFile,
  type RemoteFolder,
} from "../drive-mirror.ts";
import * as horsesRepo from "../repositories/horses.repo.ts";

/**
 * Writing what the Drive holds into the mirror (`drive-mirror.ts`).
 *
 * See `posts.service.ts` for what a service is here and the rules one follows.
 */

export type DriveTree = {
  rootDriveId: string;
  folders: RemoteFolder[];
  files: RemoteFile[];
};

/**
 * Brings the mirror in step with a walk of the general folder: one
 * transaction, so a view never shows a folder without its files, and a sync
 * that fails halfway leaves the previous mirror whole.
 *
 * Resolves how many rows it wrote — 0 when nothing had changed.
 */
export const mirrorDrive = (tree: DriveTree): Promise<number> =>
  db.transaction(
    "rw",
    [db.documents, db.documentFolders, db.documentBlobs, db.horses, db.meta],
    async () => {
      const horse = await horsesRepo.getActive();
      if (!horse) return 0;

      const plan = planMirror({
        ...tree,
        localFolders: await db.documentFolders.toArray(),
        localDocuments: await db.documents.toArray(),
        horseId: horse.id,
      });
      await db.documentFolders.bulkPut(plan.folders);
      await db.documents.bulkPut(plan.documents);
      await db.documentBlobs.bulkDelete(plan.staleBlobs);
      return plan.folders.length + plan.documents.length;
    },
  );
