// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeliveryCheckout} from "../src/DeliveryCheckout.sol";
import {OpenBoxAccountFactory} from "../src/OpenBoxAccount.sol";
import {MockUSDT} from "../test/mocks/MockUSDT.sol";

/// Env:
///   DEPLOYER_PK      deployer / owner key
///   ATTESTER_ADDR    backend key that signs courier attestations
///   INSPECTOR_ADDRS  comma-separated inspection service keys that sign verdicts
///   USDT_ADDR        token (required on 1874: official USDT 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7)
/// On chain 31337 (Anvil) with no USDT_ADDR, a MockUSDT is deployed for local testing only.
contract Deploy is Script {
    address constant OFFICIAL_USDT_1874 = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(pk);
        address attester = vm.envAddress("ATTESTER_ADDR");
        address[] memory inspectors = vm.envAddress("INSPECTOR_ADDRS", ",");
        address token = vm.envOr("USDT_ADDR", address(0));

        if (block.chainid == 1874) {
            require(token == OFFICIAL_USDT_1874, "1874 must use official USDT");
        }

        vm.startBroadcast(pk);
        bool mock = false;
        if (token == address(0)) {
            require(block.chainid == 31337, "USDT_ADDR required off Anvil");
            token = address(new MockUSDT());
            mock = true;
        }
        DeliveryCheckout dc = new DeliveryCheckout(IERC20(token), owner, attester);
        for (uint256 i; i < inspectors.length; ++i) dc.setInspector(inspectors[i], true);
        OpenBoxAccountFactory factory = new OpenBoxAccountFactory();
        vm.stopBroadcast();

        string memory k = "deploy";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "token", token);
        vm.serializeBool(k, "mockToken", mock);
        vm.serializeAddress(k, "accountFactory", address(factory));
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "attester", attester);
        vm.serializeAddress(k, "inspectors", inspectors);
        vm.serializeUint(k, "deployBlock", block.number);
        string memory json = vm.serializeAddress(k, "deliveryCheckout", address(dc));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json"));
        console2.log("DeliveryCheckout", address(dc));
        console2.log("AccountFactory", address(factory));
        console2.log("Token", token);
    }
}
