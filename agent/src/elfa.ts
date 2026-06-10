/**
 * Elfa AI narrative context for Spawn Protocol child agents.
 *
 * Fetches real-time social intelligence from Elfa AI and formats
 * it as a concise context block for Venice AI decision prompts.
 *
 * Cost: 2 credits per call (1 per endpoint × 2 endpoints)
 * Timeout: 5 seconds (graceful fallback to empty string)
 * Never throws: all errors are caught and logged
 */

const ELFA_BASE = "https://api.elfa.ai";
const ELFA_KEY = process.env.ELFA_API_KEY ?? "";
const TIMEOUT_MS = 5_000;

interface ElfaTrendingToken {
  token?: string;
  symbol?: string;
  name?: string;
  current_count?: number;
  previous_count?: number;
  change_percent?: number;
}

interface ElfaNarrative {
  narrative?: string;
  label?: string;
  source_links?: string[];
  tweet_ids?: string[];
}

/**
 * Fetches trending tokens and narratives from Elfa AI.
 * Returns a formatted string for injection into Venice AI prompts.
 * Returns empty string on any error or if ELFA_API_KEY is not set.
 */
export async function fetchNarrativeContext(): Promise<string> {
  if (!ELFA_KEY) {
    console.log("[Elfa] ELFA_API_KEY not set — skipping narrative context");
    return "";
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Fetch trending tokens and narratives in parallel
    const [tokensRes, narrativesRes] = await Promise.allSettled([
      fetch(
        `${ELFA_BASE}/v2/aggregations/trending-tokens?timeWindow=4h&pageSize=8`,
        {
          headers: { "x-elfa-api-key": ELFA_KEY },
          signal: controller.signal,
        }
      ),
      fetch(
        `${ELFA_BASE}/v2/data/trending-narratives?timeWindow=4h`,
        {
          headers: { "x-elfa-api-key": ELFA_KEY },
          signal: controller.signal,
        }
      ),
    ]);

    clearTimeout(timer);

    // Parse tokens. Elfa shape: { data: { data: [{ token, change_percent }] } };
    // fall back across nesting levels so a future shape change degrades gracefully.
    let trendingTokens: string[] = [];
    if (tokensRes.status === "fulfilled" && tokensRes.value.ok) {
      const data = await tokensRes.value.json();
      const tokens: ElfaTrendingToken[] = data?.data?.data ?? data?.data ?? [];
      trendingTokens = (Array.isArray(tokens) ? tokens : [])
        .slice(0, 6)
        .map((t) => (t.token ?? t.symbol ?? t.name ?? "").toUpperCase())
        .filter(Boolean);
    }

    // Parse narratives. Elfa shape: { data: { trending_narratives: [{ narrative }] } }.
    let topNarratives: string[] = [];
    if (narrativesRes.status === "fulfilled" && narrativesRes.value.ok) {
      const data = await narrativesRes.value.json();
      const narratives: ElfaNarrative[] =
        data?.data?.trending_narratives ?? data?.data ?? [];
      topNarratives = (Array.isArray(narratives) ? narratives : [])
        .slice(0, 3)
        .map((n) => n.narrative ?? n.label ?? "")
        .filter(Boolean);
    }

    // Return empty if both failed
    if (trendingTokens.length === 0 && topNarratives.length === 0) {
      console.log("[Elfa] No data returned from API");
      return "";
    }

    // Format as concise context block
    const lines: string[] = [
      "--- CURRENT MARKET SOCIAL SIGNALS (via Elfa AI, last 4h) ---",
    ];

    if (trendingTokens.length > 0) {
      lines.push(`Trending tokens by social volume: ${trendingTokens.join(", ")}`);
    }

    if (topNarratives.length > 0) {
      lines.push(`Active narratives: ${topNarratives.join(" | ")}`);
    }

    lines.push(
      "Use these signals as weak priors — do not override fundamentals. " +
        "If USDe or Mantle ecosystem tokens are trending, slight bullish " +
        "signal for supply/LP positions. If stablecoin depeg narratives " +
        "are active, prefer HOLD or WITHDRAW."
    );
    lines.push("--- END SOCIAL SIGNALS ---");

    const context = lines.join("\n");
    console.log(
      `[Elfa] Narrative context fetched: ${trendingTokens.length} tokens, ${topNarratives.length} narratives`
    );
    return context;
  } catch (err: any) {
    // Never let Elfa errors break the agent decision loop
    if (err?.name === "AbortError") {
      console.log("[Elfa] Request timed out after 5s — continuing without narrative context");
    } else {
      console.log(`[Elfa] Error fetching context (non-blocking): ${err?.message ?? String(err)}`);
    }
    return "";
  }
}
