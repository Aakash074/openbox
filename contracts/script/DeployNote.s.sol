// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeliveryCheckout} from "../src/DeliveryCheckout.sol";
import {ReceivableNote} from "../src/ReceivableNote.sol";

/// Adds invoice tokenization to an existing deployment: deploys ReceivableNote against the
/// DeliveryCheckout in deployments/<chainId>.json, allowlists it as a financier, allowlists LENDER_ADDR,
/// and rewrites the deployment file with the new addresses.
/// Env: DEPLOYER_PK (DeliveryCheckout owner), LENDER_ADDR
contract DeployNote is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(pk);
        address lender = vm.envAddress("LENDER_ADDR");
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        string memory j = vm.readFile(path);
        DeliveryCheckout dc = DeliveryCheckout(vm.parseJsonAddress(j, ".deliveryCheckout"));
        address token = vm.parseJsonAddress(j, ".token");
        require(address(dc.token()) == token && dc.owner() == owner, "deployment file / owner mismatch");

        vm.startBroadcast(pk);
        ReceivableNote note = new ReceivableNote(IERC20(token), dc, owner);
        dc.setFinancier(address(note), true);
        note.setLender(lender, true);
        vm.stopBroadcast();

        string memory k = "deploy";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "token", token);
        vm.serializeBool(k, "mockToken", vm.parseJsonBool(j, ".mockToken"));
        vm.serializeAddress(k, "accountFactory", vm.parseJsonAddress(j, ".accountFactory"));
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "attester", vm.parseJsonAddress(j, ".attester"));
        vm.serializeAddress(k, "inspectors", vm.parseJsonAddressArray(j, ".inspectors"));
        vm.serializeUint(k, "deployBlock", vm.parseJsonUint(j, ".deployBlock"));
        vm.serializeAddress(k, "receivableNote", address(note));
        vm.serializeUint(k, "receivableNoteBlock", block.number);
        vm.serializeAddress(k, "lender", lender);
        string memory json = vm.serializeAddress(k, "deliveryCheckout", address(dc));
        vm.writeJson(json, path);
        console2.log("ReceivableNote", address(note));
    }
}
