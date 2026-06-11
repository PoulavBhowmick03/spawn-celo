# Incident report: duplicate swarm orchestrator on Fly.io (2026-06-11)

**Status:** resolved (Fly machine stopped). This document is the public, onchain-verifiable accounting of every transaction the duplicate instance sent.

## What happened

Between 2026-06-11T07:55:46Z and ~08:31Z, a stopped-but-restarted Fly.io machine (app `spawn-celo-swarm`) ran a second copy of the swarm orchestrator in parallel with the canonical local instance. Both processes derive the same wallets from the same mnemonic, so the duplicate signed with the real treasury key (`0xC0296012Cfbb0e6DF5dA7158B65Dbc46DD9650e0`) and the real agent wallets. The Fly copy ran an **older code version** whose fitness formula did not subtract mid-epoch net funding flows (the bug already disclosed in the README "Correction note: epochs 3–4").

Consequences, all verified onchain below:

1. The Fly instance settled epoch 5 first (08:23:52–08:24:39Z), posting **9 reputation feedbacks with old-formula scores** to the canonical ERC-8004 Reputation Registry, executing the hc-mid cull (`recallChild` + Aave withdraw + sweep), and funding a spawn ("mfx-aggressive-g3-i14") it never completed.
2. The local instance settled epoch 5 at 08:29–08:35Z with the corrected formula, so **every active agent has two epoch-5 feedback entries onchain** — one wrong (Fly), one correct (local).
3. The Fly machine's `publishDocs` git pushes were rejected from ~08:24Z onward, so **none of its 13 transactions appear in `celo_activity.jsonl`** — the project's judge-facing guarantee that every onchain action has a logged rationale.

## Verification method (recompute this yourself)

- Window: 07:50:00Z–08:40:00Z = Celo blocks **69263442–69266442** (block timestamps 1781164200 → 1781167200, found by binary search via `eth_getBlockByNumber` on `https://forno.celo.org`; Celo runs exactly 1 block/second in this range).
- `eth_getLogs` on the Reputation Registry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, hc-mid's ChildAgent `0x7df6126b0D856a5aCCb8c315b30FB775fed09FF2`, and ERC-20 Transfer events on cUSD `0x765DE816845861e75A25fCA122bb6898B8B1282a` / USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` involving the orchestrator and hc-mid wallets. Because every orchestrator tx pays gas in cUSD (CIP-64, tx type 0x7b), the protocol fee debit/credit Transfer events make the cUSD log a complete index of orchestrator-sent transactions.
- **Completeness proof via nonces:** orchestrator `eth_getTransactionCount` went 129 → 154 across the window (25 txs) and the hc-mid wallet 14 → 23 (9 txs). All 34 are individually identified below or in `celo_activity.jsonl`. There are no hidden transactions.
- `giveFeedback(...)` calldata decoded directly from `eth_getTransactionByHash` input (selector `0x3c036a7e`: agentId, int128 value, decimals, tags, feedbackURI, feedbackHash).

## Timeline (all times UTC, 2026-06-11; onchain block timestamps are authoritative)

| Time | Event | Source |
|---|---|---|
| 07:55:46 | Fly machine boots duplicate orchestrator (old code) | Fly log |
| 08:23:52–08:24:22 | **Fly** posts 9 epoch-5 reputation feedbacks (old formula) | onchain, blocks 69265474–69265504 |
| 08:24:25 | **Fly** withdraws hc-mid's full Aave v3 USDC position (4.938174 USDC) | onchain |
| 08:24:30 | **Fly** sweeps hc-mid's loose cUSD (0.044875) to treasury | onchain |
| 08:24:34 | **Fly** executes `recallChild` on hc-mid's ChildAgent, rationale in calldata: "epoch 5 cull: fitness **-7.737** in bottom 20% (median 0.000)" (old-formula value) | onchain |
| 08:24:39 | **Fly** sends 5.00 cUSD to HD-index-14 wallet `0x055662…0E06` to fund spawn "mfx-aggressive-g3-i14" (never completed: agent card never resolved, no ERC-8004 registration from Fly) | onchain |
| ~08:24+ | Fly `publishDocs` git pushes rejected → its txs never enter `celo_activity.jsonl` | Fly log / git |
| 08:29:21–08:29:54 | **Local** posts 9 epoch-5 feedbacks with corrected flow-adjusted formula (all logged) | onchain + activity log |
| 08:29:38 (logged) | Local `recallChild` attempt on hc-mid reverts "already recalled". No onchain tx exists for it — orchestrator nonce accounting closes at 25, so the revert was caught at gas estimation before broadcast | nonce analysis |
| 08:30:01–08:31:23 | **Local** unwinds hc-mid: USDC approve + Mento swap 4.878 USDC→cUSD, residual swap, sweep $4.87 to treasury (logged). Note: the USDC it swapped was freed by Fly's *unlogged* Aave withdraw at 08:24:25 | onchain + activity log |
| 08:30:42 | Fly log claims "epoch 5 settled" (its writes had landed onchain 6 min earlier) | Fly log |
| 08:32:15–08:33:51 | **Local** re-funds culled hc-mid twice (+$4.95, +$5.00) while the unwinder sweeps each top-up straight back (~$4.996 ×2) — a fund/sweep loop on a retired agent (logged, see Impact) | onchain + activity log |
| 08:34:48–08:34:52 | **Local** registers ERC-8004 **#9262** for spawn `mfx-cautious-g2-i14` on the *same* HD-index-14 wallet Fly had funded; SpawnFactory child cloned (logged). epoch-5.json `settledAt` | onchain + activity log |
| 08:35:49–08:35:53 | **Local** treasury approve + Mento swap $0.75 cUSD→USDC (logged; approve recorded as `approvalTxHash` in the swap entry) | onchain + activity log |

## Fly-originated transactions (13, **none** in `celo_activity.jsonl`)

All sent with CIP-64 cUSD fee currency, all status = success. Sender is the orchestrator `0xC029…50e0` except #10–11, sent from the hc-mid agent wallet `0x0489…8eFB` (same mnemonic, Fly-controlled).

| # | Time (UTC) | Tx hash | Action | Target | Logged? | Celoscan |
|---|---|---|---|---|---|---|
| 1 | 08:23:52 | `0x3448bc6935ae35f95855180c54c685604198d4576162afdfd0e088cb59b20e01` | giveFeedback #9241 mfx-cautious, score **50** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x3448bc6935ae35f95855180c54c685604198d4576162afdfd0e088cb59b20e01) |
| 2 | 08:23:56 | `0xb0054ed3409b4b104703ca0d911454f394ba505bf696bf1db94eb17b97552e47` | giveFeedback #9242 mfx-balanced, score **50** | Reputation Registry | NO | [link](https://celoscan.io/tx/0xb0054ed3409b4b104703ca0d911454f394ba505bf696bf1db94eb17b97552e47) |
| 3 | 08:23:59 | `0x3d81129c7016f4d490277203d0be6b747fc099ebe2389a49d800144d082d3cc5` | giveFeedback #9245 ay-balanced, score **0** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x3d81129c7016f4d490277203d0be6b747fc099ebe2389a49d800144d082d3cc5) |
| 4 | 08:24:03 | `0x838c96411c7fd84be70c6007c0f21a21dd8435534ec8c6ae63cedaff55969e94` | giveFeedback #9246 ay-chaser, score **100** (wrong: $0.20 top-up scored as P&L) | Reputation Registry | NO | [link](https://celoscan.io/tx/0x838c96411c7fd84be70c6007c0f21a21dd8435534ec8c6ae63cedaff55969e94) |
| 5 | 08:24:07 | `0x6c07065b359efb58088c5bfb07cb3142ef9a684ff4fb9a7e78f911a8891f9f00` | giveFeedback #9248 hc-mid, score **0** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x6c07065b359efb58088c5bfb07cb3142ef9a684ff4fb9a7e78f911a8891f9f00) |
| 6 | 08:24:11 | `0x23cb8f88490ab8b44c53368b11bf4173ad99cc4235ec9dbbbb7ae1d57b5af511` | giveFeedback #9256 mfx-cautious-g2-i10, score **50** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x23cb8f88490ab8b44c53368b11bf4173ad99cc4235ec9dbbbb7ae1d57b5af511) |
| 7 | 08:24:15 | `0x0d7d11ad03602e202362f79f6f0c37ed518cb70abb79d93f19117d5504b9342b` | giveFeedback #9257 mfx-cautious-g2-i11, score **50** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x0d7d11ad03602e202362f79f6f0c37ed518cb70abb79d93f19117d5504b9342b) |
| 8 | 08:24:18 | `0x47fbb1efd8edd7579cc73e73485b15505b25f7c655521f01776ba1f05f260ec9` | giveFeedback #9259 mfx-aggressive-g2-i12, score **100** (wrong: $0.20 top-up scored as P&L) | Reputation Registry | NO | [link](https://celoscan.io/tx/0x47fbb1efd8edd7579cc73e73485b15505b25f7c655521f01776ba1f05f260ec9) |
| 9 | 08:24:22 | `0x33fca975c32b4ffc51ebdc31e66a02dbfed634fe4e6421ed5c3c22d65115bb8a` | giveFeedback #9260 ay-balanced-g2-i13, score **0** | Reputation Registry | NO | [link](https://celoscan.io/tx/0x33fca975c32b4ffc51ebdc31e66a02dbfed634fe4e6421ed5c3c22d65115bb8a) |
| 10 | 08:24:25 | `0x63d35007a9d46d5bd03d53509176c25ec95ae4dcbda53908998a61ab82b5698f` | Aave v3 `withdraw(USDC, max)` for hc-mid → **4.938174 USDC** to hc-mid wallet | Aave Pool `0x3E59…3402` | NO | [link](https://celoscan.io/tx/0x63d35007a9d46d5bd03d53509176c25ec95ae4dcbda53908998a61ab82b5698f) |
| 11 | 08:24:30 | `0xdb168731d8ef425dbcd5219221e76f5598d3d95a93b7959d31a0405601017577` | cUSD sweep hc-mid → treasury, **0.044875 cUSD** | cUSD | NO | [link](https://celoscan.io/tx/0xdb168731d8ef425dbcd5219221e76f5598d3d95a93b7959d31a0405601017577) |
| 12 | 08:24:34 | `0xae24395908700dd80faffb8110685c115afb1ee8cd1394b394cb9964362dbf00` | `recallChild` on hc-mid ChildAgent; calldata rationale "epoch 5 cull: fitness **-7.737**…" (old formula; corrected value is -28.426). This is the tx that made the local recall revert "already recalled" | `0x7df6…9FF2` | NO | [link](https://celoscan.io/tx/0xae24395908700dd80faffb8110685c115afb1ee8cd1394b394cb9964362dbf00) |
| 13 | 08:24:39 | `0xeb32760d69bf3b241c86a596350310cb1c0661ab437538055442b22167755722` | Transfer **5.00 cUSD** orchestrator → `0x055662c42203a8D38644982161343D75FE940E06` (HD index 14) to fund the never-completed spawn "mfx-aggressive-g3-i14" | cUSD | NO | [link](https://celoscan.io/tx/0xeb32760d69bf3b241c86a596350310cb1c0661ab437538055442b22167755722) |

Total Fly gas spend: ~$0.02 in cUSD fees across the 13 txs.

## Duplicate epoch-5 reputation feedback

Every epoch-5 feedback (both batches) was authored by the orchestrator identity, tagged `epoch-fitness`, with `feedbackURI = https://poulavbhowmick03.github.io/spawn-celo/epochs/epoch-5.json`. The **published** epoch-5.json is the local/corrected one (the Fly machine's pushes were rejected), so the nine Fly `feedbackHash` values reference a document version that was never published and **cannot be verified against any public artifact**. The local batch's hashes correspond to `docs/epochs/epoch-5.json` as published.

| Agent | ERC-8004 ID | Fly score (old formula, 08:23–08:24Z) | Local score (corrected, 08:29Z) | Divergent? | Correct entry (local tx) |
|---|---|---|---|---|---|
| mfx-cautious | 9241 | 50 | **50** | no (duplicate, same value) | `0x14023245645348d77ff64eb20d1a064998e93b57440ae8dc93e341f04afc6b58` |
| mfx-balanced | 9242 | 50 | **50** | no | `0x722bcbc5b9eb477f58fa626372eb32206fc03e14f7875a3a9f2cd7acdd8facd1` |
| ay-balanced | 9245 | 0 | **0** | no | `0x0803d97b5591445932d4e4f7b0c6255993efc84ac69c1b7a136df3f3aa8ad5d2` |
| **ay-chaser** | **9246** | **100** | **0** | **YES** | `0x4535151c6e3e01f1d4fa275b615b7ab66eb9bc05468a87569fd74b962dbee042` |
| hc-mid | 9248 | 0 | **0** | no | `0x759ef8214f1e705c581c315630eb11c14b3a948cd288248083220eecebac3519` |
| mfx-cautious-g2-i10 | 9256 | 50 | **50** | no | `0x48c106f0aae944b0ce3cc8db46b8a7bbb73d0a4eb606debc26bdb934811fb244` |
| mfx-cautious-g2-i11 | 9257 | 50 | **50** | no | `0xb2a2dc4fbd453dc43035dcb1fb5495581019adb0740aa47b6c88883900cebb88` |
| **mfx-aggressive-g2-i12** | **9259** | **100** | **50** | **YES** | `0xb8bf8cacf52d5a922cdf015e4857a1970186843a1fbebf37d14d42dd33a6713c` |
| ay-balanced-g2-i13 | 9260 | 0 | **0** | no | `0xbc38dd50ecd49079aa37f863f66c56f0d14f4b56b328de3c3f9973e429f0d874` |

Why the two divergences: ay-chaser (#9246) and mfx-aggressive-g2-i12 (#9259) each received a $0.20 USDC x402 signal-budget top-up mid-epoch. The old formula scored that funding flow as trading P&L (≈ +86 annualized fitness → clamped score 100). The corrected formula subtracts `netFlowUsd = 0.2`, yielding the true fitness (9246: −6.94 → score 0 after gas; 9259: 0 → score 50). Both values are recomputable from `docs/epochs/epoch-5.json` (`vStartUsd`, `vEndUsd`, `gasUsd`, `netFlowUsd` per agent) and from Celoscan balances at the epoch boundary blocks.

## Stranded funds

**None permanently stranded, but $5.00 of agent funding has no log entry.** Fly tx #13 sent 5.00 cUSD to the HD-index-14 wallet `0x055662c42203a8D38644982161343D75FE940E06` for its incomplete spawn. Because both orchestrators derive wallets from the same mnemonic at the same index, the local swarm's epoch-5 spawn `mfx-cautious-g2-i14` (ERC-8004 **#9262**, registered 08:34:48Z) landed on **the same wallet** and adopted that balance — the local instance found the wallet already at the $5 cap and never sent (or logged) its own funding transfer. The funds are inside the active swarm and under the budget cap, but `celo_activity.jsonl` contains **no funding entry for mfx-cautious-g2-i14**; its capital provenance is only explained by Fly tx `0xeb32760d…5722` and this report.

Other Fly-moved funds: hc-mid's 4.938 USDC Aave withdrawal stayed in hc-mid's wallet and was consumed by the local unwind swap `0xd36e0f7c…cddb` (logged); the 0.0449 cUSD sweep went to the treasury. No funds left swarm-controlled addresses.

## Impact & remediation

**Impact.**

1. **Activity-log guarantee broken for 13 transactions.** The project's judge-facing claim is that every onchain action by swarm addresses has a logged, human-readable rationale in `celo_activity.jsonl`. The 13 Fly transactions above violate that for the 08:23:52–08:24:39Z span. This report, generated purely from public RPC data, is the compensating record: each tx is enumerated with its decoded action and the nonce accounting proves the list is complete (orchestrator 25/25 and hc-mid 9/9 window txs identified).
2. **Two wrong reputation scores onchain.** ERC-8004 feedback is immutable; the Fly entries for #9246 (100) and #9259 (100) cannot be deleted. Consistent with the project's existing disclosure pattern (README correction note for epochs 3–4), they stay onchain and this report is the public record of what they actually measured: a funding flow, not P&L. Anyone recomputing fitness from Celoscan + `docs/epochs/epoch-5.json` will reproduce the local scores (0 and 50), not the Fly ones. The Fly entries are additionally distinguishable mechanically: their `feedbackHash` values match no published epoch report, while every local entry's hash commits to the published `epoch-5.json` (which embeds `netFlowUsd`, making the flow-exclusion itself verifiable).
3. **Seven redundant duplicate feedbacks.** For the other 7 agents the Fly and local scores coincide, so reputation state is unaffected, but each agent shows two orchestrator feedbacks for epoch 5 on 8004scan. Benign double-write, disclosed here.
4. **Cull provenance split across instances.** hc-mid's cull was executed by Fly (recall + Aave withdraw + partial sweep) and completed by local (swaps + sweeps). The onchain recall rationale carries the old-formula fitness (−7.737); the correct value (−28.426) is in the local log and epoch report. End state is correct: hc-mid retired, fully unwound to cUSD in the treasury.
5. **Collateral inefficiency (local bug, surfaced by the race):** after culling hc-mid, the local instance re-funded it twice ($4.95 + $5.00) while its own unwinder swept each top-up back (~$4.996 ×2) — txs `0x51455258…`, `0x5f366e10…`, `0x9f2d0528…`, `0x6d5c7a1e…`, all logged. Net cost ≈ gas only, but the funder should never target a culled agent.

**Remediation.**

- Fly machine stopped; `spawn-celo-swarm` app must not be restarted with the production `MNEMONIC` (done — machine stopped ~08:31Z; recommend destroying the app or rotating its secrets so a restart cannot recur).
- Single-writer lock: the orchestrator should take an onchain or out-of-band lease (e.g., a nonce-gap check plus a heartbeat file in the repo, or simply asserting expected next-nonce before each settle) and refuse to settle an epoch if another writer has moved the treasury nonce.
- Funder fix: exclude `status != ACTIVE` agents from top-up eligibility (prevents the fund/sweep loop in item 5).
- Log backfill policy: per project rules, `celo_activity.jsonl` records actions the orchestrator itself took with rationales at decision time; we do not retro-fabricate rationale entries for the Fly txs. This report (committed under `docs/`) is the permanent disclosure, mirroring the epochs 3–4 correction-note pattern.
- 8004scan note: judges or auditors comparing feedback counts will see 2 epoch-5 entries per agent from the same author. The later entry (blocks 69265803–69265836) is authoritative; its hashes verify against the published epoch report.

*All claims in this document are recomputable from `https://forno.celo.org` with `eth_getLogs`/`eth_getTransactionByHash` over blocks 69263442–69266442 and from `celo_activity.jsonl` / `docs/epochs/epoch-5.json` in this repository.*
