import type { Address, Hex } from "viem";

export const openBoxDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "OpenBox", version: "1", chainId, verifyingContract }) as const;

export const accountDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "OpenBoxAccount", version: "1", chainId, verifyingContract }) as const;

export const orderTermsTypes = {
  OrderTerms: [
    { name: "orderId", type: "bytes32" },
    { name: "seller", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "courierFee", type: "uint256" },
    { name: "deliveryWindow", type: "uint64" },
    { name: "inspectionWindow", type: "uint64" },
    { name: "returnWindow", type: "uint64" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const orderIntentTypes = {
  OrderIntent: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "termsHash", type: "bytes32" },
  ],
} as const;

export const labelTypes = {
  Label: [
    { name: "orderId", type: "bytes32" },
    { name: "serialHash", type: "bytes32" },
    { name: "courierHash", type: "bytes32" },
    { name: "labelNonce", type: "uint256" },
  ],
} as const;

export const dispatchAttestationTypes = {
  DispatchAttestation: [
    { name: "orderId", type: "bytes32" },
    { name: "courierHash", type: "bytes32" },
    { name: "payout", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const courierAttestationTypes = {
  CourierAttestation: [
    { name: "orderId", type: "bytes32" },
    { name: "courierHash", type: "bytes32" },
    { name: "labelHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const lockPayoutTypes = {
  LockPayout: [
    { name: "orderId", type: "bytes32" },
    { name: "financier", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const verdictTypes = {
  Verdict: [
    { name: "orderId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "refundBps", type: "uint16" },
    { name: "serialReadHash", type: "bytes32" },
    { name: "frameHash", type: "bytes32" },
    { name: "hcsSeq", type: "uint64" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const returnVerdictTypes = {
  ReturnVerdict: [
    { name: "orderId", type: "bytes32" },
    { name: "returnedSerialHash", type: "bytes32" },
    { name: "frameHash", type: "bytes32" },
    { name: "hcsSeq", type: "uint64" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const executeTypes = {
  Execute: [
    { name: "calls", type: "Call[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Call: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

export type OrderTerms = {
  orderId: Hex;
  seller: Address;
  amount: bigint;
  courierFee: bigint;
  deliveryWindow: bigint;
  inspectionWindow: bigint;
  returnWindow: bigint;
  deadline: bigint;
};
export type Label = { orderId: Hex; serialHash: Hex; courierHash: Hex; labelNonce: bigint };
export type DispatchAttestation = { orderId: Hex; courierHash: Hex; payout: Address; deadline: bigint };
export type CourierAttestation = { orderId: Hex; courierHash: Hex; labelHash: Hex; deadline: bigint };
export type Verdict = {
  orderId: Hex;
  outcome: number;
  refundBps: number;
  serialReadHash: Hex;
  frameHash: Hex;
  hcsSeq: bigint;
  deadline: bigint;
};
export type ReturnVerdict = {
  orderId: Hex;
  returnedSerialHash: Hex;
  frameHash: Hex;
  hcsSeq: bigint;
  deadline: bigint;
};

// ---- typed data over JSON ----------------------------------------------------------------
type TypeFields = Record<string, { name: string; type: string }[]>;

/** Typed data as the backend sends it over JSON: uints as decimal strings, chainId possibly a string. */
export type JsonTypedData = {
  domain: Record<string, unknown> & { chainId?: number | string };
  types: TypeFields;
  primaryType: string;
  message: Record<string, unknown>;
};

function revive(types: TypeFields, primary: string, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of types[primary]) {
    const base = f.type.replace(/\[\]$/, "");
    const conv = (x: unknown): unknown =>
      types[base] ? revive(types, base, x as Record<string, unknown>) : /^u?int/.test(base) ? BigInt(x as string) : x;
    out[f.name] = f.type.endsWith("[]") ? (value[f.name] as unknown[]).map(conv) : conv(value[f.name]);
  }
  return out;
}

/** JSON typed data → the shape viem's signTypedData expects (bigint uints, numeric chainId, no EIP712Domain). */
export function signableTypedData(td: JsonTypedData) {
  const types = { ...td.types };
  delete types.EIP712Domain;
  return {
    domain: { ...td.domain, chainId: Number(td.domain.chainId) },
    types,
    primaryType: td.primaryType,
    message: revive(types, td.primaryType, td.message),
  };
}
