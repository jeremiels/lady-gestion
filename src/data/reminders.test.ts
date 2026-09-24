import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_CATEGORY_ROWS,
  makePost,
  resetDb,
} from "./__tests__/factories.ts";
import { addDays, todayISO } from "./dates.ts";
import { listReminders, remindersOf } from "./reminders.ts";
import * as categoriesRepo from "./repositories/categories.repo.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import * as postsRepo from "./repositories/posts.repo.ts";

const TYPES = BUILT_IN_CATEGORY_ROWS;
const NOW = new Date(2026, 5, 10, 12, 0).getTime();

/** A cure on 15 June at 08:30, reminded an hour before unless told otherwise. */
const cure = (over: Parameters<typeof makePost>[0] = {}) =>
  makePost({
    id: "cure-1",
    categoryKey: "cures",
    title: "Magnésium",
    date: "2026-06-15",
    time: "08:30",
    customFields: { reminder: "1h" },
    ...over,
  });

describe("remindersOf", () => {
  it("turns a ticked post into what the notification shows", () => {
    expect(remindersOf([cure()], TYPES, NOW)).toEqual([
      {
        postId: "cure-1",
        fireAt: new Date(2026, 5, 15, 7, 30).getTime(),
        title: "Magnésium",
        body: "Cures · 15 juin 2026 à 08h30",
      },
    ]);
  });

  it("orders them soonest first", () => {
    const later = cure({ id: "later", date: "2026-06-20" });
    const sooner = cure({ id: "sooner", date: "2026-06-12" });
    expect(
      remindersOf([later, sooner], TYPES, NOW).map((one) => one.postId),
    ).toEqual(["sooner", "later"]);
  });

  it("leaves out a post with no delay, no time, or a moment already past", () => {
    const posts = [
      cure({ id: "unticked", customFields: { reminder: null } }),
      cure({ id: "no-time", time: null }),
      cure({
        id: "past",
        date: "2026-06-10",
        time: "12:30",
        customFields: { reminder: "1h" },
      }),
    ];
    expect(remindersOf(posts, TYPES, NOW)).toEqual([]);
  });

  it("leaves out a cancelled post", () => {
    expect(remindersOf([cure({ status: "cancelled" })], TYPES, NOW)).toEqual(
      [],
    );
  });

  it("reads a delay only through a category that offers reminders", () => {
    const vet = cure({ categoryKey: "veto" });
    expect(remindersOf([vet], TYPES, NOW)).toEqual([]);
  });
});

describe("listReminders", () => {
  beforeEach(resetDb);

  const upcoming = () => cure({ date: addDays(todayISO(), 3), time: "08:30" });

  it("lists the reminders still to go out", async () => {
    await postsRepo.create(upcoming());
    expect(await listReminders()).toHaveLength(1);
  });

  it("is empty while the Profil switch is off", async () => {
    await postsRepo.create(upcoming());
    await metaRepo.setNotificationsEnabled(false);
    expect(await listReminders()).toEqual([]);
  });

  it("drops the posts of a category switched off", async () => {
    await postsRepo.create(upcoming());
    await categoriesRepo.setEnabled(
      TYPES.find((type) => type.key === "cures")!.id,
      false,
    );
    expect(await listReminders()).toEqual([]);
  });
});
