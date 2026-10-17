import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSwitch } from "../components/app-switch/app-switch.ts";
import { db } from "../data/db.ts";
import { metaRepo } from "../data/index.ts";
import { HORSE_ID, makeHorse, resetDb } from "../data/__tests__/factories.ts";
import {
  dismissed,
  horse,
  pickedFile,
  post,
  refused,
  snapshot,
  stubShare,
} from "../data/backup/snapshot.fixtures.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./ProfileView.ts";
import type { ProfileView } from "./ProfileView.ts";

const mount = () => fixture<ProfileView>(html`<profile-view></profile-view>`);

// Calendar days in local time, the unit the view counts in — not 24-hour spans
// back from now.
const daysAgo = (days: number, hour = 0, minute = 0) => {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days,
    hour,
    minute,
  );
};

const setLastBackup = (at: Date) =>
  db.meta.put({ key: "lastBackupAt", value: at.toISOString() });

// The hint alone, not the page: "fichier", on the restore button and in the
// note under it, contains "hier".
const backupAge = (el: ProfileView) =>
  el.querySelector(".profile-view__hint")!.textContent;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("profile-view", () => {
  it("phrases the backup age as today, yesterday, then a day count — reactively", async () => {
    const el = await mount();
    await waitFor(
      el,
      () => backupAge(el) === "Aucune sauvegarde effectuée pour l’instant.",
    );

    await setLastBackup(daysAgo(0));
    await waitFor(
      el,
      () => backupAge(el) === "Dernière sauvegarde : aujourd’hui.",
    );

    await setLastBackup(daysAgo(1));
    await waitFor(el, () => backupAge(el) === "Dernière sauvegarde : hier.");

    await setLastBackup(daysAgo(5));
    await waitFor(
      el,
      () => backupAge(el) === "Dernière sauvegarde : il y a 5 jours.",
    );
  });

  it("counts calendar days, not elapsed 24-hour spans", async () => {
    // Late yesterday is under 24 hours ago for most of today, yet reads "hier".
    await setLastBackup(daysAgo(1, 23, 59));

    const el = await mount();
    await waitFor(el, () => backupAge(el) === "Dernière sauvegarde : hier.");
  });

  it("reflects and persists the notifications preference", async () => {
    await metaRepo.setNotificationsEnabled(false);

    const el = await mount();
    const toggle = () => el.querySelector("app-switch")!;
    await waitFor(el, () => toggle().checked === false);

    toggle().renderRoot.querySelector("input")!.click();
    await settled(el);

    let enabled = await metaRepo.getNotificationsEnabled();
    for (let i = 0; i < 20 && !enabled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      enabled = await metaRepo.getNotificationsEnabled();
    }
    expect(enabled).toBe(true);
  });

  it("still downloads the export when the share sheet refuses it", async () => {
    stubShare(refused);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const el = await mount();

    [...el.querySelectorAll("button")]
      .find((button) => button.textContent!.includes("Exporter"))!
      .click();

    await waitFor(el, () => click.mock.calls.length > 0);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  describe("restore", () => {
    const backup = snapshot({
      exportedAt: "2026-10-16T06:27:52.924Z",
      tables: {
        horses: [horse({ id: "horse-from-file" })],
        posts: [post({ horseId: "horse-from-file" })],
      },
    });

    /** Picks the backup through "Restaurer un fichier"; resolves with the confirmation open. */
    const pick = async (el: ProfileView) => {
      const transfer = new DataTransfer();
      transfer.items.add(pickedFile(backup));

      [...el.querySelectorAll("button")]
        .find((button) => button.textContent!.includes("Restaurer"))!
        .click();
      const input = document.querySelector<HTMLInputElement>(
        'body > input[type="file"]',
      )!;
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const modal = () =>
        el.querySelector<HTMLElement & { open: boolean; description: string }>(
          "app-modal",
        )!;
      await waitFor(el, () => modal().open);
      return modal();
    };

    const press = (el: ProfileView, label: string) =>
      [...el.querySelectorAll("app-modal button")]
        .find((button) => button.textContent!.trim() === label)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    it("asks first, exports a copy of what is here, then replaces it", async () => {
      const shared = stubShare();
      const el = await mount();
      // Held from before there is anything to say: the result has to land in
      // a region that was already mounted, or screen readers announce nothing.
      const region = el.querySelector('[role="status"]')!;
      expect(region).not.toBeNull();

      const modal = await pick(el);
      expect(modal.description).toContain(
        "Tout ce que contient cet appareil sera remplacé par la sauvegarde du 16 oct. 2026",
      );
      expect(modal.textContent).toContain(
        "Une copie des données actuelles sera d’abord exportée.",
      );
      // Nothing written while it asks.
      expect(await db.horses.count()).toBe(1);

      press(el, "Remplacer");

      await waitFor(el, () => region.textContent!.includes("restauré"));
      expect(region.textContent).toContain(
        "Copie des données précédentes enregistrée. 2 enregistrement(s) restauré(s).",
      );
      const copy = JSON.parse(await shared[0]!.text()) as {
        tables: { horses: { id: string }[] };
      };
      expect(copy.tables.horses.map((row) => row.id)).toEqual([HORSE_ID]);
      expect((await db.horses.toArray()).map((row) => row.id)).toEqual([
        "horse-from-file",
      ]);
    });

    it("replaces nothing when the copy is dismissed", async () => {
      stubShare(dismissed);
      const el = await mount();
      const region = el.querySelector('[role="status"]')!;

      await pick(el);
      press(el, "Remplacer");

      await waitFor(el, () => region.textContent!.includes("annulée"));
      expect(region.textContent).toContain(
        "Restauration annulée : la copie des données actuelles n’a pas été enregistrée.",
      );
      expect(await db.horses.count()).toBe(1);
    });

    it("replaces nothing, and downloads nothing, when the share sheet refuses the copy", async () => {
      stubShare(refused);
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
      const el = await mount();
      const alert = el.querySelector('.profile-view__backup [role="alert"]')!;

      await pick(el);
      press(el, "Remplacer");

      await waitFor(el, () => alert.textContent!.includes("rien n’a été"));
      expect(alert.textContent).toContain(
        "La copie des données actuelles n’a pas pu être exportée : rien n’a été remplacé.",
      );
      expect(click).not.toHaveBeenCalled();
      expect(await db.horses.count()).toBe(1);
      click.mockRestore();
    });

    it("replaces nothing when the confirmation is cancelled", async () => {
      const shared = stubShare();
      const el = await mount();

      const modal = await pick(el);
      press(el, "Annuler");

      await waitFor(el, () => !modal.open);
      expect(shared).toHaveLength(0);
      expect(await db.horses.count()).toBe(1);
    });
  });
});

describe("profile-view — the notifications switch", () => {
  it("says so when the preference does not save, and switches back", async () => {
    const el = await mount();
    const toggle = () => el.querySelector<AppSwitch>("app-switch")!;
    await waitFor(el, () => toggle()?.checked === true);
    const put = vi
      .spyOn(db.meta, "put")
      .mockRejectedValue(new Error("illisible"));

    toggle().renderRoot.querySelector<HTMLInputElement>("input")!.click();

    await waitFor(
      el,
      () =>
        el
          .querySelector(".profile-view__error")
          ?.textContent?.includes("Modification impossible") ?? false,
    );
    expect(toggle().checked).toBe(true);
    put.mockRestore();
  });
});

describe("profile-view — Google Drive", () => {
  afterEach(() => vi.unstubAllGlobals());

  const driveSection = (el: ProfileView) =>
    [...el.querySelectorAll(".profile-view__section")].find((section) =>
      section.textContent!.includes("Google Drive"),
    )!;

  it("offers a sign-in link to the Worker, ready before the tap", async () => {
    const el = await mount();
    const link = () =>
      driveSection(el).querySelector<HTMLAnchorElement>("a[target=_blank]");
    await waitFor(el, () => Boolean(link()?.getAttribute("href")));

    expect(link()!.href).toMatch(
      /\/auth\/google\/start\?claim_hash=[0-9a-f]{64}$/,
    );
    expect(await metaRepo.get("driveClaim")).toBeDefined();
  });

  it("shows who is connected and the folder, and signs out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await metaRepo.set("googleAccount", {
      email: "lea@example.com",
      sessionToken: "session-token",
      scope: "openid https://www.googleapis.com/auth/drive",
    });
    await metaRepo.set("driveFolder", { id: "f1", name: "PONEY" });

    const el = await mount();
    // Two queries, answering one after the other.
    await waitFor(el, () => driveSection(el).textContent!.includes("PONEY"));
    expect(driveSection(el).textContent).toContain("lea@example.com");

    [...driveSection(el).querySelectorAll("button")]
      .find((button) => button.textContent!.includes("Déconnecter"))!
      .click();

    await waitFor(el, () =>
      driveSection(el).textContent!.includes("Connecter Google Drive"),
    );
    expect(await metaRepo.get("googleAccount")).toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/auth\/logout$/);
  });
});
