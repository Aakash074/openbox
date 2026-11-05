// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// LOCAL TESTING ONLY. Never deployed to Whitechain: the main flow there uses official USDT.
/// Supports EIP-2612 and EIP-3009 so every gasless path can be exercised; flags switch them off to
/// simulate a token without them.
contract MockUSDT is ERC20, ERC20Permit {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    bool public permitEnabled = true;
    bool public authEnabled = true;

    constructor() ERC20("Mock Tether USD", "USDT") ERC20Permit("Mock Tether USD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeatures(bool permit_, bool auth_) external {
        permitEnabled = permit_;
        authEnabled = auth_;
    }

    function permit(address o, address s, uint256 v, uint256 d, uint8 v_, bytes32 r, bytes32 s_) public override {
        require(permitEnabled, "permit disabled");
        super.permit(o, s, v, d, v_, r, s_);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(authEnabled, "3009 disabled");
        require(to == msg.sender, "caller must be payee");
        require(block.timestamp > validAfter && block.timestamp < validBefore, "auth time");
        require(!authorizationState[from][nonce], "auth used");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        );
        require(ECDSA.recover(digest, v, r, s) == from, "auth sig");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
