export const SpawnFactoryABI = [
  {
    type: "function",
    name: "childImplementation",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lineageRegistry",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ERC8004_REGISTRY",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "spawnChild",
    inputs: [
      { name: "lineageKey", type: "string" },
      { name: "generation", type: "uint256" },
      { name: "childWallet", type: "address" },
    ],
    outputs: [
      { name: "child", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ChildSpawned",
    inputs: [
      { indexed: true, name: "child", type: "address" },
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "lineageKey", type: "string" },
      { indexed: false, name: "generation", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const;

export const ChildAgentABI = [
  {
    type: "function",
    name: "parent",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "wallet",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "active",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "spawnTimestamp",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "_parent", type: "address" },
      { name: "_wallet", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recallChild",
    inputs: [
      { name: "reason", type: "string" },
      { name: "ipfsCid", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordDecisionHash",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "actionType", type: "string" },
      { name: "amountBps", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "RecallChild",
    inputs: [
      { indexed: true, name: "child", type: "address" },
      { indexed: false, name: "reason", type: "string" },
      { indexed: false, name: "ipfsCid", type: "string" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "AgentDecisionExecuted",
    inputs: [
      { indexed: true, name: "decisionHash", type: "bytes32" },
      { indexed: false, name: "actionType", type: "string" },
      { indexed: false, name: "amountBps", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const;

export const LineageRegistryABI = [
  {
    type: "function",
    name: "pushCID",
    inputs: [
      { name: "lineageKey", type: "string" },
      { name: "cid", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "postGenerationResult",
    inputs: [
      { name: "lineageKey", type: "string" },
      { name: "veniceGeneratedSummary", type: "string" },
      { name: "avgYieldBps", type: "uint256" },
      { name: "agentsTerminated", type: "uint256" },
      { name: "generationNumber", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getLineage",
    inputs: [{ name: "lineageKey", type: "string" }],
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLatestCID",
    inputs: [{ name: "lineageKey", type: "string" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getGenerationCount",
    inputs: [{ name: "lineageKey", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "generation",
    inputs: [{ name: "", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "LineageUpdated",
    inputs: [
      { indexed: true, name: "lineageKey", type: "string" },
      { indexed: false, name: "cid", type: "string" },
      { indexed: false, name: "generation", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "GenerationResult",
    inputs: [
      { indexed: true, name: "lineageKey", type: "string" },
      { indexed: false, name: "summary", type: "string" },
      { indexed: false, name: "avgYieldBps", type: "uint256" },
      { indexed: false, name: "agentsTerminated", type: "uint256" },
      { indexed: false, name: "generation", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const;

// Legacy compatibility exports. The Mantle runtime no longer uses these.
export const MockGovernorABI = [] as const;
export const ParentTreasuryABI = [] as const;
export const ChildGovernorABI = [] as const;
