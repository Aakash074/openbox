import { defineChain } from "viem";

/** Whitechain Sepolia testnet (OP Stack L2, WBT gas). RPC/explorer overridable by env. */
export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WhiteBIT Token", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: {
    // Verified 2026-11-04 (Blockscout). Override with NEXT_PUBLIC_WHITECHAIN_EXPLORER / WHITECHAIN_EXPLORER.
    default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" },
  },
  testnet: true,
});

export const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

/** Official USDT on Whitechain Sepolia. The only token the main flow uses on 1874. */
export const OFFICIAL_USDT_1874 = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;
export const USDT_DECIMALS = 6;

export function chainFor(id: number, rpcUrl?: string) {
  const base = id === 1874 ? whitechainSepolia : anvil;
  return rpcUrl ? { ...base, rpcUrls: { default: { http: [rpcUrl] } } } : base;
}

export function explorerTx(chainId: number, hash: string, explorer?: string) {
  if (chainId !== 1874) return `local://tx/${hash}`;
  return `${(explorer ?? whitechainSepolia.blockExplorers.default.url).replace(/\/$/, "")}/tx/${hash}`;
}

/** Explorer page of one ERC-721 token (e.g. a receivable note). Local chains return a local:// placeholder. */
export function explorerToken(chainId: number, contract: string, tokenId: bigint | string, explorer?: string) {
  if (chainId !== 1874) return `local://token/${contract}/${tokenId}`;
  return `${(explorer ?? whitechainSepolia.blockExplorers.default.url).replace(/\/$/, "")}/token/${contract}/instance/${BigInt(tokenId).toString()}`;
}

export function explorerAddress(chainId: number, address: string, explorer?: string) {
  if (chainId !== 1874) return `local://address/${address}`;
  return `${(explorer ?? whitechainSepolia.blockExplorers.default.url).replace(/\/$/, "")}/address/${address}`;
}

export function hashscanTx(txId: string, network = "testnet") {
  return `https://hashscan.io/${network}/transaction/${encodeURIComponent(txId)}`;
}

export function hashscanTopic(topicId: string, network = "testnet") {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}

export function hashscanAccount(accountId: string, network = "testnet") {
  return `https://hashscan.io/${network}/account/${accountId}`;
}
