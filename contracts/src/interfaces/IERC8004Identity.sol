// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ABI source: https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
// Canonical Celo mainnet ERC-8004 Identity Registry (indexed by 8004scan) — DO NOT deploy your own
interface IERC8004Identity {
    function register(address agent) external returns (uint256 agentId);
    function isRegistered(address agent) external view returns (bool);
    function getAgentId(address agent) external view returns (uint256);
}
