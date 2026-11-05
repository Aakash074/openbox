#!/usr/bin/env bash
# Verify deployed contracts on the Whitechain Sepolia explorer.
# WHITECHAIN_VERIFIER (blockscout|etherscan|custom) and WHITECHAIN_VERIFIER_URL are confirmed in hour-1 test 2.
set -euo pipefail
cd "$(dirname "$0")/.."
D=../deployments/1874.json
DC=$(jq -r .deliveryCheckout $D); F=$(jq -r .accountFactory $D)
TOKEN=$(jq -r .token $D); OWNER=$(jq -r .owner $D); ATT=$(jq -r .attester $D)
V=${WHITECHAIN_VERIFIER:-blockscout}; URL=${WHITECHAIN_VERIFIER_URL:?set WHITECHAIN_VERIFIER_URL}
KEY_ARGS=(); [ -n "${WHITECHAIN_EXPLORER_KEY:-}" ] && KEY_ARGS=(--etherscan-api-key "$WHITECHAIN_EXPLORER_KEY")
forge verify-contract --chain-id 1874 --verifier "$V" --verifier-url "$URL" ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} --watch \
  --constructor-args "$(cast abi-encode 'c(address,address,address)' "$TOKEN" "$OWNER" "$ATT")" \
  "$DC" src/DeliveryCheckout.sol:DeliveryCheckout
forge verify-contract --chain-id 1874 --verifier "$V" --verifier-url "$URL" ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} --watch \
  "$F" src/OpenBoxAccount.sol:OpenBoxAccountFactory
