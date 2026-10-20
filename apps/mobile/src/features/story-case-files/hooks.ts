import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { repos } from '@/db';
import { useStoryProgress } from '@/db/hooks';
import { caseAvailability, CASE_FILE_MODE, parseAttempts, type CaseFile } from './model';

export function useCaseFile(file: CaseFile | undefined) {
  const progress = useStoryProgress(file?.packId ?? '', file?.storyId ?? '');
  const query = useQuery({
    queryKey: ['case-files', file?.id ?? 'unknown'],
    queryFn: async () => {
      if (!file) return null;
      const [source, progress, rows] = await Promise.all([
        repos.content.getStoryDetail(file.packId, file.storyId),
        repos.reading.getProgress(file.packId, file.storyId),
        repos.learningSessions.list(CASE_FILE_MODE, 10000),
      ]);
      const availability = caseAvailability(file, source, progress);
      return {
        availability,
        // No excerpt/answer/history is exposed to the view before the full-part gate.
        source: availability === 'ready' ? source : null,
        attempts:
          availability === 'ready'
            ? parseAttempts(rows).filter(
                (a) => a.caseId === file.id && a.revision === file.revision,
              )
            : [],
      };
    },
    enabled: !!file,
  });
  const { refetch } = query;
  React.useEffect(() => {
    if (file) void refetch();
  }, [file, progress.data?.finishedAt, refetch]);
  useFocusEffect(
    React.useCallback(() => {
      if (file) void refetch();
    }, [file, refetch]),
  );
  return query;
}
