import { useQuery } from '@tanstack/react-query';
import { repos } from '@/db';
export const evidenceKey = ['learning-evidence'] as const;
export function useLearningEvidence() {
  return useQuery({ queryKey: evidenceKey, queryFn: () => repos.learningEvidence.read() });
}
