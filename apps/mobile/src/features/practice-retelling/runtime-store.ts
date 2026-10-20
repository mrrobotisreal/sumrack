import { repos } from '@/db';
import { createPracticeStore } from './store';
export const practiceStore = createPracticeStore(repos.learningSessions);
