import { fetchActivity, fetchEpochReports, fetchSwarmState } from "@/lib/celo-data";
import { CeloDashboard } from "@/components/celo/CeloDashboard";

export const revalidate = 60;

export default async function Home() {
  const [state, activity] = await Promise.all([fetchSwarmState(), fetchActivity(500)]);
  const reports = state ? await fetchEpochReports(state.epochNumber) : [];

  return <CeloDashboard initialState={state} initialActivity={activity} initialReports={reports} />;
}
