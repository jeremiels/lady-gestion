import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decrypt,
  deriveKeys,
  emailOfIdToken,
  encrypt,
  isClaimHash,
  packState,
  pkceChallenge,
  pkceVerifier,
  sha256Hex,
  unpackState,
} from "./drive-crypto.ts";
import { toBase64url } from "./web-push.ts";

const NOW = Date.UTC(2026, 8, 28, 12);
const state = {
  claimHash: "a".repeat(64),
  nonce: "n0nce",
  expiresAt: NOW + 1000,
};

test("a refresh token comes back out as it went in", async () => {
  const keys = await deriveKeys("secret");
  const sealed = await encrypt(keys, "1//refresh-token");

  assert.notEqual(sealed, "1//refresh-token");
  assert.equal(await decrypt(keys, sealed), "1//refresh-token");
});

test("a token sealed under another secret does not open", async () => {
  const sealed = await encrypt(await deriveKeys("secret"), "1//refresh-token");

  await assert.rejects(decrypt(await deriveKeys("other"), sealed));
});

test("seals the same token differently each time", async () => {
  const keys = await deriveKeys("secret");

  assert.notEqual(await encrypt(keys, "t"), await encrypt(keys, "t"));
});

test("reads back a state it signed", async () => {
  const keys = await deriveKeys("secret");

  assert.deepEqual(
    await unpackState(keys, await packState(keys, state), NOW),
    state,
  );
});

test("refuses a state signed by another secret, tampered with, or expired", async () => {
  const keys = await deriveKeys("secret");
  const packed = await packState(keys, state);
  const [, mac] = packed.split(".");
  const forged = `${toBase64url(new TextEncoder().encode(JSON.stringify({ ...state, claimHash: "b".repeat(64) })))}.${mac}`;

  assert.equal(await unpackState(await deriveKeys("other"), packed, NOW), null);
  assert.equal(await unpackState(keys, forged, NOW), null);
  assert.equal(await unpackState(keys, packed, state.expiresAt), null);
  assert.equal(await unpackState(keys, "garbage", NOW), null);
});

test("recomputes the same PKCE verifier from the nonce, and its S256 challenge", async () => {
  const keys = await deriveKeys("secret");
  const verifier = await pkceVerifier(keys, "n0nce");

  assert.equal(await pkceVerifier(keys, "n0nce"), verifier);
  assert.notEqual(await pkceVerifier(keys, "other"), verifier);
  // RFC 7636 appendix B.
  assert.equal(
    await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("accepts only a hex SHA-256 as a claim hash", async () => {
  assert.equal(isClaimHash(await sha256Hex("claim")), true);
  assert.equal(isClaimHash("A".repeat(64)), false);
  assert.equal(isClaimHash("a".repeat(63)), false);
});

test("reads the email out of an ID token, and nothing out of a bad one", () => {
  const payload = toBase64url(
    new TextEncoder().encode(JSON.stringify({ email: "lea@example.com" })),
  );

  assert.equal(emailOfIdToken(`h.${payload}.s`), "lea@example.com");
  assert.equal(emailOfIdToken("not-a-token"), null);
  assert.equal(
    emailOfIdToken(`h.${toBase64url(new TextEncoder().encode("{}"))}.s`),
    null,
  );
});
