import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../__tests__/factories.ts";
import { db } from "../db.ts";
import * as profileRepo from "./profile.repo.ts";

const fields = {
  firstName: "Léa",
  lastName: "Garnier",
  email: "lea@example.com",
};

beforeEach(resetDb);

describe("get", () => {
  it("returns undefined before anything was saved", async () => {
    expect(await profileRepo.get()).toBeUndefined();
  });

  it("returns the most recently written live row", async () => {
    const older = await profileRepo.save(fields);
    await db.profiles.add({
      ...older,
      id: "from-a-restore",
      firstName: "Newer",
      updatedAt: "2999-01-01T00:00:00.000Z",
    });

    expect((await profileRepo.get())?.firstName).toBe("Newer");
  });

  it("ignores a tombstoned row", async () => {
    const saved = await profileRepo.save(fields);
    await db.profiles.put({ ...saved, deletedAt: saved.updatedAt });

    expect(await profileRepo.get()).toBeUndefined();
  });
});

describe("save", () => {
  it("creates the row on first save", async () => {
    await profileRepo.save(fields);

    expect(await profileRepo.get()).toMatchObject(fields);
    expect(await db.profiles.count()).toBe(1);
  });

  it("updates the same row afterwards", async () => {
    const created = await profileRepo.save(fields);
    await profileRepo.save({ ...fields, lastName: null });

    expect(await db.profiles.count()).toBe(1);
    expect(await profileRepo.get()).toMatchObject({
      id: created.id,
      lastName: null,
    });
  });

  it("writes nothing when the form is unchanged", async () => {
    const created = await profileRepo.save(fields);
    const again = await profileRepo.save({ ...fields });

    expect(again.updatedAt).toBe(created.updatedAt);
  });
});
