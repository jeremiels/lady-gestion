import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSwitch } from "../components/app-switch/app-switch.ts";
import { db, SCHEMA_VERSION } from "../data/db.ts";
import { metaRepo, nowISO } from "../data/index.ts";
import { OWNER, makeHorse, resetDb } from "../data/__tests__/factories.ts";
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

  it("restores the file picked from the restore button", async () => {
    const el = await mount();
    // Held from before there is anything to say: the result has to land in a
    // region that was already mounted, or screen readers announce nothing.
    const region = el.querySelector('[role="status"]')!;
    expect(region).not.toBeNull();

    const backup = {
      app: "lady-gestion",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowISO(),
      ownerId: OWNER,
      tables: {
        horses: [],
        posts: [],
        documents: [],
        documentFolders: [],
        rationItems: [],
        activities: [],
        categories: [],
        profiles: [],
      },
    };
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    [...el.querySelectorAll("button")]
      .find((button) => button.textContent!.includes("Restaurer"))!
      .click();
    const input = document.querySelector<HTMLInputElement>(
      'body > input[type="file"]',
    )!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(el, () => region.textContent!.includes("restauré"));
    expect(region.textContent).toContain("0 enregistrement(s) restauré(s)");
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
