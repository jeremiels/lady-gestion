import { describe, expect, it } from 'vitest';
import { dataReady, isDataReady, markDataReady } from './ready.ts';

/**
 * Deliberately does not import `__tests__/factories.ts`: `resetDb()` opens the
 * gate, which would make the closed-state assertions below depend on which file
 * Vitest happened to load first. Each test file gets its own module registry,
 * so this one observes the gate from its genuine starting state.
 */
describe('data ready gate', () => {
  it('starts closed', () => {
    expect(isDataReady()).toBe(false);
  });

  it('resolves every waiter once opened, including ones that arrived first', async () => {
    const waitedBefore = dataReady().then(() => 'before');

    markDataReady();

    const waitedAfter = dataReady().then(() => 'after');
    expect(isDataReady()).toBe(true);
    await expect(Promise.all([waitedBefore, waitedAfter])).resolves.toEqual(['before', 'after']);
  });

  it('is idempotent — a second open is a no-op, not a second resolution', async () => {
    markDataReady();
    markDataReady();

    expect(isDataReady()).toBe(true);
    await expect(dataReady()).resolves.toBeUndefined();
  });

  it('hands out the same promise every time, so waiting is free after the first run', () => {
    expect(dataReady()).toBe(dataReady());
  });
});
