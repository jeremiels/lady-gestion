import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db, SCHEMA_VERSION } from "../data/db.ts";
import { metaRepo, nowISO } from "../data/index.ts";
import { OWNER, makeHorse, resetDb } from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./ProfileView.ts";
import type { ProfileView } from "./ProfileView.ts";

const mount = () => fixture<ProfileView>(html`<profile-view></profile-view>`);

const setLastBackup = (daysAgo: number) =>
  db.meta.put({
    key: "lastBackupAt",
    value: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("profile-view", () => {
  it("phrases the backup age as today, yesterday, then a day count — reactively", async () => {
    const el = await mount();
    await waitFor(el, () => el.textContent!.includes("Aucune sauvegarde"));

    await setLastBackup(0);
    await waitFor(el, () => el.textContent!.includes("aujourd’hui"));

    await setLastBackup(1);
    await waitFor(el, () => el.textContent!.includes("hier"));

    await setLastBackup(5);
    await waitFor(el, () => el.textContent!.includes("il y a 5 jours"));
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

  it("restores a backup file dropped on the import input", async () => {
    const el = await mount();
    await waitFor(el, () => el.querySelector("#backup-file") !== null);

    const backup = {
      app: "lady-gestion",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowISO(),
      ownerId: OWNER,
      tables: {
        horses: [],
        events: [],
        documents: [],
        rationItems: [],
        activities: [],
        eventTypes: [],
      },
    };
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    const input = el.querySelector<HTMLInputElement>("#backup-file")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(el, () => el.textContent!.includes("restauré"));
    expect(el.textContent).toContain("0 enregistrement(s) restauré(s)");
  });
});
