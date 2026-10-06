import { ExamRunScreen } from '@/features/torfl/exam-run-screen';

/** Mock runner route (T71): `/exam/run/<attemptId>[?devDurationSec=60]` (the override is __DEV__ only). */
export default function ExamRunRoute() {
  return <ExamRunScreen />;
}
