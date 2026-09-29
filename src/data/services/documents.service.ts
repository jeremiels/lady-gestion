import { db } from "../db.ts";
import { UserFacingError } from "../errors.ts";
import * as documentFoldersRepo from "../repositories/documentFolders.repo.ts";
import * as documentsRepo from "../repositories/documents.repo.ts";
import type { DocumentFolder } from "../types.ts";

/**
 * Filing documents from the app: folders made, renamed, deleted; files
 * renamed, moved, linked to a post, deleted. Each is written here first and
 * sent to the Drive by the next sync (`src/drive/sync.ts`), so it works
 * offline and shows at once.
 *
 * See `posts.service.ts` for what a service is here and the rules one follows.
 */

/**
 * A folder name as the Drive will hold it, or why not. Two folders of the
 * same name side by side are refused, whatever the Drive would allow: the
 * app could not tell them apart for her.
 */
const folderName = (
  name: string,
  parentId: string | null,
  folders: DocumentFolder[],
  self?: string,
): string => {
  const trimmed = name.trim();
  if (!trimmed) throw new UserFacingError("Donnez un nom au dossier.");
  const taken = folders.some(
    (folder) =>
      folder.id !== self &&
      folder.parentId === parentId &&
      folder.name.localeCompare(trimmed, "fr", { sensitivity: "base" }) === 0,
  );
  if (taken) throw new UserFacingError("Un dossier porte déjà ce nom ici.");
  return trimmed;
};

export const createFolder = async (
  name: string,
  parentId: string | null,
): Promise<DocumentFolder> =>
  documentFoldersRepo.create(
    folderName(name, parentId, await documentFoldersRepo.list()),
    parentId,
  );

export const renameFolder = async (id: string, name: string): Promise<void> => {
  const folder = await documentFoldersRepo.get(id);
  if (!folder) return;
  const folders = await documentFoldersRepo.list();
  await documentFoldersRepo.update(id, {
    name: folderName(name, folder.parentId, folders, id),
  });
};

/**
 * Deletes an empty folder — to the Drive's trash, at the next sync. One with
 * anything left in it is refused: deleting her files as a side effect of a
 * folder is not something to do in one tap.
 */
export const deleteFolder = (id: string): Promise<void> =>
  db.transaction("rw", [db.documentFolders, db.documents], async () => {
    const [children, documents] = await Promise.all([
      documentFoldersRepo.list(),
      documentsRepo.listByFolder(id),
    ]);
    if (
      documents.length > 0 ||
      children.some((folder) => folder.parentId === id)
    ) {
      throw new UserFacingError("Videz le dossier avant de le supprimer.");
    }
    await documentFoldersRepo.remove(id);
  });

export const renameDocument = async (
  id: string,
  name: string,
): Promise<void> => {
  const trimmed = name.trim();
  if (!trimmed) throw new UserFacingError("Donnez un nom au fichier.");
  await documentsRepo.update(id, { name: trimmed });
};

/** Files it in `folderId`; `null` for the general folder itself. */
export const moveDocument = async (
  id: string,
  folderId: string | null,
): Promise<void> => {
  await documentsRepo.update(id, { folderId });
};

/** Attaches it to a post, or detaches it (`null`). */
export const linkDocument = async (
  id: string,
  postId: string | null,
): Promise<void> => {
  await documentsRepo.update(id, { postId });
};

/** To the Drive's trash at the next sync; the bytes leave the device now. */
export const deleteDocument = (id: string): Promise<void> =>
  documentsRepo.remove(id);
