import { findCategory, type ResolvedCategory } from "./categories.ts";
import { uploadStateOf, type UploadState } from "./drive-mirror.ts";
import * as categoriesRepo from "./repositories/categories.repo.ts";
import * as documentFoldersRepo from "./repositories/documentFolders.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import * as postsRepo from "./repositories/posts.repo.ts";
import type { DocumentFolder, DriveMeta, StoredDocument } from "./types.ts";

/**
 * The category of the post each document belongs to — the tag a document's
 * row wears ("Vétérinaire" on an ostéo invoice), keyed by document id. A
 * document on no post, or on a post whose category is switched off, has none.
 */
export const postCategoriesOf = async (
  documents: StoredDocument[],
): Promise<Record<string, ResolvedCategory>> => {
  const linked = documents.filter((doc) => doc.postId !== null);
  if (linked.length === 0) return {};

  const categories = await categoriesRepo.listEnabled();
  const entries = await Promise.all(
    linked.map(async (doc) => {
      const post = await postsRepo.get(doc.postId!);
      const category = post && findCategory(categories, post.categoryKey);
      return category ? ([doc.id, category] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
};

/**
 * Why each file joined in the app is not in the Drive yet (`UploadState`),
 * keyed by document id — the note its row wears. A file in the Drive has none.
 */
export const uploadStatesOf = async (
  documents: StoredDocument[],
): Promise<Record<string, UploadState>> => {
  const notSent = documents.filter((doc) => doc.driveFileId === null);
  if (notSent.length === 0) return {};

  const folders = new Map(
    (await documentFoldersRepo.listAll()).map((folder) => [folder.id, folder]),
  );
  const general = await metaRepo.get<DriveMeta["driveFolder"]>("driveFolder");
  return Object.fromEntries(
    notSent.map((doc) => [doc.id, uploadStateOf(doc, folders, general?.id)!]),
  );
};

/**
 * Where a document can be filed, for a select: the general folder, then every
 * mirrored folder by its path, so two "2025" under different parents read
 * apart. The general folder's value is `""`.
 */
export const folderOptions = (
  folders: DocumentFolder[],
): { value: string; label: string }[] => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path = (folder: DocumentFolder): string => {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    return parent ? `${path(parent)} / ${folder.name}` : folder.name;
  };
  return [
    { value: "", label: "Dossier général" },
    ...folders
      .map((folder) => ({ value: folder.id, label: path(folder) }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
  ];
};
