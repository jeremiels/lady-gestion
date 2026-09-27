import { RECORD_TABLE_NAMES, db, type BackupTables } from "../db.ts";
import { nowISO } from "../dates.ts";
import { UserFacingError } from "../errors.ts";
import type { BackupSnapshot } from "./snapshot.ts";

const UNREADABLE = "Aucune donnée locale n’a pu être lue.";

/**
 * Every record table, tombstones included, read in one readonly transaction
 * straight from IndexedDB.
 *
 * Not through Dexie, so the one reader works whatever state Dexie is in —
 * open, or never opened because `initData()` failed at `db.open()`, which is
 * most of what the data-error screen reports — and never makes Dexie retry an
 * open that failed. A connection opened with no version sits beside Dexie's
 * own and never upgrades anything. Nothing in `db.ts` maps rows to classes or
 * hooks reading, so `getAll()` returns exactly what `toArray()` would.
 *
 * One transaction, so a write landing mid-export cannot leave a post in the
 * file without the document that points at it. The owner comes from `meta`,
 * not from `owner.ts`'s cache, which only exists once `initData()` got that
 * far.
 *
 * `schemaVersion` is the database's own — Dexie stores version *n* as
 * IndexedDB version `n * 10` — so a database a failed upgrade left behind says
 * so, and `importBackup` migrates it. A store that version does not have yet
 * is written as an empty table: it holds no rows to carry.
 */
export const exportBackup = (): Promise<BackupSnapshot> =>
  new Promise((resolve, reject) => {
    const fail = () => reject(new UserFacingError(UNREADABLE));
    const request = indexedDB.open(db.name);
    // No database at all: opening would create an empty one. Abort instead.
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = fail;
    request.onsuccess = () => {
      const idb = request.result;
      // Never the reason another tab's upgrade has to wait.
      idb.onversionchange = () => idb.close();

      const has = (name: string) => idb.objectStoreNames.contains(name);
      const tables: Record<string, unknown[]> = {};
      let ownerId = "";
      try {
        const tx = idb.transaction(
          [...RECORD_TABLE_NAMES, "meta"].filter(has),
          "readonly",
        );
        for (const name of RECORD_TABLE_NAMES) {
          tables[name] = [];
          if (!has(name)) continue;
          const all = tx.objectStore(name).getAll();
          all.onsuccess = () => (tables[name] = all.result);
        }
        if (has("meta")) {
          const owner = tx.objectStore("meta").get("ownerId");
          owner.onsuccess = () => {
            const value = (owner.result as { value?: unknown } | undefined)
              ?.value;
            if (typeof value === "string") ownerId = value;
          };
        }
        tx.oncomplete = () => {
          idb.close();
          resolve({
            app: "lady-gestion",
            schemaVersion: Math.floor(idb.version / 10),
            exportedAt: nowISO(),
            ownerId,
            // Rows as stored at `schemaVersion`; `importBackup` validates.
            tables: tables as BackupTables,
          });
        };
        tx.onerror = () => {
          idb.close();
          fail();
        };
      } catch {
        idb.close();
        fail();
      }
    };
  });
