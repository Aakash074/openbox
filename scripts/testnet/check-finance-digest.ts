/**
 * Read-only proof that the backend's invoice-advance signatures will be accepted on-chain.
 * Signs a FinanceOffer + LockPayout exactly as services/backend/src/finance.ts does (same shared typed-data
 * definitions), then compares against digests built from the deployed contracts via eth_call:
 *   FinanceOffer: ReceivableNote.hashFinanceOffer(orderId, advance, holdback, deadline)
 *   LockPayout:   "\x19\x01" ‖ DeliveryCheckout.domainSeparator() ‖ keccak(abi.encode(LOCK_PAYOUT_TYPEHASH, orderId, note, deadline))
 * and checks each signature recovers to the signer on the on-chain digest. Sends no transactions.
 *   tsx scripts/testnet/check-finance-digest.ts [chainId=1874]
 */
import { readFileSync } from "node:fs";
import {
  concat, createPublicClient, encodeAbiParameters, hashTypedData, http, keccak256, recoverAddress, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  chainFor, deliveryCheckoutAbi, financeOfferTypes, lockPayoutTypes, openBoxDomain, receivableNoteAbi, receivableNoteDomain,
} from "@openbox/shared";

const chainId = Number(process.argv[2] ?? 1874);
const dep = JSON.parse(readFileSync(new URL(`../../deployments/${chainId}.json`, import.meta.url), "utf8"));
if (!dep.receivableNote) throw new Error(`deployments/${chainId}.json has no receivableNote`);
const rpc = chainId === 1874 ? "https://rpc.testnet.whitechain.io" : "http://127.0.0.1:8545";
const client = createPublicClient({ chain: chainFor(chainId, rpc), transport: http(rpc) });
const noteAddr = dep.receivableNote as Address, dcAddr = dep.deliveryCheckout as Address;

const seller = privateKeyToAccount(generatePrivateKey());
const orderId = keccak256(new TextEncoder().encode(`digest-check-${Date.now()}`));
const advance = 5_510_000n, holdback = 580_000n, deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

const offerMsg = { orderId, advance, holdback, deadline };
const offerSig = await seller.signTypedData({ domain: receivableNoteDomain(chainId, noteAddr), types: financeOfferTypes, primaryType: "FinanceOffer", message: offerMsg });
const offerLocal = hashTypedData({ domain: receivableNoteDomain(chainId, noteAddr), types: financeOfferTypes, primaryType: "FinanceOffer", message: offerMsg });
const offerChain = await client.readContract({ address: noteAddr, abi: receivableNoteAbi, functionName: "hashFinanceOffer", args: [orderId, advance, holdback, deadline] });

const lockMsg = { orderId, financier: noteAddr, deadline };
const lockSig = await seller.signTypedData({ domain: openBoxDomain(chainId, dcAddr), types: lockPayoutTypes, primaryType: "LockPayout", message: lockMsg });
const lockLocal = hashTypedData({ domain: openBoxDomain(chainId, dcAddr), types: lockPayoutTypes, primaryType: "LockPayout", message: lockMsg });
const [sep, typehash] = await Promise.all([
  client.readContract({ address: dcAddr, abi: deliveryCheckoutAbi, functionName: "domainSeparator" }),
  client.readContract({ address: dcAddr, abi: deliveryCheckoutAbi, functionName: "LOCK_PAYOUT_TYPEHASH" }),
]);
const lockChain = keccak256(concat(["0x1901", sep as Hex, keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }], [typehash as Hex, orderId, noteAddr, deadline],
))]));

const ok = (b: boolean) => (b ? "OK  " : "FAIL");
const r1 = (await recoverAddress({ hash: offerChain, signature: offerSig })) === seller.address;
const r2 = (await recoverAddress({ hash: lockChain, signature: lockSig })) === seller.address;
console.log(`chain ${chainId} · note ${noteAddr} · checkout ${dcAddr}`);
console.log(`${ok(offerLocal === offerChain)} FinanceOffer digest  local ${offerLocal}\n                           chain ${offerChain}`);
console.log(`${ok(r1)} FinanceOffer signature recovers to signer on the on-chain digest`);
console.log(`${ok(lockLocal === lockChain)} LockPayout digest    local ${lockLocal}\n                           chain ${lockChain}`);
console.log(`${ok(r2)} LockPayout signature recovers to signer on the on-chain digest`);
if (!(offerLocal === offerChain && lockLocal === lockChain && r1 && r2)) process.exit(1);
