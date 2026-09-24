import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encryptPayload,
  fromBase64url,
  toBase64url,
  vapidAuthorization,
} from "./web-push.ts";

/** RFC 8291, Section 5 / Appendix A — every value below is quoted from it. */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** The RFC gives the raw point; WebCrypto imports a private key as a JWK. */
const serverKeys = async (): Promise<CryptoKeyPair> => {
  const point = fromBase64url(RFC.asPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: RFC.asPrivate,
    x: toBase64url(point.slice(1, 33)),
    y: toBase64url(point.slice(33, 65)),
  };
  const algorithm = { name: "ECDH", namedCurve: "P-256" };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, algorithm, true, [
      "deriveBits",
    ]),
    publicKey: await crypto.subtle.importKey("raw", point, algorithm, true, []),
  };
};

test("encrypts the RFC 8291 example to the RFC's exact bytes", async () => {
  const body = await encryptPayload(
    new TextEncoder().encode(RFC.plaintext),
    { p256dh: RFC.uaPublic, auth: RFC.authSecret },
    { serverKeys: await serverKeys(), salt: fromBase64url(RFC.salt) },
  );

  assert.equal(toBase64url(body), RFC.body);
});

test("signs a VAPID token the public key it announces verifies", async () => {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const now = Date.UTC(2026, 8, 24, 12);

  const header = await vapidAuthorization(
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://example.test/",
    jwk,
    now,
  );

  const [, token, key] = /^vapid t=(\S+), k=(\S+)$/.exec(header) ?? [];
  const [head, claims, signature] = token!.split(".");
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(fromBase64url(claims!))),
    {
      aud: "https://web.push.apple.com",
      exp: now / 1000 + 12 * 60 * 60,
      sub: "https://example.test/",
    },
  );

  const announced = await crypto.subtle.importKey(
    "raw",
    fromBase64url(key!),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assert.ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      announced,
      fromBase64url(signature!),
      new TextEncoder().encode(`${head}.${claims}`),
    ),
  );
});
