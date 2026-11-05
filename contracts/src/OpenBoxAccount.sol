// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @title OpenBoxAccount
/// @notice Minimal smart account for the gasless fallback when the token supports neither EIP-2612 nor
///         EIP-3009. The owner only signs an EIP-712 `Execute` message; the merchant relayer submits it
///         and pays gas. No bundler or EntryPoint needed.
contract OpenBoxAccount is EIP712, IERC1271 {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    bytes32 public constant CALL_TYPEHASH = keccak256("Call(address target,uint256 value,bytes data)");
    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(Call[] calls,uint256 nonce,uint256 deadline)Call(address target,uint256 value,bytes data)");

    address public immutable owner;
    uint256 public nonce;

    event Executed(uint256 indexed nonce, uint256 calls);

    error Expired();
    error BadSignature();
    error CallFailed(uint256 index, bytes reason);

    constructor(address owner_) EIP712("OpenBoxAccount", "1") {
        owner = owner_;
    }

    receive() external payable {}

    function execute(Call[] calldata calls, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert Expired();
        uint256 n = nonce++;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(EXECUTE_TYPEHASH, hashCalls(calls), n, deadline)));
        if (ECDSA.recover(digest, sig) != owner) revert BadSignature();
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }
        emit Executed(n, calls.length);
    }

    function hashCalls(Call[] calldata calls) public pure returns (bytes32) {
        bytes32[] memory hs = new bytes32[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            hs[i] = keccak256(abi.encode(CALL_TYPEHASH, calls[i].target, calls[i].value, keccak256(calls[i].data)));
        }
        return keccak256(abi.encodePacked(hs));
    }

    /// ERC-1271 so the account can sign order intents / labels if ever needed.
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        return (err == ECDSA.RecoverError.NoError && rec == owner) ? IERC1271.isValidSignature.selector : bytes4(0);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}

/// @notice CREATE2 factory: the buyer's account address is known before it exists, so USDT can be sent
///         to it first; the relayer deploys it on first use.
contract OpenBoxAccountFactory {
    event AccountCreated(address indexed owner, address account);

    function accountAddress(address owner) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                bytes32(uint256(uint160(owner))),
                keccak256(abi.encodePacked(type(OpenBoxAccount).creationCode, abi.encode(owner)))
            )
        );
        return address(uint160(uint256(h)));
    }

    function createAccount(address owner) external returns (address account) {
        account = accountAddress(owner);
        if (account.code.length > 0) return account;
        account = address(new OpenBoxAccount{salt: bytes32(uint256(uint160(owner)))}(owner));
        emit AccountCreated(owner, account);
    }
}
