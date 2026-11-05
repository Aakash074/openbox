#!/usr/bin/env bash
# Gate 2: deploy + verify a trivial contract on Whitechain Sepolia to confirm the explorer verification path.
# Needs: DEPLOYER_PK (with WBT), WHITECHAIN_VERIFIER (blockscout|etherscan|custom), WHITECHAIN_VERIFIER_URL.
set -euo pipefail
cd "$(dirname "$0")/../../contracts"
set -a; source ../.env; set +a
RPC=${WHITECHAIN_RPC_URL:-https://rpc.testnet.whitechain.io}
mkdir -p /tmp/obx-hello && cat > src/Hello.sol <<'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Hello { string public hi = "OpenBox on Whitechain"; }
SOL
ADDR=$(forge create src/Hello.sol:Hello --rpc-url "$RPC" --private-key "$DEPLOYER_PK" --broadcast --json | jq -r .deployedTo)
echo "Hello deployed at $ADDR"
forge verify-contract --chain-id 1874 --verifier "${WHITECHAIN_VERIFIER:-blockscout}" --verifier-url "${WHITECHAIN_VERIFIER_URL:?}" --watch "$ADDR" src/Hello.sol:Hello
git rm -q --cached src/Hello.sol 2>/dev/null || true
echo "If verified: use the same verifier settings in contracts/script/verify.sh"
