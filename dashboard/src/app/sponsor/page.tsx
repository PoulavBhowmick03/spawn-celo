import Link from "next/link";
import { SponsorPanel } from "@/components/celo/SponsorPanel";

export const metadata = {
  title: "Sponsor an agent — Spawn Hedge Swarm on Celo",
  description: "Send cUSD to the swarm and spawn a real ERC-8004 agent in your name.",
};

export default function SponsorPage() {
  return (
    <div className="sp">
      <main className="sp-shell">
        <header>
          <p className="sp-kicker">celo mainnet · sponsor a live agent</p>
          <div className="sp-mast">
            <h1>
              Spawn Protocol <span className="dim">— Sponsor an Agent</span>
            </h1>
            <nav className="sp-extlinks">
              <Link href="/">← swarm dashboard</Link>
            </nav>
          </div>
        </header>
        <SponsorPanel />
      </main>
    </div>
  );
}
