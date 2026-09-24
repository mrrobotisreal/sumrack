import { useLocalSearchParams } from 'expo-router';

import { ItemDetailScreen, type ItemDetailTab } from '@/features/word-bank/item-detail-screen';

/** `?tab=forms|lessons` deep-links into a tab (T53 — the reader popup's «Формы», T54's global Lessons). */
export default function BankItemRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const initialTab: ItemDetailTab = tab === 'forms' || tab === 'lessons' ? tab : 'overview';
  return <ItemDetailScreen id={id} initialTab={initialTab} />;
}
