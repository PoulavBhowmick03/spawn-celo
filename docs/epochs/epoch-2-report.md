# Epoch 2 report — Spawn Hedge Swarm on Celo

Settled 2026-06-10T19:15:22.489Z · epoch length 0.5h · swarm median fitness -27.6401
Culled: hc-light · Spawned: none

Fitness formula (recomputable from Celoscan): `fitness = (V_end/V_start − 1)·(8760/epoch_h) − (gas/V_start)·(8760/epoch_h)`; `score = clamp(round(50 + 500·(fitness − median)), 0, 100)`

## Fitness table

| agent | ERC-8004 | strategy | gen | V_start | V_end | gas | fitness | score | culled | reputation tx |
|---|---|---|---|---|---|---|---|---|---|---|
| mfx-cautious | [#9241](https://www.8004scan.io/agents/celo/9241) | MentoFXRotator | g1 | $5.0000 | $5.0000 | $0.0000 | 0.0000 | 100 |  | [tx](https://celoscan.io/tx/0x52b21642e73d928913ded450548f2191b45021c9de8e975d983fb3c08dd11a41) |
| mfx-balanced | [#9242](https://www.8004scan.io/agents/celo/9242) | MentoFXRotator | g1 | $5.0000 | $5.0000 | $0.0000 | 0.0000 | 100 |  | [tx](https://celoscan.io/tx/0x295ffa86bb0d242f46552ff877c7b4f34ce5cdf54a6d1b44fb84bc105605003d) |
| mfx-aggressive | [#9243](https://www.8004scan.io/agents/celo/9243) | MentoFXRotator | g1 | $5.0000 | $5.0000 | $0.0000 | 0.0000 | 100 |  | [tx](https://celoscan.io/tx/0x623c6fc106ebd09cacc7bdc1b882074656687af9c042fdb565d60b5ba53727e0) |
| ay-balanced | [#9245](https://www.8004scan.io/agents/celo/9245) | AaveYielder | g1 | $4.9988 | $4.9951 | $0.0042 | -27.6626 | 39 |  | [tx](https://celoscan.io/tx/0x6b333d4416d46862a15b7cf34ef0d1697670524449b99f6810ab9f27496c5e07) |
| ay-chaser | [#9246](https://www.8004scan.io/agents/celo/9246) | AaveYielder | g1 | $4.9988 | $4.9951 | $0.0042 | -27.6175 | 61 |  | [tx](https://celoscan.io/tx/0xfdd7a10339fbf3c2fbcd2115dd95913854b13db66aceb77553b6cfb74fc3e41a) |
| hc-light | [#9247](https://www.8004scan.io/agents/celo/9247) | HedgedCarry | g1 | $4.9988 | $4.9909 | $0.0072 | -52.8298 | 0 | **yes** | [tx](https://celoscan.io/tx/0x903f034b2afab21aecc4350141bb08aed48e2c2e6361b4eae3db5390f9f9e676) |
| hc-mid | [#9248](https://www.8004scan.io/agents/celo/9248) | HedgedCarry | g1 | $4.9988 | $4.9909 | $0.0072 | -52.8291 | 0 |  | [tx](https://celoscan.io/tx/0x99b7f7f499852ac99f28432508f9900260518756e1c94d941c9af82a5c5b3bc2) |
| hc-heavy | [#9249](https://www.8004scan.io/agents/celo/9249) | HedgedCarry | g1 | $4.9988 | $4.9909 | $0.0072 | -52.8298 | 0 |  | [tx](https://celoscan.io/tx/0x600c175d0f86b6a6ce8a6463407f219cf3f52b2c9099c9046ab41feda9204b8b) |

## Transactions with rationales (36 actions in window)

- `2026-06-10T18:38:33.038Z` **mfx-cautious** hold
  Epoch 2: no FX leg clears momentum > cost + 30bps (EURm -2.0bps/cost 49.9bps, BRLm 3.3bps/cost 59.9bps); holding
- `2026-06-10T18:38:35.688Z` **mfx-balanced** hold
  Epoch 2: no FX leg clears momentum > cost + 20bps (EURm -2.0bps/cost 49.9bps, BRLm 3.3bps/cost 59.9bps); holding
- `2026-06-10T18:38:38.022Z` **mfx-aggressive** hold
  Epoch 2: no FX leg clears momentum > cost + 12bps (EURm -2.0bps/cost 49.9bps, BRLm 3.3bps/cost 59.9bps); holding
- `2026-06-10T18:38:44.494Z` **ay-balanced** mento-swap — [tx](https://celoscan.io/tx/0x8ff91bd3f7c6a1eaf576475a89aaef51bc2300724a82ceef6b330ac8fa16367e)
  Epoch 2 AaveYielder: convert idle cUSD to USDC (best supply APY 2.60%) ahead of supplying
- `2026-06-10T18:38:49.556Z` **ay-balanced** decision-proof — [tx](https://celoscan.io/tx/0xf49424777d6a79164bc2a8eaa54bb7371adb2128bc0e52087a620068baf360d8)
  Epoch 2: commit keccak hash of the mento-swap decision payload to ay-balanced's ChildAgent contract so the decision that produced tx 0x8ff91bd3f7c6a1eaf576475a89aaef51bc2300724a82ceef6b330ac8fa16367e is provable onchain.
- `2026-06-10T18:38:57.129Z` **ay-chaser** mento-swap — [tx](https://celoscan.io/tx/0x1546f33dc1726735d20c53312c36ba24598bf2c46bcee8d81b6f0ea93f0d3296)
  Epoch 2 AaveYielder: convert idle cUSD to USDC (best supply APY 2.60%) ahead of supplying
- `2026-06-10T18:39:01.924Z` **ay-chaser** decision-proof — [tx](https://celoscan.io/tx/0x6c068e0d23d1caad882e850c793c52ce315cb4bdaf3c1ad5837019175e88262c)
  Epoch 2: commit keccak hash of the mento-swap decision payload to ay-chaser's ChildAgent contract so the decision that produced tx 0x1546f33dc1726735d20c53312c36ba24598bf2c46bcee8d81b6f0ea93f0d3296 is provable onchain.
- `2026-06-10T18:39:08.865Z` **hc-light** mento-swap — [tx](https://celoscan.io/tx/0x2453276897e7d43a889b1650d7c56b3a3fcb2f2c39b622439f03cad09869635a)
  Epoch 2 HedgedCarry: carry side: convert idle cUSD to USDC (best supply APY 2.60%)
- `2026-06-10T18:39:12.794Z` **hc-light** decision-proof — [tx](https://celoscan.io/tx/0xa64906370b0cdfabdf31ecd26a5f4ad04b53ea19a9295518f620dfd0597edcc0)
  Epoch 2: commit keccak hash of the mento-swap decision payload to hc-light's ChildAgent contract so the decision that produced tx 0x2453276897e7d43a889b1650d7c56b3a3fcb2f2c39b622439f03cad09869635a is provable onchain.
- `2026-06-10T18:39:16.491Z` **hc-light** aave-approve — [tx](https://celoscan.io/tx/0x73baa326210b1dfef104dfd21eea10e96c7c44d8f843c3c0505fa2ca4760a83f)
  One-time max approval of USDC to the Aave v3 Pool so future supplies don't each need an approval tx (batched per CLAUDE.md §8).
- `2026-06-10T18:39:19.611Z` **hc-light** aave-supply — [tx](https://celoscan.io/tx/0x51963c8eccce9939b04fe8f8bc9ffd12a258dce09629f74d79a20c69c33b927e)
  Epoch 2 HedgedCarry: carry side: supply USDC at 2.60% APY
- `2026-06-10T18:39:23.546Z` **hc-light** decision-proof — [tx](https://celoscan.io/tx/0xe91d7d3bf5b10497eeb6973a8f9a3e551dff0a84cc3e368958d7ded0469abdba)
  Epoch 2: commit keccak hash of the aave-supply decision payload to hc-light's ChildAgent contract so the decision that produced tx 0x51963c8eccce9939b04fe8f8bc9ffd12a258dce09629f74d79a20c69c33b927e is provable onchain.
- `2026-06-10T18:39:30.632Z` **hc-mid** mento-swap — [tx](https://celoscan.io/tx/0xf68415f9672721e39430e8244841a7d9fe7e5ee297b23eeea0e161493c128667)
  Epoch 2 HedgedCarry: carry side: convert idle cUSD to USDC (best supply APY 2.60%)
- `2026-06-10T18:39:34.815Z` **hc-mid** decision-proof — [tx](https://celoscan.io/tx/0x69ca778439cf2da06686a3efede8cfa6981ba3beb36108a1386cce5ab2878932)
  Epoch 2: commit keccak hash of the mento-swap decision payload to hc-mid's ChildAgent contract so the decision that produced tx 0xf68415f9672721e39430e8244841a7d9fe7e5ee297b23eeea0e161493c128667 is provable onchain.
- `2026-06-10T18:39:38.532Z` **hc-mid** aave-approve — [tx](https://celoscan.io/tx/0x2d49b5bcacf96685a0bf8efbf748519141f21f456301ba6a7aad48304612a394)
  One-time max approval of USDC to the Aave v3 Pool so future supplies don't each need an approval tx (batched per CLAUDE.md §8).
- `2026-06-10T18:39:41.637Z` **hc-mid** aave-supply — [tx](https://celoscan.io/tx/0x0b67b246893e63df7da15a941db2c675af6ea42b142b8cd7701894198176bed1)
  Epoch 2 HedgedCarry: carry side: supply USDC at 2.60% APY
- `2026-06-10T18:39:45.825Z` **hc-mid** decision-proof — [tx](https://celoscan.io/tx/0x3bab40b9baccf45f5f85e3cd7494bbc62212efd7106becef0f2c66917b389c20)
  Epoch 2: commit keccak hash of the aave-supply decision payload to hc-mid's ChildAgent contract so the decision that produced tx 0x0b67b246893e63df7da15a941db2c675af6ea42b142b8cd7701894198176bed1 is provable onchain.
- `2026-06-10T18:39:52.667Z` **hc-heavy** mento-swap — [tx](https://celoscan.io/tx/0x6f65d14b6e2a3d7d12f0677625b21447e3640106481d539034853a63d1214549)
  Epoch 2 HedgedCarry: carry side: convert idle cUSD to USDC (best supply APY 2.60%)
- `2026-06-10T18:39:56.639Z` **hc-heavy** decision-proof — [tx](https://celoscan.io/tx/0x63aa3b4a059c271d77123ae5e22f9493c5c6dc553bbea4d6fbb7048e87a20dfb)
  Epoch 2: commit keccak hash of the mento-swap decision payload to hc-heavy's ChildAgent contract so the decision that produced tx 0x6f65d14b6e2a3d7d12f0677625b21447e3640106481d539034853a63d1214549 is provable onchain.
- `2026-06-10T18:40:01.083Z` **hc-heavy** aave-approve — [tx](https://celoscan.io/tx/0xade9837664a0c2150dbd6e04a092d8222392127f04713c20de6e304f3bfd167a)
  One-time max approval of USDC to the Aave v3 Pool so future supplies don't each need an approval tx (batched per CLAUDE.md §8).
- `2026-06-10T18:40:04.969Z` **hc-heavy** aave-supply — [tx](https://celoscan.io/tx/0xac445661213a0b7e1f44658868cf3f268b430ab117d7df62c54482ade0ad719d)
  Epoch 2 HedgedCarry: carry side: supply USDC at 2.60% APY
- `2026-06-10T18:40:10.226Z` **hc-heavy** decision-proof — [tx](https://celoscan.io/tx/0x07bd2c2bc5ed3c58ed523d523a153781938dac644eec24ed927015287c1723ad)
  Epoch 2: commit keccak hash of the aave-supply decision payload to hc-heavy's ChildAgent contract so the decision that produced tx 0xac445661213a0b7e1f44658868cf3f268b430ab117d7df62c54482ade0ad719d is provable onchain.
- `2026-06-10T18:42:43.607Z` **orchestrator** spawn-funding — [tx](https://celoscan.io/tx/0xad93088e34e3bc8ec48d11dc66b8c6682bdbc4b9c34b44c859afec02edd9c76f)
  Fund spawned agent mfx-cautious-g2-i10 with $5.00 cUSD from the spawn pool (recycled from culled agents' returned balances; per-agent cap $5). Funded before registration so the new wallet pays its own registration gas in cUSD.
- `2026-06-10T18:42:49.730Z` **mfx-cautious-g2-i10** erc8004-register — [tx](https://celoscan.io/tx/0x0738713629764504682b8216e51fed8dab298d02652eb0157acfdd2bcc98b0f0)
  Mint ERC-8004 identity #9256 for mfx-cautious-g2-i10 in the canonical Celo Identity Registry, owned by the agent's own wallet 0x16a6432854fB067bE2353B15507043C39258EffB (self-owned so the orchestrator can post performance feedback — the registry forbids owner self-feedback). Agent card: https://poulavbhowmick03.github.io/spawn-celo/agents/mfx-cautious-g2-i10.json. Gas paid in cUSD.
- `2026-06-10T18:42:53.516Z` **orchestrator** spawn-child-onchain — [tx](https://celoscan.io/tx/0x39c1fe08c152b7715797248fcd342770ab87d7bfd4f335f54291f8cabfdfea9a)
  Onchain spawn provenance for mfx-cautious-g2-i10: SpawnFactory cloned a ChildAgent (lineage "mfx-cautious", generation 2, wallet 0x16a6432854fB067bE2353B15507043C39258EffB); decision proofs for this agent will be recorded on the clone.
- `2026-06-10T19:14:41.263Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x52b21642e73d928913ded450548f2191b45021c9de8e975d983fb3c08dd11a41)
  Epoch 2 performance attestation for mfx-cautious (ERC-8004 #9241): score 100/100 from the published fitness formula with inputs V_start=$5.0000, V_end=$5.0000, gas=$0.0000 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:14:46.790Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x295ffa86bb0d242f46552ff877c7b4f34ce5cdf54a6d1b44fb84bc105605003d)
  Epoch 2 performance attestation for mfx-balanced (ERC-8004 #9242): score 100/100 from the published fitness formula with inputs V_start=$5.0000, V_end=$5.0000, gas=$0.0000 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:14:50.446Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x623c6fc106ebd09cacc7bdc1b882074656687af9c042fdb565d60b5ba53727e0)
  Epoch 2 performance attestation for mfx-aggressive (ERC-8004 #9243): score 100/100 from the published fitness formula with inputs V_start=$5.0000, V_end=$5.0000, gas=$0.0000 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:14:54.895Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x6b333d4416d46862a15b7cf34ef0d1697670524449b99f6810ab9f27496c5e07)
  Epoch 2 performance attestation for ay-balanced (ERC-8004 #9245): score 39/100 from the published fitness formula with inputs V_start=$4.9988, V_end=$4.9951, gas=$0.0042 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:14:59.417Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0xfdd7a10339fbf3c2fbcd2115dd95913854b13db66aceb77553b6cfb74fc3e41a)
  Epoch 2 performance attestation for ay-chaser (ERC-8004 #9246): score 61/100 from the published fitness formula with inputs V_start=$4.9988, V_end=$4.9951, gas=$0.0042 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:15:02.506Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x903f034b2afab21aecc4350141bb08aed48e2c2e6361b4eae3db5390f9f9e676)
  Epoch 2 performance attestation for hc-light (ERC-8004 #9247): score 0/100 from the published fitness formula with inputs V_start=$4.9988, V_end=$4.9909, gas=$0.0072 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:15:05.471Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x99b7f7f499852ac99f28432508f9900260518756e1c94d941c9af82a5c5b3bc2)
  Epoch 2 performance attestation for hc-mid (ERC-8004 #9248): score 0/100 from the published fitness formula with inputs V_start=$4.9988, V_end=$4.9909, gas=$0.0072 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:15:08.541Z` **orchestrator** reputation-feedback — [tx](https://celoscan.io/tx/0x600c175d0f86b6a6ce8a6463407f219cf3f52b2c9099c9046ab41feda9204b8b)
  Epoch 2 performance attestation for hc-heavy (ERC-8004 #9249): score 0/100 from the published fitness formula with inputs V_start=$4.9988, V_end=$4.9909, gas=$0.0072 over 0.5h — all reconstructible from Celoscan. feedbackHash=keccak(payload) binds this exact computation.
- `2026-06-10T19:15:12.468Z` **hc-light** aave-withdraw — [tx](https://celoscan.io/tx/0xcaa96e4dfbb9f9a64ad47d9de6bb393876ffc323dcf01187d0098cfe44209e18)
  Unwind (epoch 2 cull: fitness -52.830 in bottom 20% (median -27.640)): withdraw full USDC position from Aave v3 so the balance can return to the treasury.
- `2026-06-10T19:15:17.454Z` **hc-light** unwind-sweep — [tx](https://celoscan.io/tx/0xd19f63ef5aae075f831329b69f5c66e62fc8cdd3a53ac00e0a10913ff41cd748)
  Unwind (epoch 2 cull: fitness -52.830 in bottom 20% (median -27.640)): return 0.0445721372148237 cUSD to the treasury 0xC0296012Cfbb0e6DF5dA7158B65Dbc46DD9650e0 the agent was funded from. Gas paid from the same cUSD; only dust (<$0.01) remains in the retired wallet.
- `2026-06-10T19:15:22.195Z` **hc-light** recall-onchain — [tx](https://celoscan.io/tx/0x7fa4bff81b57d711955f2fb92fa778263fbfe205439e03ff1deab9e119b89491)
  Onchain recall of culled agent hc-light: epoch 2 cull: fitness -52.830 in bottom 20% (median -27.640). Post-mortem: https://poulavbhowmick03.github.io/spawn-celo/epochs/epoch-2.json. Funds returned to treasury; ERC-8004 identity #9247 retired with its honest final reputation intact.

Links: [dashboard](https://spawn-celo-swarm.vercel.app) · [8004scan](https://www.8004scan.io/agents?search=spawn) · [explorer](https://celoscan.io) · raw data in this repo
