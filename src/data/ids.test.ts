import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newId', () => {
  it('produces a v4 UUID', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });

  describe('without crypto.randomUUID (non-secure origin)', () => {
    const withoutRandomUUID = () => {
      // `randomUUID` is absent on http:// origins — a LAN address during dev.
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(
        undefined as unknown as ReturnType<Crypto['randomUUID']>,
      );
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    };

    it('falls back to getRandomValues and still sets version and variant', () => {
      const original = crypto.randomUUID;
      withoutRandomUUID();

      try {
        for (let i = 0; i < 200; i += 1) {
          const id = newId();
          expect(id).toMatch(UUID_V4);
          // Version nibble and variant nibble are what the regex above pins:
          // position 14 must be '4', position 19 one of 8/9/a/b.
          expect(id[14]).toBe('4');
          expect('89ab').toContain(id[19]);
        }
      } finally {
        Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
      }
    });
  });
});
