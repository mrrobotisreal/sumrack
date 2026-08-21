import { useLocalSearchParams } from 'expo-router';

import { ItemDetailScreen } from '@/features/word-bank/item-detail-screen';

export default function BankItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemDetailScreen id={id} />;
}
