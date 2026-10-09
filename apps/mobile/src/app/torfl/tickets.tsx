import { useLocalSearchParams } from 'expo-router';

import { levelFromParam } from '@/features/torfl/level-profile';
import { TicketsScreen } from '@/features/torfl/speaking/tickets-screen';

/** `/torfl/tickets` — «Билеты»: draw a random monologue topic and run the task-3 flow (T73); `?level=` per level (T75). */
export default function TorflTicketsRoute() {
  const { level } = useLocalSearchParams<{ level?: string | string[] }>();
  return <TicketsScreen level={levelFromParam(level)} />;
}
