import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { TokenRow } from '@/db/repositories/content';

export function GrammarWordLink({
  token,
  storyId,
  sentenceId,
  onClose,
}: {
  token: TokenRow;
  storyId: string;
  sentenceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const candidate = token.pos === 'noun' && /prep|acc/i.test(token.grammar ?? '');
  const source = useQuery({
    queryKey: ['grammar-source', token.packId, storyId, sentenceId],
    queryFn: () => repos.grammarConnections.example(token.packId, storyId, sentenceId),
    enabled: candidate,
  });
  if (!candidate || !source.data || source.isFetching) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        onClose();
        router.push('/grammar-connections' as never);
      }}
      className="mt-3 min-h-12 justify-center rounded-xl border border-border px-4 py-3 active:bg-surface-2"
    >
      <Text className="font-ui-medium text-accent">Где или куда? · Understand this case</Text>
    </Pressable>
  );
}
