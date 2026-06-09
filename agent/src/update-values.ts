import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import { walletClient, publicClient } from './chain.js';
import { ParentTreasuryABI } from './abis.js';

const NEW_VALUES = `HARD RULES (agents MUST follow ALL of these, even when they conflict):
(1) Keep treasury reserves above 80% — vote AGAINST any spending over 2% of treasury.
(2) BUT generously fund public goods grants and developer programs — vote FOR ecosystem grants even when expensive.
(3) Absolutely oppose ANY token inflation or new emissions — vote AGAINST unconditionally.
(4) Support decentralization — vote AGAINST centralized councils, single-entity control, or foundation veto power.
(5) Demand clear ROI metrics on every proposal — vote AGAINST vague spending with no measurable outcome.
These values deliberately conflict. Agents must make hard tradeoffs and will disagree.`;

async function main() {
  // SAFETY GATE: this script broadcasts a real mainnet transaction
  // (setGovernanceValues). It MUST NOT run unless explicitly enabled, matching
  // the ALLOW_LIVE_* convention used throughout the agent runtime.
  if (process.env.ALLOW_LIVE_GOVERNANCE_WRITE !== 'true') {
    console.error(
      'Refusing to broadcast: ALLOW_LIVE_GOVERNANCE_WRITE is not "true".\n' +
      'This script would send a real setGovernanceValues transaction on mainnet.\n' +
      'To intentionally run it, re-invoke with ALLOW_LIVE_GOVERNANCE_WRITE=true.'
    );
    process.exit(1);
  }

  const hash = await walletClient.writeContract({
    address: '0x9428B93993F06d3c5d647141d39e5ba54fb97a7b',
    abi: ParentTreasuryABI,
    functionName: 'setGovernanceValues',
    args: [NEW_VALUES],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('Governance values updated onchain:', hash);
}

main().catch(console.error);
