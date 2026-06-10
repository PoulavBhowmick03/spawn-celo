/**
 * Hard budget rails (CLAUDE.md §2) — enforced in code, not convention:
 *   - $50 USD-equivalent total budget
 *   - $5 per-agent wallet balance cap
 *   - refuse any single transaction moving more than $5
 *   - 1% slippage cap on every swap (enforced where swaps are built, using
 *     MAX_SLIPPAGE_BPS from here)
 *   - KILL_SWITCH env flag halts all writes
 *
 * Every mainnet write path MUST call assertTxAllowed() first.
 */

export const TOTAL_BUDGET_USD = Number(process.env.TOTAL_BUDGET_USD ?? 50);
export const MAX_AGENT_BALANCE_USD = Number(process.env.MAX_AGENT_BALANCE_USD ?? 5);
export const MAX_TX_USD = Number(process.env.MAX_TX_USD ?? 5);
export const MAX_SLIPPAGE_BPS = Number(process.env.MAX_SLIPPAGE_BPS ?? 100); // 1%

export function killSwitchEngaged(): boolean {
  return /^(1|true|yes)$/i.test(process.env.KILL_SWITCH ?? "");
}

export class BudgetRefusalError extends Error {
  constructor(message: string) {
    super(`BUDGET REFUSAL: ${message}`);
    this.name = "BudgetRefusalError";
  }
}

/**
 * Gate for every mainnet write. `usdValue` is the USD-equivalent the tx moves
 * (0 for pure approvals/registrations that move no funds — the kill switch
 * still applies to those).
 */
export function assertTxAllowed(usdValue: number, context: string): void {
  if (killSwitchEngaged()) {
    throw new BudgetRefusalError(`kill switch engaged — refusing ${context}`);
  }
  if (!Number.isFinite(usdValue) || usdValue < 0) {
    throw new BudgetRefusalError(`non-finite USD value for ${context}`);
  }
  if (usdValue > MAX_TX_USD) {
    throw new BudgetRefusalError(
      `${context} would move $${usdValue.toFixed(2)} > per-tx cap $${MAX_TX_USD}`,
    );
  }
}
