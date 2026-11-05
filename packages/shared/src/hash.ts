import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";

/** Serial numbers are compared after normalising: uppercase, alphanumerics only. */
export function normalizeSerial(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function serialHash(serial: string): Hex {
  return keccak256(stringToHex(normalizeSerial(serial)));
}

/** Courier identity = hash of (issuer, subject) from the World check: the IDKit session ID (or OIDC sub). */
export function courierHash(iss: string, sub: string): Hex {
  return keccak256(stringToHex(`${iss}|${sub}`));
}

/** Human order reference ("OB-1042") <-> bytes32 order id. */
export function orderIdFromRef(ref: string): Hex {
  return keccak256(stringToHex(`openbox:order:${ref}`));
}

export function authNonce(orderId: Hex, buyer: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [orderId, buyer]));
}

