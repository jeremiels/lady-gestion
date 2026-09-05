/**
 * Client-generated identifiers.
 *
 * UUIDs rather than IndexedDB auto-increment keys: a record created offline
 * already carries a permanent, globally unique id, so it can be pushed to a
 * shared server database later without renumbering or colliding with another
 * user's rows.
 */
export const newId = (): string => {
  // Available in every secure context (https + localhost), which a PWA always is.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // Fallback for non-secure origins (e.g. an http:// LAN address during dev).
  // The array is fixed-length so indices 6 and 8 always exist; the `?? 0` only
  // exists to satisfy `noUncheckedIndexedAccess`.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
