#!/usr/bin/env bash
# Swap a little testnet WBT for OFFICIAL test USDT (0xcedf…55a7) on the Whitechain Sepolia
# Uniswap v3 pool (SwapRouter02), and send it to the demo buyer treasury wallet.
# The faucet gives only WBT and USDT.mint is owner-only, so this is the way to get test USDT.
# Usage: bash scripts/testnet/get-usdt.sh [wbt_amount]   (default 0.3 ≈ 22 USDT)
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env.testnet; set +a

AMT=${1:-0.3}
ROUTER=0xe208cC685cD95D56E8ec6DEC9816476567fc6962   # SwapRouter02 (verified on explorer)
WWBT=0x4200000000000000000000000000000000000006     # wrapped WBT (OP Stack WETH9 predeploy)
USDT=0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7     # official test USDT
FEE=3000
FROM=$(cast wallet address "$DEPLOYER_PK")
TO=$(cast wallet address "$DEMO_TREASURY_PK")
WEI=$(cast to-wei "$AMT")
SIG='exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))(uint256)'

QUOTE=$(cast call $ROUTER "$SIG" "($WWBT,$USDT,$FEE,$TO,$WEI,0,0)" --value "$WEI" --from "$FROM" --rpc-url "$RPC_URL" | awk '{print $1}')
MIN=$((QUOTE * 97 / 100))
echo "Swapping $AMT WBT from $FROM"
echo "Expected ≈ $(echo "scale=2; $QUOTE/1000000" | bc) USDT → $TO (min $(echo "scale=2; $MIN/1000000" | bc))"
read -r -p "Proceed? [y/N] " ok; [ "$ok" = "y" ] || { echo "Cancelled."; exit 1; }

cast send $ROUTER 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))' \
  "($WWBT,$USDT,$FEE,$TO,$WEI,$MIN,0)" --value "$WEI" \
  --private-key "$DEPLOYER_PK" --rpc-url "$RPC_URL" --json \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('status',d['status'],'tx',d['transactionHash'])"

echo "USDT balance of $TO: $(cast call $USDT 'balanceOf(address)(uint256)' "$TO" --rpc-url "$RPC_URL" | awk '{printf "%.2f", $1/1e6}')"
