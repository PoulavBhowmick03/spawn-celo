import { fetchActivity, fetchEpochReports, fetchLatestVerification, fetchSwarmState } from "@/lib/celo-data";
import { CeloDashboard } from "@/components/celo/CeloDashboard";

export const revalidate = 60;

export default async function Home() {
  const [state, activity] = await Promise.all([fetchSwarmState(), fetchActivity(500)]);
  const [reports, verification] = state
    ? await Promise.all([fetchEpochReports(state.epochNumber), fetchLatestVerification(state.epochNumber)])
    : [[], null];

  return (
    <CeloDashboard
      initialState={state}
      initialActivity={activity}
      initialReports={reports}
      verification={verification}
    />
  );
}
