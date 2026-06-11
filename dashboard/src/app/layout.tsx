import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Space_Grotesk, Syne } from "next/font/google";
import "./globals.css";
import "./celo-dash.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const display = Syne({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-mono",
});

// Celo dashboard faces (scoped under .sp in celo-dash.css)
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sg",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jbm",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Spawn Protocol | Hedge Swarm on Celo",
  description:
    "Darwinian swarm of ERC-8004 agents protecting stablecoin purchasing power on Celo mainnet — Mento FX + Aave v3 yield, recomputable onchain reputation, every transaction with a published rationale.",
  other: {
    "talentapp:project_verification":
      "58f240326e3d03f3c4c7b9422b8c5d52464d103e7aeade52120a12936138af75cbcd2dd3c026147159d3b574c461047ec56a6f2dabe84158c2f050947a0c2386",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${inter.variable}`}
    >
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
