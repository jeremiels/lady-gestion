import { PUSH_API_URL } from "../pwa/push-config.ts";

/**
 * Where the Google sign-in is brokered: the same Worker that sends push
 * reminders (`server/`), so one URL to keep right rather than two.
 */
export const DRIVE_AUTH_URL: string = PUSH_API_URL;

/** Drive's REST API, called straight from the phone (CORS-enabled). */
export const DRIVE_API_URL = "https://www.googleapis.com/drive/v3";
