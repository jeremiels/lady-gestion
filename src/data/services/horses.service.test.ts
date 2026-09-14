import { beforeEach, describe, expect, it } from "vitest";
import { HORSE_ID, makeHorse, resetDb } from "../__tests__/factories.ts";
import { db } from "../db.ts";
import * as horsesRepo from "../repositories/horses.repo.ts";
import type { Horse } from "../types.ts";
import { HORSE_FIELDS, saveHorseProfile } from "./horses.service.ts";

const STAMP = "2026-01-01T00:00:00.000Z";

/** The card as submitted, prefilled from `horse` the way the markup is. */
const submitted = (
  horse: Horse,
  over: Partial<Record<string, string>> = {},
) => {
  const form = new FormData();
  for (const name of Object.values(HORSE_FIELDS)) {
    form.set(name, over[name] ?? String(horse[name] ?? ""));
  }
  return form;
};

let horse: Horse;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse({ breed: "Selle Français" }));
  horse = (await horsesRepo.get(HORSE_ID))!;
});

describe("saveHorseProfile", () => {
  it("writes the fields that changed", async () => {
    const result = await saveHorseProfile(
      horse,
      submitted(horse, {
        sex: "hongre",
        birthDate: "2020-03-12",
        coat: " Bai cerise ",
        damName: "Vaza de Roc O Cerf",
      }),
    );

    expect(result).toEqual({ ok: true, saved: true });
    expect(await horsesRepo.get(HORSE_ID)).toMatchObject({
      sex: "hongre",
      birthDate: "2020-03-12",
      coat: "Bai cerise",
      damName: "Vaza de Roc O Cerf",
      breed: "Selle Français",
    });
  });

  it("clears a field to null, never to an empty string", async () => {
    await saveHorseProfile(horse, submitted(horse, { breed: "" }));

    expect((await horsesRepo.get(HORSE_ID))?.breed).toBeNull();
  });

  it("writes nothing for an unchanged card, so the seed purge still knows the horse", async () => {
    const result = await saveHorseProfile(horse, submitted(horse));

    expect(result).toEqual({ ok: true, saved: false });
    expect((await horsesRepo.get(HORSE_ID))?.updatedAt).toBe(STAMP);
  });

  it("rejects a birth date in the future and an unknown sex, writing nothing", async () => {
    const result = await saveHorseProfile(
      horse,
      submitted(horse, { birthDate: "2999-01-01", coat: "Alezan" }),
    );
    expect(result.ok === false && result.errors.birthDate).toBeTruthy();

    const sex = await saveHorseProfile(
      horse,
      submitted(horse, { sex: "poney" }),
    );
    expect(sex.ok === false && sex.errors.sex).toBeTruthy();

    expect((await horsesRepo.get(HORSE_ID))?.updatedAt).toBe(STAMP);
  });
});
