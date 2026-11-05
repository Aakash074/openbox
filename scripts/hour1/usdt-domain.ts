// Finds the EIP-712 domain (name, version) that reproduces the official USDT's DOMAIN_SEPARATOR on 1874.
import { hashDomain, type Address } from "viem";
import { OFFICIAL_USDT_1874 } from "@openbox/shared";
const target = (process.argv[2] ?? "").toLowerCase();
for (const name of ["Tether USD", "USDT", "Tether", "USD₮0", "TetherToken"]) for (const version of ["1", "2", "3", "0"]) {
  const h = hashDomain({ domain: { name, version, chainId: 1874, verifyingContract: OFFICIAL_USDT_1874 as Address }, types: { EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
  ] } });
  if (h.toLowerCase() === target) { console.log(`MATCH name="${name}" version="${version}"  => USDT_PERMIT_VERSION=${version}`); process.exit(0); }
}
console.log("no match among common candidates; ask Whitechain for the token domain");
