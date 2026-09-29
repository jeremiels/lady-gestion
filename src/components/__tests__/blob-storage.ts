/**
 * Whether this browser's IndexedDB takes a `Blob`.
 *
 * WebKit refuses one in an ephemeral session — Safari's private browsing, and
 * every context Playwright starts — with "Error preparing Blob/File data to
 * be stored in object store". An installed app has persistent storage and
 * takes them; a test run in WebKit cannot, so a test that stores file bytes
 * asks first and says it was skipped rather than failing on the harness.
 */
export const indexedDbStoresBlobs = async (): Promise<boolean> => {
  const name = "blob-storage-probe";
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("probe");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("probe", "readwrite");
        tx.objectStore("probe").put(new Blob(["probe"]), "blob");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  } finally {
    indexedDB.deleteDatabase(name);
  }
};
