import type { SwarmAgent } from "@/lib/celo-data";

export const STRATEGY_COLOR: Record<string, string> = {
  MentoFXRotator: "#4D9EFF",
  AaveYielder: "#A78BFF",
  HedgedCarry: "#22D3A1",
};

export function stratColor(strategy: string): string {
  return STRATEGY_COLOR[strategy] ?? "#8892A4";
}

export function lastHistory(agent: SwarmAgent) {
  return agent.history[agent.history.length - 1];
}

export function agentValue(agent: SwarmAgent): number {
  return lastHistory(agent)?.vEndUsd ?? agent.vStartUsd ?? 0;
}

export function agentFitness(agent: SwarmAgent): number | null {
  return lastHistory(agent)?.fitness ?? null;
}

export function agentScore(agent: SwarmAgent): number | null {
  return lastHistory(agent)?.score ?? null;
}

export function fmtFitness(f: number | null): string {
  if (f === null) return "—";
  const sign = f > 0 ? "+" : "";
  return `${sign}${f.toFixed(3)}`;
}

export function fitnessTone(f: number | null): "pos" | "neg" | "zero" {
  if (f === null || f === 0) return "zero";
  return f > 0 ? "pos" : "neg";
}

/** deterministic 0..2π angle from a slug, so node placement is stable across reloads */
export function slugAngle(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return (h % 3600) / 3600 * Math.PI * 2;
}

/** action badge palette — keyword-matched so new action types degrade gracefully */
export function actionStyle(action: string): { bg: string; color: string } {
  const a = action.toLowerCase();
  if (a.includes("x402") || a.includes("signal-sold") || a.includes("signal-purchase") || a.includes("settlement"))
    return { bg: "rgba(252,255,82,0.12)", color: "#FCFF52" };
  if (a.includes("signal-unavailable"))
    return { bg: "rgba(255,80,80,0.08)", color: "rgba(255,80,80,0.6)" };
  if (a.includes("mento") || a.includes("swap") || a.includes("fx"))
    return { bg: "rgba(77,158,255,0.12)", color: "#4D9EFF" };
  if (a.includes("aave") || a.includes("supply") || a.includes("withdraw") || a.includes("approve"))
    return { bg: "rgba(167,139,255,0.12)", color: "#A78BFF" };
  if (a.includes("unwind") || a.includes("recall") || a.includes("cull") || a.includes("sweep"))
    return { bg: "rgba(255,80,80,0.12)", color: "#FF5050" };
  if (a.includes("spawn") || a.includes("register"))
    return { bg: "rgba(34,211,161,0.12)", color: "#22D3A1" };
  if (a.includes("hold"))
    return { bg: "rgba(26,26,46,0.8)", color: "#8892A4" };
  return { bg: "rgba(136,146,164,0.1)", color: "#8892A4" };
}

export function isX402Action(action: string): boolean {
  const a = action.toLowerCase();
  return a.includes("x402") || a.includes("signal-sold") || a.includes("signal-purchase");
}
