import { accessToken } from "./auth.ts";
import { DRIVE_API_URL, DRIVE_UPLOAD_URL } from "./drive-config.ts";

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
  base = DRIVE_API_URL,
): Promise<Response> => {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
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

/** Creates a folder named `name` inside `parentId`, with `appProperties` on it. */
export const createFolder = async (
  name: string,
  parentId: string,
  appProperties: Record<string, string> = {},
): Promise<DriveFolder & { modifiedTime: string }> =>
  (await drive("/files?fields=id,name,modifiedTime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER,
      parents: [parentId],
      appProperties,
    }),
  })) as DriveFolder & { modifiedTime: string };

/**
 * The file or folder, not in the trash, whose `appProperties` hold `key`
 * set to `value` — how the sync recognises one it created whose answer never
 * reached the phone.
 */
export const findByAppProperty = async (
  key: string,
  value: string,
): Promise<{ id: string; modifiedTime: string } | undefined> => {
  const params = new URLSearchParams({
    q: `appProperties has { key='${key}' and value='${value}' } and trashed = false`,
    fields: "files(id, modifiedTime)",
    pageSize: "1",
  });
  const page = (await drive(`/files?${params}`)) as {
    files: { id: string; modifiedTime: string }[];
  };
  return page.files[0];
};

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

/**
 * Uploads `blob` as `name` into `parentId` — one multipart request, since a
 * scan or a photo is a few megabytes at most. `appProperties` are written on
 * the file: the post it belongs to survives in the Drive itself
 * (`docs/drive-spec.md` §7.3).
 */
export const uploadFile = async (
  name: string,
  blob: Blob,
  parentId: string,
  appProperties: Record<string, string>,
): Promise<{ id: string; modifiedTime: string }> => {
  const boundary = `lady-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parentId], appProperties });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const response = await request(
    "/files?uploadType=multipart&fields=id,modifiedTime",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
    DRIVE_UPLOAD_URL,
  );
  return (await response.json()) as { id: string; modifiedTime: string };
};

/** The folders a file sits in — one, in practice. */
export const parentsOf = async (id: string): Promise<string[]> =>
  ((await drive(`/files/${id}?fields=parents`)) as { parents?: string[] })
    .parents ?? [];

/**
 * Changes a file or folder: its name, the folder it sits in, its
 * `appProperties` (a `null` value removes one), or sends it to the trash —
 * never deleted outright (`docs/drive-spec.md` §6.6). Resolves the Drive's new
 * `modifiedTime`.
 */
export const updateFile = async (
  id: string,
  change: {
    name?: string;
    appProperties?: Record<string, string | null>;
    trashed?: boolean;
    move?: { from: string[]; to: string };
  },
): Promise<string> => {
  const { move, ...metadata } = change;
  const params = new URLSearchParams({ fields: "modifiedTime" });
  if (move) {
    params.set("addParents", move.to);
    const from = move.from.filter((parent) => parent !== move.to);
    if (from.length > 0) params.set("removeParents", from.join(","));
  }
  const updated = (await drive(`/files/${id}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  })) as { modifiedTime: string };
  return updated.modifiedTime;
};
