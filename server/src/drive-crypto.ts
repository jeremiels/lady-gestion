import { fromBase64url, toBase64url } from "./web-push.ts";

/**
 * The cryptography behind the Drive sign-in, kept apart from D1 and `fetch`
 * so Node's own test runner can check it.
 *
 * Every key comes from one secret, `DRIVE_SECRET`, through HKDF: one value to
 * set and rotate, and still a separate key per purpose.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const sha256Hex = async (text: string): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** 32 random bytes, base64url: session tokens and state nonces. */
export const randomToken = (): string =>
  toBase64url(crypto.getRandomValues(new Uint8Array(32)));

export type DriveKeys = { aes: CryptoKey; hmac: CryptoKey };

export const deriveKeys = async (secret: string): Promise<DriveKeys> => {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const derive = (
    info: string,
    algorithm: Parameters<SubtleCrypto["deriveKey"]>[2],
    usages: string[],
  ) =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: encoder.encode(info),
      },
      base,
      algorithm,
      false,
      usages,
    );
  return {
    aes: await derive(
      "lady-gestion drive aes",
      { name: "AES-GCM", length: 256 },
      ["encrypt", "decrypt"],
    ),
    hmac: await derive(
      "lady-gestion drive hmac",
      { name: "HMAC", hash: "SHA-256" },
      ["sign", "verify"],
    ),
  };
};

/** AES-GCM, as `iv.ciphertext` in base64url. For refresh tokens at rest. */
export const encrypt = async (
  keys: DriveKeys,
  plain: string,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    keys.aes,
    encoder.encode(plain),
  );
  return `${toBase64url(iv)}.${toBase64url(new Uint8Array(sealed))}`;
};

/** Throws if the value was not sealed by `encrypt` with these keys. */
export const decrypt = async (
  keys: DriveKeys,
  sealed: string,
): Promise<string> => {
  const [iv = "", data = ""] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv) },
    keys.aes,
    fromBase64url(data),
  );
  return decoder.decode(plain);
};

const sign = async (keys: DriveKeys, text: string): Promise<string> =>
  toBase64url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", keys.hmac, encoder.encode(text)),
    ),
  );

/**
 * The PKCE verifier, derived from the state's nonce rather than stored: the
 * callback recomputes it, so nothing has to be kept between the two requests.
 */
export const pkceVerifier = (keys: DriveKeys, nonce: string): Promise<string> =>
  sign(keys, `pkce:${nonce}`);

export const pkceChallenge = async (verifier: string): Promise<string> =>
  toBase64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );

/**
 * What the OAuth `state` carries through Google and back: whose sign-in this
 * is (the hash of the app's claim secret), and the nonce behind the PKCE
 * verifier. Signed, so the callback trusts only a state this Worker wrote.
 */
export type AuthState = { claimHash: string; nonce: string; expiresAt: number };

export const packState = async (
  keys: DriveKeys,
  state: AuthState,
): Promise<string> => {
  const body = toBase64url(encoder.encode(JSON.stringify(state)));
  return `${body}.${await sign(keys, body)}`;
};

/**
 * `null` for a state this Worker did not sign, or one past its expiry. The
 * signature is checked by `verify`, in constant time: comparing strings
 * would tell a forger, by how long the refusal took, how much of it was right.
 */
export const unpackState = async (
  keys: DriveKeys,
  packed: string,
  now: number,
): Promise<AuthState | null> => {
  const [body = "", mac = ""] = packed.split(".");
  if (!body) return null;
  try {
    const signed = await crypto.subtle.verify(
      "HMAC",
      keys.hmac,
      fromBase64url(mac),
      encoder.encode(body),
    );
    if (!signed) return null;
  } catch {
    return null;
  }
  try {
    const state = JSON.parse(decoder.decode(fromBase64url(body))) as AuthState;
    return state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
};

/** The app's claim secret is 32 bytes; it sends only their SHA-256, in hex. */
export const isClaimHash = (value: string): boolean =>
  /^[0-9a-f]{64}$/.test(value);

/**
 * The `email` claim of an ID token received straight from Google's token
 * endpoint over TLS — which is why its signature is not checked here.
 */
export const emailOfIdToken = (idToken: string): string | null => {
  try {
    const payload = JSON.parse(
      decoder.decode(fromBase64url(idToken.split(".")[1] ?? "")),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
};
