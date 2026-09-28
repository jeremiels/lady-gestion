import { accessToken } from "./auth.ts";
import { DRIVE_API_URL } from "./drive-config.ts";

/**
 * The Drive calls the app makes, typed. Each one fetches its own access
 * token, so a caller never handles one.
 */

const FOLDER = "application/vnd.google-apps.folder";

/** Drive's alias for the top of "Mon Drive". */
export const MY_DRIVE = "root";

export type DriveFolder = { id: string; name: string };

/** A Drive answer other than 2xx; `status` 0 when the request never landed. */
export class DriveRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 0
        ? "Pas de connexion à Google Drive."
        : `Google Drive a répondu ${status}.`,
    );
    this.status = status;
  }
}

const drive = async (
  path: string,
  init: RequestInit = {},
): Promise<unknown> => {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`${DRIVE_API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DriveRequestError(0);
  }
  if (!response.ok) throw new DriveRequestError(response.status);
  return response.json();
};

/**
 * The folders directly inside `parentId`, alphabetical — every page of them,
 * though one page (1000) covers any real folder.
 */
export const listFolders = async (parentId: string): Promise<DriveFolder[]> => {
  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and mimeType = '${FOLDER}' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      orderBy: "name",
      pageSize: "1000",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = (await drive(`/files?${params}`)) as {
      files: DriveFolder[];
      nextPageToken?: string;
    };
    folders.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return folders;
};

/** Creates a folder named `name` inside `parentId`. */
export const createFolder = async (
  name: string,
  parentId: string,
): Promise<DriveFolder> =>
  (await drive("/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  })) as DriveFolder;
