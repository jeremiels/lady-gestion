import { html, nothing, type ReactiveControllerHost } from "lit";
import { confirmDialog } from "./confirm-dialog.ts";
import {
  downloadBackup,
  errorMessage,
  formatTimestamp,
  planRestore,
  runRestore,
  type ExportOutcome,
  type RestoreOutcome,
  type RestorePlan,
} from "../data/index.ts";

type MessageKind = "status" | "error";

/**
 * What an export says it did — no more than it knows. Only the share sheet
 * confirms a file was kept; a download is handed to the browser, which does
 * not say.
 */
const EXPORT_MESSAGES: Record<ExportOutcome, string> = {
  shared: "Sauvegarde enregistrée.",
  downloaded:
    "Fichier de sauvegarde proposé au téléchargement. Vérifiez qu’il a bien été enregistré.",
  cancelled: "Export annulé : aucune sauvegarde n’a été enregistrée.",
};

/**
 * What the copy taken before a restore became, said ahead of the restore's
 * own count. No `cancelled`: a copy dismissed stops the restore instead.
 */
const COPY_MESSAGES: Record<Exclude<ExportOutcome, "cancelled">, string> = {
  shared: "Copie des données précédentes enregistrée.",
  downloaded:
    "Copie des données précédentes proposée au téléchargement : vérifiez qu’elle a bien été enregistrée.",
};

/** What the confirmation says below its description, a line each. */
const restoreLines = ({ copy, unsentFiles }: RestorePlan): string[] => {
  const lines: string[] = [];
  if (copy)
    lines.push("Une copie des données actuelles sera d’abord exportée.");
  if (unsentFiles === 1) {
    lines.push(
      "1 fichier ajouté sur cet appareil n’est pas encore dans le Drive : il sera perdu.",
    );
  } else if (unsentFiles > 1) {
    lines.push(
      `${unsentFiles} fichiers ajoutés sur cet appareil ne sont pas encore dans le Drive : ils seront perdus.`,
    );
  }
  return lines;
};

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
 *     // ${this.#backup.render({ region: "…", status: "…", error: "…" })}
 *
 * A restore replaces everything on the device, so it asks first, naming the
 * file and what it would take away (`planRestore`), and the tap on Remplacer
 * carries it out (`runRestore`): a copy first when the device holds anything
 * of hers, and nothing replaced if that copy is dismissed.
 *
 * One message at a time: each attempt clears it before it starts, and when two
 * overlap, the last one to say something decides what is shown.
 *
 * Holds the host only to re-render it. There is no lifecycle to hook, so it
 * does not register itself with `addController`.
 */
export class BackupActions {
  #message: { kind: MessageKind; text: string } | null = null;
  #plan: RestorePlan | null = null;

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
    this.#run(
      "Export impossible.",
      async () => EXPORT_MESSAGES[await downloadBackup()],
    );

  /**
   * Opens the file picker and asks to restore the file picked. A fresh input per
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
        if (file) void this.#pick(file);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  };

  /**
   * What the actions leave on screen: the message, and the confirmation a
   * restore waits on.
   *
   * The message sits inside two live regions that are always rendered: a
   * polite one for a result, an assertive one for a failure. A live region has
   * to be in the accessibility tree before its contents change or the change
   * is not announced, so only the paragraph inside comes and goes — the shape
   * of `PostDetailView`'s error region.
   *
   * The host names the classes because its stylesheet is the one that can
   * reach them. It gives `region` `display: contents`, so an empty region adds
   * no gap to its layout.
   *
   * The confirmation is an `app-modal`, drawn in the top layer once open, so
   * where the host puts this does not move it.
   */
  render(classes: { region: string; status: string; error: string }) {
    return html`${this.#renderMessage(classes)}${this.#renderConfirm()}`;
  }

  #renderMessage(classes: { region: string; status: string; error: string }) {
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

  /**
   * The confirmation a restore waits on, closed until a file has been picked
   * and read.
   */
  #renderConfirm() {
    const plan = this.#plan;
    return confirmDialog({
      heading: "Remplacer les données ?",
      description: plan
        ? `Tout ce que contient cet appareil sera remplacé par la sauvegarde du ${formatTimestamp(plan.backup.exportedAt)}.`
        : "",
      lines: plan ? restoreLines(plan) : [],
      open: plan !== null,
      cancel: "Annuler",
      confirm: "Remplacer",
      onCancel: this.#dismiss,
      onConfirm: this.#confirm,
    });
  }

  /** Reads the file and what restoring it would take away. Writes nothing. */
  #pick = (file: File) =>
    this.#run("Import impossible.", async () => {
      this.#plan = await planRestore(file);
    });

  #dismiss = () => {
    this.#plan = null;
    this.#host.requestUpdate();
  };

  /** Straight from the tap on Remplacer, whose activation the copy needs. */
  #confirm = () => {
    const plan = this.#plan;
    if (!plan) return;
    this.#plan = null;
    void this.#run("Import impossible.", async () =>
      this.#restoreMessage(await runRestore(plan)),
    );
  };

  #restoreMessage(outcome: RestoreOutcome): string {
    if (outcome === "cancelled") {
      return "Restauration annulée : la copie des données actuelles n’a pas été enregistrée.";
    }
    return [
      outcome.copy && COPY_MESSAGES[outcome.copy],
      `${outcome.restored} enregistrement(s) restauré(s).`,
      this.#afterRestore,
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Runs `action` with the message cleared, leaving on screen what it
   * returns — nothing, for a step that only leads to the next — or the error
   * when it throws.
   */
  async #run(fallback: string, action: () => Promise<string | void>) {
    this.#message = null;
    this.#host.requestUpdate();
    try {
      const text = await action();
      if (text) this.#message = { kind: "status", text };
    } catch (error: unknown) {
      this.#message = { kind: "error", text: errorMessage(error, fallback) };
    }
    this.#host.requestUpdate();
  }
}
