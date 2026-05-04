// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockGovernor {
    enum ProposalState {
        Pending,
        Active,
        Defeated,
        Succeeded,
        Executed
    }

    struct ProposalInfo {
        uint256 id;
        string description;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
    }

    uint256 public votingPeriod;
    uint256 public proposalCount;

    mapping(uint256 => ProposalInfo) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed proposalId, string description, uint256 startTime, uint256 endTime);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, string reason);
    event ProposalExecuted(uint256 indexed proposalId);

    constructor(uint256 _votingPeriod) {
        votingPeriod = _votingPeriod == 0 ? 300 : _votingPeriod; // default 5 min
    }

    function createProposal(string calldata description) external returns (uint256 proposalId) {
        proposalId = ++proposalCount;
        uint256 start = block.timestamp;
        uint256 end = start + votingPeriod;

        proposals[proposalId] = ProposalInfo({
            id: proposalId,
            description: description,
            startTime: start,
            endTime: end,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            executed: false
        });

        emit ProposalCreated(proposalId, description, start, end);
    }

    function castVote(uint256 proposalId, uint8 support) external {
        ProposalInfo storage p = proposals[proposalId];
        require(p.id != 0, "proposal does not exist");
        require(block.timestamp >= p.startTime && block.timestamp < p.endTime, "voting not active");
        require(!hasVoted[proposalId][msg.sender], "already voted");
        require(support <= 2, "invalid support value");

        hasVoted[proposalId][msg.sender] = true;

        if (support == 0) p.againstVotes++;
        else if (support == 1) p.forVotes++;
        else p.abstainVotes++;

        emit VoteCast(proposalId, msg.sender, support, "");
    }

    function castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason) external {
        ProposalInfo storage p = proposals[proposalId];
        require(p.id != 0, "proposal does not exist");
        require(block.timestamp >= p.startTime && block.timestamp < p.endTime, "voting not active");
        require(!hasVoted[proposalId][msg.sender], "already voted");
        require(support <= 2, "invalid support value");

        hasVoted[proposalId][msg.sender] = true;

        if (support == 0) p.againstVotes++;
        else if (support == 1) p.forVotes++;
        else p.abstainVotes++;

        emit VoteCast(proposalId, msg.sender, support, reason);
    }

    function execute(uint256 proposalId) external {
        ProposalInfo storage p = proposals[proposalId];
        require(p.id != 0, "proposal does not exist");
        require(block.timestamp >= p.endTime, "voting not ended");
        require(!p.executed, "already executed");
        require(p.forVotes > p.againstVotes, "proposal defeated");

        p.executed = true;
        emit ProposalExecuted(proposalId);
    }

    function state(uint256 proposalId) external view returns (ProposalState) {
        ProposalInfo storage p = proposals[proposalId];
        require(p.id != 0, "proposal does not exist");

        if (p.executed) return ProposalState.Executed;
        if (block.timestamp < p.startTime) return ProposalState.Pending;
        if (block.timestamp < p.endTime) return ProposalState.Active;
        if (p.forVotes > p.againstVotes) return ProposalState.Succeeded;
        return ProposalState.Defeated;
    }

    function getProposal(uint256 proposalId) external view returns (ProposalInfo memory) {
        require(proposals[proposalId].id != 0, "proposal does not exist");
        return proposals[proposalId];
    }
}
