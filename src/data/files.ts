/**
 * File presentation helpers.
 *
 * Here rather than in a component because turning a stored `size` or
 * `mimeType` into something a user reads is the same kind of pure, testable
 * conversion `money.ts` and `seasons.ts` do — and this way it falls under the
 * data-layer test rule instead of being verified by squinting at a screenshot.
 */

/** Kibibyte, not kilobyte: what every OS file browser shows. */
const STEP = 1024;

const UNITS = ["o", "Ko", "Mo", "Go", "To"] as const;

const SIZE_FORMAT = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 1,
});

/**
 * `1_258_291` -> `1,2 Mo`. French uses the octet, and a comma for the decimal
 * separator — `Intl` handles the latter so the string matches every other
 * number in the app.
 *
 * Bytes are never shown fractionally: "1,5 o" is nonsense.
 */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";

  let size = bytes;
  let unit = 0;
  while (size >= STEP && unit < UNITS.length - 1) {
    size /= STEP;
    unit += 1;
  }

  const value = unit === 0 ? Math.round(size) : size;
  return `${SIZE_FORMAT.format(value)} ${UNITS[unit]}`;
};

export const isPdf = (mimeType: string): boolean =>
  mimeType === "application/pdf";

export const isImage = (mimeType: string): boolean =>
  mimeType.startsWith("image/");

/**
 * The short label next to the size, e.g. `PDF`, `JPEG`, `DOCX`.
 *
 * Taken from the mime subtype rather than the file extension: the extension is
 * part of a user-supplied name and may be missing or wrong, while `mimeType`
 * is read off the `Blob` itself at import time.
 */
export const formatFileKind = (mimeType: string): string => {
  if (isPdf(mimeType)) return "PDF";

  const subtype = mimeType.split("/")[1];
  if (!subtype || subtype === "octet-stream") return "Fichier";

  // `vnd.openxmlformats-officedocument.wordprocessingml.document` -> `DOCUMENT`.
  const tail = subtype.split(/[.+]/).pop() ?? subtype;
  return tail.toUpperCase();
};
