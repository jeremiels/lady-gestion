/**
 * Web Push reminders: the app's only network call.
 *
 * iOS gives a web app no way to wake itself at a given time, so a reminder
 * has to be sent by a server. The Worker in `server/` holds the list and
 * sends each entry when it falls due; this module keeps that list equal to
 * what IndexedDB says (`watchReminders`, `src/data/reminders.ts`), replacing it
 * whole on every change. IndexedDB stays authoritative: with the server down,
 * no reminder goes out and everything else works as before.
 */

import { watchReminders, type Reminder } from "../data/index.ts";
import { PUSH_API_URL, VAPID_PUBLIC_KEY } from "./push-config.ts";

/** Why push could not be switched on — each one is its own message. */
export type PushRefusal = "not-installed" | "denied" | "unavailable";

/** Changes arriving in a burst — a save plus its follow-up copy — send once. */
const SYNC_DELAY_MS = 1000;

/**
 * Resolved once the service worker is ready, which only happens in a
 * production build (`initPwa`). Held rather than awaited in `enablePush`: the
 * subscribe call has to start inside the tap that asked for it.
 */
let registration: ServiceWorkerRegistration | null = null;
let latest: Reminder[] | null = null;
let lastSent = "";
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Read through a function so the answer after a prompt is not taken for the
 * one before it — a direct read gets narrowed by the check that preceded it.
 */
const permission = (): NotificationPermission => Notification.permission;

const configured = (): boolean =>
  PUSH_API_URL !== "" && VAPID_PUBLIC_KEY !== "";

/** `PushManager` wants the key as bytes; Safari does not take the string. */
const keyBytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const subscribe = (manager: PushManager): Promise<PushSubscription> =>
  manager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
  });

/**
 * Asks for permission and subscribes this device, from the tap on "Créer une
 * notification". Resolves `null` once subscribed, or the reason it could not.
 *
 * `subscribe()` is the first call, with nothing awaited before it: it is what
 * raises the permission prompt, and Safari only shows one inside the user
 * gesture that asked for it.
 */
export const enablePush = async (): Promise<PushRefusal | null> => {
  // Safari exposes the Push API only to an app opened from the Home Screen,
  // so on an iPhone this is "not installed" rather than "not supported".
  if (!("PushManager" in window)) return "not-installed";
  if (permission() === "denied") return "denied";
  if (!registration || !configured()) return "unavailable";

  try {
    await subscribe(registration.pushManager);
  } catch {
    return permission() === "denied" ? "denied" : "unavailable";
  }
  scheduleSync();
  return null;
};

/**
 * Starts keeping the server's list in step with the device's. Called once,
 * from `initPwa`, in a production build only.
 */
export function initPushSync() {
  if (!("PushManager" in window) || !configured()) return;

  void navigator.serviceWorker.ready.then((ready) => {
    registration = ready;
    scheduleSync();
  });
  watchReminders((reminders) => {
    latest = reminders;
    scheduleSync();
  });
  // A sync that failed offline is retried as soon as there is a network, and
  // on every return to the foreground — both are no-ops when nothing changed.
  window.addEventListener("online", scheduleSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync();
  });
}

function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(() => void sync(), SYNC_DELAY_MS);
}

/**
 * Sends the whole list, unless the server already has exactly this one.
 *
 * A device with no subscription sends nothing — except when it has reminders
 * and permission is still granted: the browser dropped the subscription on its
 * own, and subscribing again needs no prompt.
 */
async function sync() {
  if (!registration || latest === null) return;
  const manager = registration.pushManager;

  let subscription = await manager.getSubscription();
  if (!subscription && latest.length > 0 && permission() === "granted") {
    subscription = await subscribe(manager).catch(() => null);
  }
  if (!subscription) return;

  const body = JSON.stringify({
    subscription: subscription.toJSON(),
    reminders: latest,
  });
  if (body === lastSent) return;

  try {
    const response = await fetch(`${PUSH_API_URL}/reminders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    lastSent = body;
  } catch (error: unknown) {
    // Not actionable from here: the next change, the next time online and the
    // next return to the foreground all try again.
    console.warn("[push] Envoi des rappels impossible :", error);
  }
}
