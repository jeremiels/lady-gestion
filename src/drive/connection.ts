import type { ReactiveController, ReactiveControllerHost } from "lit";
import { LiveQuery } from "../data/index.ts";
import {
  getAccount,
  getFolder,
  markSignInStarted,
  prepareSignIn,
  signOut,
} from "./auth.ts";

/**
 * The Drive connection as a view sees it: who is signed in, which folder is
 * the general one, and the address "Connecter Google Drive" opens.
 *
 * The address is prepared ahead, whenever the view shows the signed-out
 * state — iOS opens the sign-in window only from inside the tap, so the tap
 * has to land on a plain link with nothing left to compute. Prepared again
 * after a sign-out, since a finished sign-in uses its claim up.
 */
export class DriveConnection implements ReactiveController {
  href = "";

  #host: ReactiveControllerHost;
  #account: LiveQuery<Awaited<ReturnType<typeof getAccount>>>;
  #folder: LiveQuery<Awaited<ReturnType<typeof getFolder>>>;
  /** Whether `href` belongs to the current signed-out stretch. */
  #prepared = false;

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
    this.#account = new LiveQuery(host, getAccount);
    this.#folder = new LiveQuery(host, getFolder);
    host.addController(this);
  }

  get loading(): boolean {
    return this.#account.loading;
  }

  get account() {
    return this.#account.value;
  }

  get folder() {
    return this.#folder.value;
  }

  hostUpdate() {
    if (this.loading) return;
    if (this.account) {
      this.#prepared = false;
      return;
    }
    if (this.#prepared) return;
    this.#prepared = true;
    void prepareSignIn().then((href) => {
      this.href = href;
      this.#host.requestUpdate();
    });
  }

  /** For the link's `@click`: never blocks the navigation it rides on. */
  onLinkClick = () => {
    void markSignInStarted();
  };

  signOut = (): Promise<void> => signOut();
}
