// Must run before `db.ts` is imported: Dexie binds to the global indexedDB when
// the instance is constructed, which happens at module scope.
import 'fake-indexeddb/auto';
