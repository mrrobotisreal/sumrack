import { z } from 'zod';
import authored from './catalog.json';
import { CaseFileSchema } from './model';

/** Bundled companion v1, source-checked against published a1-no-end-house-001 v3. */
export const CASE_FILES = z.array(CaseFileSchema).parse(authored);
export const findCaseFile = (id: string) => CASE_FILES.find((file) => file.id === id);
export const caseFileForStory = (packId: string, storyId: string) =>
  CASE_FILES.find((file) => file.packId === packId && file.storyId === storyId);
