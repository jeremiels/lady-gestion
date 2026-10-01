import { accessToken, forgetAccessToken } from "./auth.ts";
import { DRIVE_API_URL, DRIVE_UPLOAD_URL } from "./drive-config.ts";

/**
 * The Drive calls the app makes, typed. Each one fetches its own access
 * token, so a caller never handles one.
 */

export const FOLDER = "application/vnd.google-apps.folder";

/** Google's own formats — Docs, Sheets — which only download as an export. */
const GOOGLE_APPS = "application/vnd.google-apps.";

/** Whether a file of this type downloads as the PDF Drive exports it to. */
export const exportsAsPdf = (mimeType: string): boolean =>
  mimeType.startsWith(GOOGLE_APPS);

/** Drive's alias for the top of "Mon Drive". */
export const MY_DRIVE = "root";

/**
 * How long a request may take before it counts as no connection. Without a
 * limit, one that never answers — a socket iOS left half-open while the app
 * was suspended — would hold the sync that awaits it, and every sync after.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** A download or an upload: the metadata limit, plus a slow line's pace for the bytes. */
const transferTimeout = (bytes: number): number =>
  REQUEST_TIMEOUT_MS * 3 + Math.ceil(bytes / 25);

export type DriveFolder = { id: string; name: string };

/**
 * A Drive answer other than 2xx; `status` 0 when the request never landed.
 * `reason` is Drive's own word for it — `userRateLimitExceeded` is a 403
 * that passes, where most 403s do not.
 */
export class DriveRequestError extends Error {
  readonly status: number;
  readonly reason: string | undefined;

  constructor(status: number, reason?: string) {
    super(
      status === 0
        ? "Pas de connexion à Google Drive."
        : `Google Drive a répondu ${status}${reason ? ` (${reason})` : ""}.`,
    );
    this.status = status;
    this.reason = reason;
  }
}

/** A request that never landed: offline, the host unreachable, or past its time. */
export const isNoConnection = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === "TimeoutError");

const request = async (
  path: string,
  init: RequestInit = {},
  base = DRIVE_API_URL,
  timeout = REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  let token: string;
  try {
    token = await accessToken();
  } catch (error: unknown) {
    // Offline or the Worker unreachable, before Drive is even asked: the
    // same "no connection" as a Drive request that never landed, so the
    // viewer says the file opens once online rather than that it cannot.
    if (isNoConnection(error)) throw new DriveRequestError(0);
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new DriveRequestError(0);
  }
  if (!response.ok) {
    // Revoked at Google before its hour was up: the next call asks the
    // Worker, which answers 401 in turn if the grant is gone for good.
    if (response.status === 401) forgetAccessToken();
    const reason = await response
      .json()
      .then(
        (body: { error?: { errors?: { reason?: string }[] } }) =>
          body.error?.errors?.[0]?.reason,
      )
      .catch(() => undefined);
    throw new DriveRequestError(response.status, reason);
  }
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

/**
 * Anything in a folder, as Drive lists it. `size` is absent for Google Docs;
 * `appProperties` for anything the app never wrote to.
 */
export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
};

/** Everything directly inside `parentId`, folders and files, not trashed. */
export const listChildren = async (parentId: string): Promise<DriveItem[]> => {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, modifiedTime, appProperties)",
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
  size: number,
): Promise<Blob> => {
  const exported = exportsAsPdf(mimeType);
  const response = await request(
    exported
      ? `/files/${id}/export?mimeType=application/pdf`
      : `/files/${id}?alt=media`,
    {},
    DRIVE_API_URL,
    transferTimeout(size),
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
    transferTimeout(blob.size),
  );
  return (await response.json()) as { id: string; modifiedTime: string };
};

/**
 * What the signed-in account sees of `id`: `gone` for a file or folder of
 * another Google account, or one deleted for good; `trashed` for one in the
 * trash, itself or through a folder above it — which hides everything in it
 * from a listing, and takes anything filed into it to the trash as well.
 */
export const visibility = async (
  id: string,
): Promise<"visible" | "trashed" | "gone"> => {
  try {
    const file = (await drive(`/files/${id}?fields=id,trashed`)) as {
      trashed?: boolean;
    };
    return file.trashed ? "trashed" : "visible";
  } catch (error: unknown) {
    if (error instanceof DriveRequestError && error.status === 404)
      return "gone";
    throw error;
  }
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
