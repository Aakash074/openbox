import type { Hex } from "viem";

/** Parcel QR payload: everything the doorbell needs to check the label offline before calling home. */
export type ParcelQr = {
  v: 1;
  ref: string; // human order reference
  orderId: Hex;
  serialHash: Hex;
  courierHash: Hex;
  labelNonce: string;
  sig: Hex; // seller EIP-712 Label signature
  api: string; // OpenBox API base the kiosk should call
};

const b64url = {
  enc: (s: string) =>
    btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

export function encodeParcelQr(p: ParcelQr): string {
  return `openbox:${b64url.enc(JSON.stringify(p))}`;
}

export function decodeParcelQr(text: string): ParcelQr | null {
  if (!text.startsWith("openbox:")) return null;
  try {
    const p = JSON.parse(b64url.dec(text.slice(8)));
    return p?.v === 1 && p.orderId && p.sig ? (p as ParcelQr) : null;
  } catch {
    return null;
  }
}
