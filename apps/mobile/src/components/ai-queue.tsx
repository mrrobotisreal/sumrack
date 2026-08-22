import { useAiQueueWorker } from '@/features/ai/use-ai-queue';

/** Mounts the T16 AI feedback-queue worker inside DbProvider (like AutoSync). */
export function AiQueue() {
  useAiQueueWorker();
  return null;
}
