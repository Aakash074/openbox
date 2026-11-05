import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Embedded buyer key. No browser-extension wallet, no seed phrase, no gas.
 *  - "passkey": a platform passkey with the WebAuthn PRF extension deterministically derives the key, so the same
 *    fingerprint / Face ID recovers the same account on this device. Falls back to "local" when PRF is unsupported.
 *  - "local": a random key kept in this browser's storage (demo / kiosk use).
 * The key only ever signs EIP-712 messages (order intent + USDT permit); the merchant relayer submits and pays gas.
 */
export type WalletMode = "passkey" | "local";
const LS_KEY = "openbox.wallet.v1";
const LS_CRED = "openbox.passkey.v1";
const SALT = new TextEncoder().encode("openbox-checkout/embedded-key/v1");

function b64u(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function passkeyKey(appName: string): Promise<Hex | null> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return null;
  const prfInput = { eval: { first: SALT } };
  const credId = localStorage.getItem(LS_CRED);
  try {
    if (!credId) {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: appName, id: location.hostname },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "buyer", displayName: "OpenBox buyer" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          extensions: { prf: prfInput } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
      if (!cred) return null;
      localStorage.setItem(LS_CRED, b64u(cred.rawId));
      const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
      if (ext.prf?.results?.first) return keccak256(toHex(new Uint8Array(ext.prf.results.first)));
      if (!ext.prf?.enabled) return null;
    }
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: localStorage.getItem(LS_CRED) ? [{ type: "public-key", id: unb64u(localStorage.getItem(LS_CRED)!) }] : [],
        userVerification: "required",
        extensions: { prf: prfInput } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const ext = assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined;
    const first = ext?.prf?.results?.first;
    return first ? keccak256(toHex(new Uint8Array(first))) : null;
  } catch {
    return null;
  }
}

function localKey(): Hex {
  let k = localStorage.getItem(LS_KEY) as Hex | null;
  if (!k) {
    k = generatePrivateKey();
    localStorage.setItem(LS_KEY, k);
  }
  return k;
}

let cached: { account: PrivateKeyAccount; mode: WalletMode } | undefined;

export async function embeddedWallet(mode: WalletMode = "local", appName = "OpenBox Checkout") {
  if (cached) return cached;
  if (mode === "passkey") {
    const k = await passkeyKey(appName);
    if (k) return (cached = { account: privateKeyToAccount(k), mode: "passkey" });
  }
  return (cached = { account: privateKeyToAccount(localKey()), mode: "local" });
}

export function resetWallet() {
  cached = undefined;
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_CRED);
}
