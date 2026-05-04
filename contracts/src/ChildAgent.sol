// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ChildAgent {
    address public parent;
    address public wallet;
    bool public active;
    uint256 public spawnTimestamp;

    event RecallChild(address indexed child, string reason, string ipfsCid, uint256 timestamp);

    modifier onlyParent() {
        require(msg.sender == parent, "Only parent");
        _;
    }

    function initialize(address _parent, address _wallet) external {
        require(parent == address(0), "Already initialized");
        require(_parent != address(0), "ChildAgent: zero parent");
        require(_wallet != address(0), "ChildAgent: zero wallet");
        parent = _parent;
        wallet = _wallet;
        active = true;
        spawnTimestamp = block.timestamp;
    }

    function recallChild(string calldata reason, string calldata ipfsCid) external onlyParent {
        active = false;
        emit RecallChild(address(this), reason, ipfsCid, block.timestamp);
    }
}
