/**
 * The initial swarm roster: 9 agents = 3 variants each of the 3 strategies
 * (developer-raised from the 6-9 range in CLAUDE.md §3.2). HD index = agent
 * number (index 0 is the orchestrator). Params here are the genome the
 * Darwinian loop mutates from generation 1 onward.
 */

export type StrategyId = "MentoFXRotator" | "AaveYielder" | "HedgedCarry";

export type AgentSpec = {
  /** HD derivation index and stable agent number (1-based) */
  hdIndex: number;
  /** slug used in card filenames and activity logs */
  slug: string;
  name: string;
  strategy: StrategyId;
  /** strategy genome — mutated on spawn */
  params: Record<string, number | boolean>;
  description: string;
  /** Phase 6: pays for x402 market signals before evaluate() */
  useSignal: boolean;
};

export const SWARM_AGENTS: AgentSpec[] = [
  // --- MentoFXRotator: hold the strongest Mento stable vs cUSD; rotate only
  //     when expected edge > swap cost + threshold (CLAUDE.md §3.2.1)
  {
    hdIndex: 1,
    slug: "mfx-cautious",
    name: "Spawn FX Rotator (cautious)",
    strategy: "MentoFXRotator",
    params: { minEdgeBps: 30, maxPositionUsd: 5, lookbackHours: 12 },
    description:
      "Rotates between cUSD, cEUR and cREAL via the Mento broker, only when the expected FX edge exceeds swap cost + 0.30%. Slow hands, low churn.",
    useSignal: false,
  },
  {
    hdIndex: 2,
    slug: "mfx-balanced",
    name: "Spawn FX Rotator (balanced)",
    strategy: "MentoFXRotator",
    params: { minEdgeBps: 20, maxPositionUsd: 5, lookbackHours: 6 },
    description:
      "Rotates between cUSD, cEUR and cREAL via the Mento broker when the expected FX edge exceeds swap cost + 0.20%.",
    useSignal: false,
  },
  {
    hdIndex: 3,
    slug: "mfx-aggressive",
    name: "Spawn FX Rotator (aggressive)",
    strategy: "MentoFXRotator",
    params: { minEdgeBps: 12, maxPositionUsd: 5, lookbackHours: 3 },
    description:
      "Rotates between cUSD, cEUR and cREAL via the Mento broker on edges above swap cost + 0.12%. Fast hands, higher churn; buys x402 market signals.",
    useSignal: true,
  },

  // --- AaveYielder: supply stables to Aave v3 Celo, compound, rebalance
  //     between assets when the supply APY delta clears a threshold (§3.2.2)
  {
    hdIndex: 4,
    slug: "ay-anchor",
    name: "Spawn Aave Yielder (anchor)",
    strategy: "AaveYielder",
    params: { minApyDeltaBps: 50, reserveBps: 1000, compoundEveryEpochs: 2 },
    description:
      "Supplies cUSD/USDC/USDT to Aave v3 Celo and compounds. Rebalances between assets only when the supply APY gap exceeds 0.50%; keeps 10% dry powder.",
    useSignal: false,
  },
  {
    hdIndex: 5,
    slug: "ay-balanced",
    name: "Spawn Aave Yielder (balanced)",
    strategy: "AaveYielder",
    params: { minApyDeltaBps: 30, reserveBps: 500, compoundEveryEpochs: 1 },
    description:
      "Supplies cUSD/USDC/USDT to Aave v3 Celo, compounds every epoch, rebalances on APY gaps above 0.30%; 5% dry powder.",
    useSignal: false,
  },
  {
    hdIndex: 6,
    slug: "ay-chaser",
    name: "Spawn Aave Yielder (chaser)",
    strategy: "AaveYielder",
    params: { minApyDeltaBps: 15, reserveBps: 250, compoundEveryEpochs: 1 },
    description:
      "Chases the best Aave v3 Celo stable supply rate, rebalancing on APY gaps above 0.15%; 2.5% dry powder; buys x402 market signals.",
    useSignal: true,
  },

  // --- HedgedCarry: Aave yield base + a fraction in the strongest Mento FX
  //     leg — the hybrid that demos Darwinian crossover (§3.2.3)
  {
    hdIndex: 7,
    slug: "hc-light",
    name: "Spawn Hedged Carry (light hedge)",
    strategy: "HedgedCarry",
    params: { fxLegBps: 2500, minEdgeBps: 25, minApyDeltaBps: 40 },
    description:
      "Holds 75% in Aave v3 yield, 25% in the strongest Mento FX leg. The conservative end of the carry/FX crossover.",
    useSignal: false,
  },
  {
    hdIndex: 8,
    slug: "hc-mid",
    name: "Spawn Hedged Carry (mid hedge)",
    strategy: "HedgedCarry",
    params: { fxLegBps: 4000, minEdgeBps: 20, minApyDeltaBps: 30 },
    description:
      "Holds 60% in Aave v3 yield, 40% in the strongest Mento FX leg; buys x402 market signals.",
    useSignal: true,
  },
  {
    hdIndex: 9,
    slug: "hc-heavy",
    name: "Spawn Hedged Carry (heavy hedge)",
    strategy: "HedgedCarry",
    params: { fxLegBps: 6000, minEdgeBps: 15, minApyDeltaBps: 25 },
    description:
      "Holds 40% in Aave v3 yield, 60% in the strongest Mento FX leg. The FX-forward end of the crossover.",
    useSignal: false,
  },
];

export const ORCHESTRATOR_SPEC = {
  hdIndex: 0,
  slug: "orchestrator",
  name: "Spawn Hedge Swarm Orchestrator",
  description:
    "Orchestrator of the Spawn Hedge Swarm on Celo: runs the 4h epoch loop (evaluate → cull → spawn → rebalance), computes the published recomputable fitness function, posts performance-derived reputation feedback for every swarm agent, and operates the treasury and kill switch. Every onchain action carries a logged rationale.",
} as const;
