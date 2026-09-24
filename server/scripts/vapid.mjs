// Generates the VAPID key pair once. The private key becomes the Worker's
// VAPID_PRIVATE_KEY secret; the public key goes in src/pwa/push-config.ts.
// Regenerating it invalidates every existing subscription.
const toBase64url = (bytes) => Buffer.from(bytes).toString("base64url");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));

console.log(
  "VAPID_PRIVATE_KEY (secret — npx wrangler secret put VAPID_PRIVATE_KEY):",
);
console.log(JSON.stringify(jwk));
console.log();
console.log("VAPID_PUBLIC_KEY (src/pwa/push-config.ts):");
console.log(toBase64url(raw));
