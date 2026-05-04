// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILegacySpawnFactory {
    function setParentAgent(address _agent) external;
}

/// @title ParentTreasury — Owner deposits funds, sets governance values, registers parent agent
contract ParentTreasury {
    address public owner;
    address public parentAgent;
    address public spawnFactory;
    string public governanceValues;
    uint256 public maxChildren;
    uint256 public maxBudgetPerChild;
    bool public emergencyPause;

    event Deposited(address indexed from, uint256 amount);
    event ValuesUpdated(string values);
    event AgentRegistered(address agent);
    event FactorySet(address factory);
    event EmergencyPauseToggled(bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier notPaused() {
        require(!emergencyPause, "paused");
        _;
    }

    constructor(uint256 _maxChildren, uint256 _maxBudgetPerChild) {
        owner = msg.sender;
        maxChildren = _maxChildren == 0 ? 10 : _maxChildren;
        maxBudgetPerChild = _maxBudgetPerChild == 0 ? 1 ether : _maxBudgetPerChild;
    }

    function setSpawnFactory(address _factory) external onlyOwner {
        spawnFactory = _factory;
        emit FactorySet(_factory);
    }

    function setParentAgent(address _agent) external onlyOwner {
        parentAgent = _agent;
        // Also register on factory
        if (spawnFactory != address(0)) {
            ILegacySpawnFactory(spawnFactory).setParentAgent(_agent);
        }
        emit AgentRegistered(_agent);
    }

    function setGovernanceValues(string calldata _values) external onlyOwner {
        governanceValues = _values;
        emit ValuesUpdated(_values);
    }

    function getGovernanceValues() external view returns (string memory) {
        return governanceValues;
    }

    function setMaxChildren(uint256 _max) external onlyOwner {
        maxChildren = _max;
    }

    function setMaxBudgetPerChild(uint256 _max) external onlyOwner {
        maxBudgetPerChild = _max;
    }

    function toggleEmergencyPause() external onlyOwner {
        emergencyPause = !emergencyPause;
        emit EmergencyPauseToggled(emergencyPause);
    }

    function deposit() external payable {
        require(msg.value > 0, "must send ETH");
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Fund the spawn factory so it can budget children
    function fundFactory(uint256 amount) external onlyOwner notPaused {
        require(spawnFactory != address(0), "factory not set");
        require(address(this).balance >= amount, "insufficient balance");
        (bool ok,) = spawnFactory.call{value: amount}("");
        require(ok, "transfer failed");
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient balance");
        (bool ok,) = owner.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
