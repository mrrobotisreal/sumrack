import { RunsListScreen } from '@/features/scenario/debrief/runs-list-screen';

/** Runs list (T63 §10.2) — per scenario (`?scenarioId=`) or global; each row → its debrief. */
export default function ScenarioRunsRoute() {
  return <RunsListScreen />;
}
