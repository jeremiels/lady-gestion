import { html, nothing, type ReactiveControllerHost } from "lit";
import { downloadBackup, readBackupFile } from "../data/index.ts";

type MessageKind = "status" | "error";

/**
 * Export and restore, with the message each leaves on screen, for the two
 * screens that offer them: the profile page and `app-root`'s data-error
 * screen, which every route renders instead of its view when the database
 * will not open. One owner for the copy and its markup, so the two cannot
 * disagree about what the user is told.
 *
 *     #backup = new BackupActions(this);
 *
 *     // <button @click=${this.#backup.export}>
 *     // <button @click=${this.#backup.restore}>
 *     // ${this.#backup.renderMessage({ region: "…", status: "…", error: "…" })}
 *
 * One message at a time: each attempt clears it before it starts, and when two
 * overlap, the one that finishes last decides what is shown.
 *
 * Holds the host only to re-render it. There is no lifecycle to hook, so it
 * does not register itself with `addController`.
 */
export class BackupActions {
  #message: { kind: MessageKind; text: string } | null = null;

  #host: ReactiveControllerHost;
  #afterRestore: string;

  /** `afterRestore` is appended to the message after a successful restore. */
  constructor(
    host: ReactiveControllerHost,
    { afterRestore = "" }: { afterRestore?: string } = {},
  ) {
    this.#host = host;
    this.#afterRestore = afterRestore;
  }

  export = () =>
    this.#run("Export impossible.", async () => {
      await downloadBackup();
      return "Sauvegarde téléchargée.";
    });

  /**
   * Opens the file picker and restores the file picked. A fresh input per
   * pick, so picking the same file again after a failure still fires
   * `change`. It is attached to the document while the picker is open for
   * the same reason `downloadBackup` attaches its anchor: a detached element
   * is not guaranteed to act on `click()` in every engine.
   */
  restore = () => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: "application/json,.json",
      hidden: true,
    });
    const done = () => input.remove();
    input.addEventListener("cancel", done, { once: true });
    input.addEventListener(
      "change",
      () => {
        done();
        const file = input.files?.[0];
        if (file) void this.#restoreFile(file);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  };

  /**
   * The message, inside two live regions that are always rendered: a polite
   * one for a result, an assertive one for a failure. A live region has to be
   * in the accessibility tree before its contents change or the change is not
   * announced, so only the paragraph inside comes and goes — the shape of
   * `PostDetailView`'s error region.
   *
   * The host names the classes because its stylesheet is the one that can
   * reach them. It gives `region` `display: contents`, so an empty region adds
   * no gap to its layout.
   */
  renderMessage(classes: { region: string; status: string; error: string }) {
    const message = this.#message;
    const paragraph = (kind: MessageKind) =>
      message?.kind === kind
        ? html`<p class=${classes[kind]}>${message.text}</p>`
        : nothing;
    return html`
      <div class=${classes.region} role="status">${paragraph("status")}</div>
      <div class=${classes.region} role="alert">${paragraph("error")}</div>
    `;
  }

  #restoreFile = (file: File) =>
    this.#run("Import impossible.", async () => {
      const { imported, skipped } = await readBackupFile(file);
      const message = `${imported} enregistrement(s) restauré(s), ${skipped} ignoré(s) car déjà à jour.`;
      return this.#afterRestore ? `${message} ${this.#afterRestore}` : message;
    });

  async #run(fallback: string, action: () => Promise<string>) {
    this.#message = null;
    this.#host.requestUpdate();
    try {
      this.#message = { kind: "status", text: await action() };
    } catch (error: unknown) {
      this.#message = {
        kind: "error",
        text: error instanceof Error ? error.message : fallback,
      };
    }
    this.#host.requestUpdate();
  }
}
