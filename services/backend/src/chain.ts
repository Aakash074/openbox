import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor, deliveryCheckoutAbi, explorerToken, explorerTx, openBoxDomain, receivableNoteAbi, receivableNoteDomain } from "@openbox/shared";
import { cfg, loadDeployment } from "./config";

export const deployment = loadDeployment();
export const chain = chainFor(cfg.chainId, cfg.rpcUrl);
export const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl), cacheTime: 0, pollingInterval: 1000 });

export const accounts = {
  relayer: privateKeyToAccount(cfg.keys.relayer),
  attester: privateKeyToAccount(cfg.keys.attester),
  seller: privateKeyToAccount(cfg.keys.seller),
  treasury: cfg.keys.demoTreasury ? privateKeyToAccount(cfg.keys.demoTreasury) : undefined,
  lender: cfg.keys.demoLender ? privateKeyToAccount(cfg.keys.demoLender) : undefined,
};

export const wallet = (pk: keyof typeof accounts) => {
  const account = accounts[pk];
  if (!account) throw new Error(`No key configured for ${pk}`);
  return createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
};

export const checkout = { address: deployment.deliveryCheckout, abi: deliveryCheckoutAbi } as const;

/** EIP-712 domain of the deployed DeliveryCheckout (terms, labels, attestations). */
export const checkoutDomain = openBoxDomain(cfg.chainId, deployment.deliveryCheckout);

/** ReceivableNote (invoice advances); undefined when not deployed on this chain → feature off. */
export const note = deployment.receivableNote
  ? ({ address: deployment.receivableNote, abi: receivableNoteAbi } as const)
  : undefined;
export const noteDomain = deployment.receivableNote ? receivableNoteDomain(cfg.chainId, deployment.receivableNote) : undefined;
export const noteTokenUrl = (orderId: string) =>
  deployment.receivableNote ? explorerToken(cfg.chainId, deployment.receivableNote, BigInt(orderId), cfg.explorer) : undefined;

export const txUrl = (h: string) => explorerTx(cfg.chainId, h, cfg.explorer);

export async function readOrder(orderId: Hex) {
  return publicClient.readContract({ ...checkout, functionName: "getOrder", args: [orderId] });
}
