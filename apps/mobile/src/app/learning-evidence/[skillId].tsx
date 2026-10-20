import { useLocalSearchParams } from 'expo-router';
import { isPilotSkill } from '@/features/learning-evidence/catalog';
import { NotebookScreen } from '@/features/learning-evidence/notebook-screen';
export default function SkillRoute() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  return <NotebookScreen skill={isPilotSkill(skillId) ? skillId : undefined} />;
}
