import { Navbar } from "@/components/Navbar";
import TerminalDashboard from "@/components/TerminalDashboard";

export default function TerminalPage() {
  return (
    <>
      <Navbar />
      <main className="shell">
        <TerminalDashboard />
      </main>
    </>
  );
}
