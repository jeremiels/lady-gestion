import { accessToken } from "./auth.ts";
import { DRIVE_API_URL } from "./drive-config.ts";

/**
 * The Drive calls the app makes, typed. Each one fetches its own access
 * token, so a caller never handles one.
 */

export const FOLDER = "application/vnd.google-apps.folder";

/** Google's own formats — Docs, Sheets — which only download as an export. */
const GOOGLE_APPS = "application/vnd.google-apps.";

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

const request = async (
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
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
  return response;
};

const drive = async (path: string, init: RequestInit = {}): Promise<unknown> =>
  (await request(path, init)).json();

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

/** Anything in a folder, as Drive lists it. `size` is absent for Google Docs. */
export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
};

/** Everything directly inside `parentId`, folders and files, not trashed. */
export const listChildren = async (parentId: string): Promise<DriveItem[]> => {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
      pageSize: "1000",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = (await drive(`/files?${params}`)) as {
      files: DriveItem[];
      nextPageToken?: string;
    };
    items.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
};

/**
 * A file's bytes. A Google Doc or Sheet has none of its own, so it comes as
 * the PDF Drive exports it to — which is also all the viewer can show.
 */
export const downloadFile = async (
  id: string,
  mimeType: string,
): Promise<Blob> => {
  const exported = mimeType.startsWith(GOOGLE_APPS);
  const response = await request(
    exported
      ? `/files/${id}/export?mimeType=application/pdf`
      : `/files/${id}?alt=media`,
  );
  return new Blob([await response.blob()], {
    type: exported ? "application/pdf" : mimeType,
  });
};
