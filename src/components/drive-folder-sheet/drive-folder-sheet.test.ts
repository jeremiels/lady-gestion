import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaRepo } from "../../data/index.ts";
import { resetDb } from "../../data/__tests__/factories.ts";
import { fixture, waitFor } from "../__tests__/fixture.ts";
import "./drive-folder-sheet.ts";
import type { DriveFolderSheet } from "./drive-folder-sheet.ts";

/** A pretend Drive: folder id -> the folders inside it. */
const TREE: Record<string, { id: string; name: string }[]> = {
  root: [{ id: "poney", name: "PONEY 🎠" }],
  poney: [{ id: "osteo", name: "Ostéopathe" }],
  osteo: [],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

const fakeFetch = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/drive/token")) {
      return json({ accessToken: "ya29.a", expiresAt: Date.now() + 3_600_000 });
    }
    if (init?.method === "POST") {
      const { name, parents } = JSON.parse(String(init.body)) as {
        name: string;
        parents: string[];
      };
      const created = { id: `new-${name}`, name };
      TREE[parents[0]!]!.push(created);
      TREE[created.id] = [];
      return json(created);
    }
    const parent = /'([^']+)' in parents/.exec(url.searchParams.get("q")!)![1]!;
    return json({ files: TREE[parent] ?? [] });
  },
);

const mount = () =>
  fixture<DriveFolderSheet>(
    html`<drive-folder-sheet .open=${true}></drive-folder-sheet>`,
  );

const root = (el: DriveFolderSheet) => el.shadowRoot!;
const folderButton = (el: DriveFolderSheet, name: string) =>
  [...root(el).querySelectorAll<HTMLButtonElement>(".folder")].find((button) =>
    button.textContent!.includes(name),
  );
const useButton = (el: DriveFolderSheet) =>
  root(el).querySelector<HTMLButtonElement>(".submit")!;

beforeEach(async () => {
  await resetDb();
  await metaRepo.set("googleAccount", {
    email: "lea@example.com",
    sessionToken: "session-token",
    scope: "openid https://www.googleapis.com/auth/drive",
  });
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("drive-folder-sheet", () => {
  it("browses down from Mon Drive and saves the folder it stands in", async () => {
    const el = await mount();
    const chosen = vi.fn();
    el.addEventListener("drive-folder-chosen", chosen);

    await waitFor(el, () => folderButton(el, "PONEY") !== undefined);
    // The whole Drive is not a choice.
    expect(useButton(el).disabled).toBe(true);

    folderButton(el, "PONEY")!.click();
    await waitFor(el, () => folderButton(el, "Ostéopathe") !== undefined);
    useButton(el).click();

    await waitFor(el, () => chosen.mock.calls.length > 0);
    expect(await metaRepo.get("driveFolder")).toEqual({
      id: "poney",
      name: "PONEY 🎠",
    });
  });

  it("proposes « ladympala » at the top and opens the folder it creates", async () => {
    const el = await mount();
    await waitFor(el, () => folderButton(el, "PONEY") !== undefined);

    const input = root(el).querySelector<HTMLInputElement>(".create input")!;
    expect(input.value).toBe("ladympala");
    root(el).querySelector<HTMLButtonElement>(".create button")!.click();

    await waitFor(el, () =>
      root(el)
        .querySelector(".crumb[aria-current=page]")!
        .textContent!.includes("ladympala"),
    );
    expect(useButton(el).disabled).toBe(false);
  });
});
