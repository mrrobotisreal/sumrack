import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';
import type { ImportedPackRow } from '@/db/repositories/imports';

import { importQueryKeys } from './import-service';

/** All import requests, newest first (intake list + dev stub screen). */
export function useImportRequests() {
  return useQuery({
    queryKey: importQueryKeys.requests,
    queryFn: () => repos.imports.listRequests(),
  });
}

/** Imported-pack meta by pack id (source label + imported date for the shelf). */
export function useImportedPackMeta() {
  return useQuery({
    queryKey: importQueryKeys.importedPacks,
    queryFn: async (): Promise<Map<string, ImportedPackRow>> => {
      const rows = await repos.imports.listImportedPacks();
      return new Map(rows.map((row) => [row.id, row]));
    },
  });
}
