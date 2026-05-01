// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ABI source: https://mantlescan.xyz/address/0x8004A818BFB912233c491871b3d84c89A494BD9e
// Canonical ERC-8004 Identity Registry — DO NOT deploy your own
interface IERC8004Identity {
    function register(address agent) external returns (uint256 agentId);
    function isRegistered(address agent) external view returns (bool);
    function getAgentId(address agent) external view returns (uint256);
}
