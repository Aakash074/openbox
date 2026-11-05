/**
 * Gate 1: does the official USDT on Whitechain Sepolia support EIP-2612 permit or EIP-3009? Who holds it?
 * Read-only. Usage: pnpm tsx scripts/hour1/usdt-capabilities.ts [address ...]
 * Prints the GASLESS_MODE to set in .env.
 */
import "dotenv/config";
import { createPublicClient, http, parseAbi, formatUnits, type Address } from "viem";
import { whitechainSepolia, OFFICIAL_USDT_1874 } from "@openbox/shared";

const rpc = process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io";
const c = createPublicClient({ chain: whitechainSepolia, transport: http(rpc) });
const t = OFFICIAL_USDT_1874;
const abi = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address) view returns (uint256)", "function PERMIT_TYPEHASH() view returns (bytes32)",
  "function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)", "function version() view returns (string)",
]);
const tryRead = async (fn: string, args: unknown[] = []) => {
  try { return await c.readContract({ address: t, abi, functionName: fn as any, args: args as any }); } catch { return undefined; }
};

const chainId = await c.getChainId();
console.log(`RPC ${rpc} · chainId ${chainId} · block ${await c.getBlockNumber()}`);
const code = await c.getCode({ address: t });
console.log(`USDT ${t} code: ${code && code !== "0x" ? `${(code.length - 2) / 2} bytes` : "NONE"}`);
const [name, symbol, decimals, version] = await Promise.all([tryRead("name"), tryRead("symbol"), tryRead("decimals"), tryRead("version")]);
console.log(`name=${name} symbol=${symbol} decimals=${decimals} version()=${version ?? "-"}`);
const zero = "0x0000000000000000000000000000000000000001" as Address;
const permit = {
  DOMAIN_SEPARATOR: await tryRead("DOMAIN_SEPARATOR"), nonces: await tryRead("nonces", [zero]),
  PERMIT_TYPEHASH: await tryRead("PERMIT_TYPEHASH"), eip712Domain: await tryRead("eip712Domain"),
};
const auth = {
  authorizationState: await tryRead("authorizationState", [zero, "0x" + "00".repeat(32)]),
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH: await tryRead("RECEIVE_WITH_AUTHORIZATION_TYPEHASH"),
};
console.log("EIP-2612:", permit);
console.log("EIP-3009:", auth);
const hasPermit = permit.DOMAIN_SEPARATOR !== undefined && permit.nonces !== undefined;
const has3009 = auth.authorizationState !== undefined;
for (const a of process.argv.slice(2) as Address[]) {
  const b = await tryRead("balanceOf", [a]);
  const g = await c.getBalance({ address: a });
  console.log(`  ${a}: ${b === undefined ? "?" : formatUnits(b as bigint, Number(decimals ?? 6))} USDT · ${formatUnits(g, 18)} WBT`);
}
const mode = has3009 ? "eip3009" : hasPermit ? "permit" : "account";
console.log(`\n=> GASLESS_MODE=${mode}${mode === "account" ? "  (no permit/3009: smart account + relayer; skip Scale track per plan)" : ""}`);
if (hasPermit && !permit.eip712Domain) console.log("   permit domain: no eip712Domain(); set USDT_PERMIT_VERSION if signatures fail (backend warns on mismatch)");
