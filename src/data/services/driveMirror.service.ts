import { db } from "../db.ts";
import {
  planFolderChange,
  planMirror,
  type MirrorPlan,
  type RemoteFile,
  type RemoteFolder,
} from "../drive-mirror.ts";
import * as horsesRepo from "../repositories/horses.repo.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import type { DriveMeta } from "../types.ts";

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
 * A walk of a folder that is no longer the general one — she picked another
 * while it ran — writes nothing: it would bring back every row
 * `chooseFolder` just let go of. Read in the same transaction, so the two
 * cannot interleave.
 *
 * Resolves how many rows it wrote — 0 when nothing had changed.
 */
export const mirrorDrive = (tree: DriveTree): Promise<number> =>
  db.transaction(
    "rw",
    [db.documents, db.documentFolders, db.documentBlobs, db.horses, db.meta],
    async () => {
      const general =
        await metaRepo.get<DriveMeta["driveFolder"]>("driveFolder");
      if (general?.id !== tree.rootDriveId) return 0;
      const horse = await horsesRepo.getActive();
      if (!horse) return 0;

      const plan = planMirror({
        ...tree,
        localFolders: await db.documentFolders.toArray(),
        localDocuments: await db.documents.toArray(),
        horseId: horse.id,
      });
      await write(plan);
      return plan.folders.length + plan.documents.length;
    },
  );

/**
 * Makes `folder` the general folder and lets go of what the mirror held of
 * the previous one (`planFolderChange`), in one transaction: no sync reads
 * the old rows against the new folder.
 */
export const chooseFolder = (folder: DriveMeta["driveFolder"]): Promise<void> =>
  db.transaction(
    "rw",
    [db.documents, db.documentFolders, db.documentBlobs, db.meta],
    async () => {
      const previous =
        await metaRepo.get<DriveMeta["driveFolder"]>("driveFolder");
      await metaRepo.set("driveFolder", { id: folder.id, name: folder.name });
      if (previous?.id === folder.id) return;
      await write(
        planFolderChange(
          await db.documentFolders.toArray(),
          await db.documents.toArray(),
        ),
      );
    },
  );

const write = async (plan: MirrorPlan): Promise<void> => {
  await db.documentFolders.bulkPut(plan.folders);
  await db.documents.bulkPut(plan.documents);
  await db.documentBlobs.bulkDelete(plan.staleBlobs);
};
