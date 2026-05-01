// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";

interface IERC8004Identity {
    function register(address agent) external returns (uint256 agentId);
}

interface IChildAgent {
    function initialize(address parent, address wallet) external;
}

contract SpawnFactory {
    address public immutable childImplementation;
    address public constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address public immutable lineageRegistry;
    address public owner;

    event ChildSpawned(
        address indexed child, uint256 indexed agentId, string lineageKey, uint256 generation, uint256 timestamp
    );

    constructor(address _childImpl, address _lineageRegistry) {
        childImplementation = _childImpl;
        lineageRegistry = _lineageRegistry;
        owner = msg.sender;
    }

    function spawnChild(string calldata lineageKey, uint256 generation, address childWallet)
        external
        returns (address child, uint256 agentId)
    {
        child = Clones.clone(childImplementation);
        IChildAgent(child).initialize(msg.sender, childWallet);

        try IERC8004Identity(ERC8004_REGISTRY).register(child) returns (uint256 registeredAgentId) {
            agentId = registeredAgentId;
        } catch {
            agentId = 0;
        }

        emit ChildSpawned(child, agentId, lineageKey, generation, block.timestamp);
    }
}
