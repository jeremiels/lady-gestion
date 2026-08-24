/**
 * Service worker registration and the two browser guarantees an offline-first
 * app depends on: the app shell surviving without a network, and the database
 * surviving the browser reclaiming storage.
 *
 * `dist/sw.js` only exists in a production build (see `vite.config.ts`), so
 * nothing here runs under `npm run dev` — test with `npm run build && npm run
 * preview`.
 */

import { appHref } from '../commons/base-path.ts';

/** Fired on `window` once a new version is installed and waiting. */
export const UPDATE_READY_EVENT = 'pwa-update-ready';

declare global {
  interface WindowEventMap {
    [UPDATE_READY_EVENT]: CustomEvent<void>;
  }
}

/**
 * Minimum gap between update checks. `app-root` intercepts every navigation,
 * so the browser's own cross-document check never fires — without an explicit
 * poll, an installed PWA that is only ever resumed can run an old build
 * indefinitely. A visibility flip is cheap; the round trip for `sw.js` is not.
 */
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

let waitingWorker: ServiceWorker | null = null;
let reloading = false;
let lastUpdateCheck = 0;

export function initPwa() {
  void requestPersistentStorage();

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Registering after `load` keeps the worker's install — which downloads the
  // whole precache — off the critical path of the first paint.
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}

/**
 * Activates the waiting worker. The page reloads once it takes over, so the
 * newly precached assets are the ones actually running.
 */
export function applyUpdate() {
  if (!waitingWorker) {
    // The toast is stale — another tab already applied this update, so there is
    // no worker left parked. Reload into whatever is current rather than
    // leaving the button looking broken.
    window.location.reload();
    return;
  }

  waitingWorker.postMessage('SKIP_WAITING');
}

async function registerServiceWorker() {
  try {
    // `appHref` and not a bare '/sw.js': the registration URL also fixes the
    // worker's default scope to its own directory, so on a hosted subpath a
    // root-absolute URL would both 404 and, if it resolved, claim a scope the
    // page is not inside.
    const registration = await navigator.serviceWorker.register(appHref('/sw.js'), {
      type: 'classic'
    });

    // `register()` has just fetched sw.js; don't immediately re-check.
    lastUpdateCheck = Date.now();
    watchForUpdates(registration);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // `controllerchange` also fires on the very first install, when there is
      // nothing to reload into — and reloading again after we already did
      // would loop.
      if (reloading || !waitingWorker) return;
      reloading = true;
      window.location.reload();
    });

    // A worker can already be parked from an earlier visit.
    if (registration.waiting && navigator.serviceWorker.controller) {
      announceUpdate(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        // Without a controller this is the first install: the app is now
        // available offline, but there is nothing for the user to update to.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announceUpdate(installing);
        }
      });
    });
  } catch (error: unknown) {
    // A failed registration costs the offline mode, not the app — the data
    // lives in IndexedDB either way.
    console.error('Impossible d’installer le service worker', error);
  }
}

/**
 * Asks the browser to re-fetch `sw.js` whenever the app comes back to the
 * foreground. This is the only thing that surfaces a new build to a session
 * that is never cold-started — the common case for an installed PWA.
 */
function watchForUpdates(registration: ServiceWorkerRegistration) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheck = now;

    // Offline, or the server is unreachable. The next foreground retries.
    void registration.update().catch(() => {});
  });
}

function announceUpdate(worker: ServiceWorker) {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT));
}

/**
 * Without this, IndexedDB is "best effort" storage the browser may evict when
 * the device runs low — and this app's only copy of the data lives there.
 * Chrome grants it silently on an installed PWA; Firefox prompts; Safari
 * decides on its own. Failure is not actionable, hence the silent catch.
 */
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;

  try {
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // Ignored on purpose: nothing the user could do about it.
  }
}
