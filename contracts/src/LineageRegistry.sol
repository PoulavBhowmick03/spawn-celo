// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LineageRegistry {
    mapping(string => string[]) private lineageCIDs;
    mapping(string => uint256) public generation;

    event LineageUpdated(string indexed lineageKey, string cid, uint256 generation, uint256 timestamp);
    event GenerationResult(
        string indexed lineageKey,
        string summary,
        uint256 avgYieldBps,
        uint256 agentsTerminated,
        uint256 generation,
        uint256 timestamp
    );

    function pushCID(string calldata lineageKey, string calldata cid) external {
        lineageCIDs[lineageKey].push(cid);
        generation[lineageKey]++;
        emit LineageUpdated(lineageKey, cid, generation[lineageKey], block.timestamp);
    }

    function postGenerationResult(
        string calldata lineageKey,
        string calldata veniceGeneratedSummary,
        uint256 avgYieldBps,
        uint256 agentsTerminated,
        uint256 generationNumber
    ) external {
        emit GenerationResult(
            lineageKey, veniceGeneratedSummary, avgYieldBps, agentsTerminated, generationNumber, block.timestamp
        );
    }

    function getLineage(string calldata lineageKey) external view returns (string[] memory) {
        return lineageCIDs[lineageKey];
    }

    function getLatestCID(string calldata lineageKey) external view returns (string memory) {
        string[] storage cids = lineageCIDs[lineageKey];
        require(cids.length > 0, "No lineage");
        return cids[cids.length - 1];
    }

    function getGenerationCount(string calldata lineageKey) external view returns (uint256) {
        return lineageCIDs[lineageKey].length;
    }
}
