/**
 * Web Push over WebCrypto alone: the payload encryption of RFC 8291
 * (`aes128gcm`, RFC 8188) and the VAPID signature of RFC 8292.
 *
 * Written out rather than taken from a package because every Web Push library
 * on npm is built on Node's `crypto`, and the Workers runtime has WebCrypto.
 * `web-push.test.ts` holds it to the RFC 8291 worked example byte for byte.
 */

const encoder = new TextEncoder();

/** UTF-8, copied onto a plain `ArrayBuffer` as WebCrypto's types want. */
const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(encoder.encode(text));

export const toBase64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const fromBase64url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hkdf = async (
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
};

/** The browser's half of a subscription, as `PushSubscription.toJSON()` gives it. */
export type SubscriptionKeys = { p256dh: string; auth: string };

/**
 * Fixed inputs for the RFC's worked example. In production both are fresh
 * for every message, and that is what leaving this out gives.
 */
export type EncryptionSeed = {
  serverKeys: CryptoKeyPair;
  salt: Uint8Array<ArrayBuffer>;
};

/** A single-record `aes128gcm` body, the only shape Web Push uses. */
export const encryptPayload = async (
  plaintext: Uint8Array,
  keys: SubscriptionKeys,
  seed?: EncryptionSeed,
): Promise<Uint8Array<ArrayBuffer>> => {
  const uaPublic = fromBase64url(keys.p256dh);
  const authSecret = fromBase64url(keys.auth);

  const serverKeys =
    seed?.serverKeys ??
    ((await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair);
  const salt = seed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer,
  );

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // Not an inline literal: the Workers types spell the member `$public`, an
  // artefact of their C++ binding, while the runtime reads the standard
  // `public`. A variable skips the excess-property check that would flag it.
  const ecdh = { name: "ECDH", public: uaKey };
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdh, serverKeys.privateKey, 256),
  );

  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  // 0x02: the padding delimiter that marks the last (here, only) record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  // Header: salt, record size (4096, big-endian), key id length, key id.
  const header = concat(
    salt,
    new Uint8Array([0, 0, 0x10, 0]),
    new Uint8Array([asPublic.length]),
    asPublic,
  );
  return concat(header, ciphertext);
};

/**
 * The `Authorization` header that identifies this server to the push
 * service. `privateJwk` is the `VAPID_PRIVATE_KEY` secret; its public half is
 * the `k=` the service checks the signature against, and the key the app
 * subscribed with.
 */
export const vapidAuthorization = async (
  endpoint: string,
  subject: string,
  privateJwk: JsonWebKey,
  now: number,
): Promise<string> => {
  const encode = (value: object) => toBase64url(utf8(JSON.stringify(value)));

  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    // Twelve hours: services refuse anything valid for more than a day.
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto signs in the raw r‖s form, which is exactly what ES256 wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      utf8(unsigned),
    ),
  );
  const publicKey = concat(
    new Uint8Array([4]),
    fromBase64url(privateJwk.x ?? ""),
    fromBase64url(privateJwk.y ?? ""),
  );

  return `vapid t=${unsigned}.${toBase64url(signature)}, k=${toBase64url(publicKey)}`;
};

export type PushTarget = { endpoint: string; keys: SubscriptionKeys };

export type VapidConfig = { subject: string; privateJwk: JsonWebKey };

/**
 * Sends one message and hands back the push service's answer: 201 is
 * delivered, 404/410 a subscription that no longer exists.
 */
export const sendPush = async (
  target: PushTarget,
  payload: unknown,
  vapid: VapidConfig,
  now: number,
): Promise<Response> =>
  fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(
        target.endpoint,
        vapid.subject,
        vapid.privateJwk,
        now,
      ),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // A reminder an hour late is no longer worth showing.
      TTL: "3600",
      // Wakes a phone that is saving battery; a reminder is time-sensitive.
      Urgency: "high",
    },
    body: await encryptPayload(utf8(JSON.stringify(payload)), target.keys),
  });
