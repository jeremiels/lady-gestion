import type { ReactiveController, ReactiveControllerHost } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import { resetDb } from "./__tests__/factories.ts";
import { LiveQuery, liveQueriesSettled } from "./live.ts";

/** A host with nothing of Lit about it but the controller hooks. */
const fakeHost = () => {
  const controllers: ReactiveController[] = [];
  const host: ReactiveControllerHost & {
    connect(): void;
    disconnect(): void;
  } = {
    addController: (controller) => void controllers.push(controller),
    removeController: () => {},
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
    connect: () => controllers.forEach((c) => c.hostConnected?.()),
    disconnect: () => controllers.forEach((c) => c.hostDisconnected?.()),
  };
  return host;
};

/** A query that never answers, like a read stuck behind a blocked database. */
const never = () => new Promise<never>(() => {});

beforeEach(resetDb);

describe("liveQueriesSettled", () => {
  it("answers false at once when no query is waiting", async () => {
    expect(await liveQueriesSettled(1000)).toBe(false);
  });

  it("waits for a connected query's first value", async () => {
    const host = fakeHost();
    const query = new LiveQuery(host, () => db.horses.toArray());
    host.connect();
    expect(query.loading).toBe(true);

    expect(await liveQueriesSettled(1000)).toBe(true);
    expect(query.loading).toBe(false);
    host.disconnect();
  });

  it("gives up at the timeout on a query that never answers", async () => {
    const host = fakeHost();
    const query = new LiveQuery(host, never);
    host.connect();

    expect(await liveQueriesSettled(20)).toBe(false);
    expect(query.loading).toBe(true);
    host.disconnect();
  });

  it("stops waiting for a query whose host went away", async () => {
    const host = fakeHost();
    const query = new LiveQuery(host, never);
    host.connect();
    host.disconnect();

    expect(await liveQueriesSettled(1000)).toBe(false);
    expect(query.loading).toBe(true);
  });

  it("does not count a refresh as waiting again", async () => {
    const host = fakeHost();
    const query = new LiveQuery(host, () => db.horses.toArray());
    host.connect();
    await liveQueriesSettled(1000);

    query.refresh();

    expect(await liveQueriesSettled(1000)).toBe(false);
    host.disconnect();
  });
});
