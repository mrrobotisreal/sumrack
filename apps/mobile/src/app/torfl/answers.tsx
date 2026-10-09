import { useLocalSearchParams } from 'expo-router';

import { levelFromParam } from '@/features/torfl/level-profile';
import { AnswersScreen } from '@/features/torfl/answers/answers-screen';

/** `/torfl/answers` — «Мои ответы», the personal answer bank (T74, TORFL §9); `?level=` per level (T75). */
export default function TorflAnswersRoute() {
  const { level } = useLocalSearchParams<{ level?: string | string[] }>();
  return <AnswersScreen level={levelFromParam(level)} />;
}
