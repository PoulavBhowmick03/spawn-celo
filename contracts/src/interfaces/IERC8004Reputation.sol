// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Canonical ERC-8004 Reputation Registry — 0x8004B663056A597Dffe9eCcC1965A193B7388713
interface IERC8004Reputation {
    function submitScore(address agent, uint256 score, string calldata note) external;
    function getScore(address agent) external view returns (uint256);
}
